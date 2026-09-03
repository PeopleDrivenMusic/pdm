import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callAgent, execClaude } from './lib/callAgent.ts';
import { groundingCheck } from './lib/groundingCheck.ts';
import { loadAgent } from './lib/loadAgent.ts';
import { reflect } from './lib/reflect.ts';
import { runStage } from './lib/runStage.ts';
import { writeEscalation, writeRunTrace } from './lib/trace.ts';
import { isPlan, isSpec } from './types.ts';
import type { Plan, RunTrace, Spec, StageTrace } from './types.ts';

const PIPELINE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PIPELINE_DIR, '..', '..');
const MAX_ATTEMPTS = 3;

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseJsonLoose<T>(text: string): { ok: true; value: T } | { ok: false; reason: string } {
	const cleaned = text
		.trim()
		.replace(/^```(?:json)?\n?/, '')
		.replace(/```$/, '')
		.trim();
	try {
		return { ok: true, value: JSON.parse(cleaned) as T };
	} catch (err) {
		return { ok: false, reason: `invalid JSON: ${(err as Error).message}` };
	}
}

function buildReflectionPrompt(
	agentName: string,
	task: string,
	lastError: string | undefined,
	lastOutput: unknown,
	attempts: number
): string {
	return `You are ${agentName}, reflecting on your own performance on this task: "${task}".

It took ${attempts} attempt(s) to satisfy the mechanical gate. ${
		lastError ? `The final blocking error was: ${lastError}` : 'It eventually succeeded.'
	}

Your last output was:
${JSON.stringify(lastOutput, null, 2)}

In one sentence, name the concrete mistake pattern that caused the retry, and
one imperative rule that would have prevented it on the first attempt. Reply
with exactly one JSON object: {"triggerTag": "short-kebab-case-tag", "rule":
"one imperative sentence"}. No markdown fences, no other text.`;
}

function runReflectionIfNeeded(params: {
	agentName: string;
	agentDir: string;
	task: string;
	runId: string;
	attempts: number;
	lastError: string | undefined;
	lastOutput: unknown;
}): boolean {
	if (params.attempts <= 1) return false;
	const config = loadAgent(params.agentDir);
	const prompt = buildReflectionPrompt(
		params.agentName,
		params.task,
		params.lastError,
		params.lastOutput,
		params.attempts
	);
	const result = reflect({
		learningsPath: join(params.agentDir, 'learnings.md'),
		runId: params.runId,
		prompt,
		callAgent: (p) => callAgent(config, p, execClaude)
	});
	return result.fired;
}

function runSpecStage(
	task: string,
	runDir: string
): { ok: true; spec: Spec; trace: StageTrace } | { ok: false; trace: StageTrace } {
	const agentDir = join(PIPELINE_DIR, 'agents', 'spec-agent');
	const config = loadAgent(agentDir);
	const start = Date.now();
	let costUsd = 0;

	const result = runStage<Spec>({
		maxAttempts: MAX_ATTEMPTS,
		callAgent: (prompt) => {
			const r = callAgent(config, prompt, execClaude);
			if (r.ok) costUsd += r.costUsd;
			return r;
		},
		buildPrompt: (lastError) =>
			lastError
				? `Task: ${task}\n\nYour previous attempt was rejected: ${lastError}\n\nTry again.`
				: `Task: ${task}`,
		parseAndValidate: (text) => {
			const parsed = parseJsonLoose<unknown>(text);
			if (!parsed.ok) return parsed;
			return isSpec(parsed.value)
				? { ok: true, value: parsed.value }
				: { ok: false, reason: 'output did not match the Spec schema (see types.ts isSpec)' };
		},
		gate: () => ({ ok: true })
	});

	const runId = basename(runDir);
	const reflectionFired = runReflectionIfNeeded({
		agentName: 'spec-agent',
		agentDir,
		task,
		runId,
		attempts: result.attempts,
		lastError: result.ok ? undefined : result.lastError,
		lastOutput: result.ok ? result.output : result.lastOutput
	});

	const trace: StageTrace = {
		name: 'spec',
		attempts: result.attempts,
		outcome: result.ok ? 'ok' : 'escalated',
		durationMs: Date.now() - start,
		costUsd,
		reflectionFired
	};

	if (!result.ok) {
		writeEscalation(runDir, {
			stageName: 'spec',
			reason: result.lastError,
			lastAttempt: result.lastOutput
		});
		return { ok: false, trace };
	}

	writeFileSync(join(runDir, 'spec.json'), JSON.stringify(result.output, null, 2));
	return { ok: true, spec: result.output, trace };
}

function runPlanStage(
	task: string,
	spec: Spec,
	runDir: string
): { ok: true; plan: Plan; trace: StageTrace } | { ok: false; trace: StageTrace } {
	const agentDir = join(PIPELINE_DIR, 'agents', 'plan-agent');
	const config = loadAgent(agentDir);
	const start = Date.now();
	let costUsd = 0;
	let attempt = 0;
	const groundingLog: string[] = [];

	const result = runStage<Plan>({
		maxAttempts: MAX_ATTEMPTS,
		callAgent: (prompt) => {
			attempt++;
			const r = callAgent(config, prompt, execClaude);
			if (r.ok) {
				costUsd += r.costUsd;
				writeFileSync(join(runDir, `plan.attempt-${attempt}.json`), r.text);
			}
			return r;
		},
		buildPrompt: (lastError) =>
			lastError
				? `Spec:\n${JSON.stringify(spec, null, 2)}\n\nYour previous attempt was rejected: ${lastError}\n\nTry again.`
				: `Spec:\n${JSON.stringify(spec, null, 2)}`,
		parseAndValidate: (text) => {
			const parsed = parseJsonLoose<unknown>(text);
			if (!parsed.ok) return parsed;
			return isPlan(parsed.value)
				? { ok: true, value: parsed.value }
				: { ok: false, reason: 'output did not match the Plan schema (see types.ts isPlan)' };
		},
		gate: (plan) => {
			const g = groundingCheck(plan, REPO_ROOT);
			groundingLog.push(`attempt ${attempt}: ${g.ok ? 'PASS' : `FAIL — ${g.reason}`}`);
			return g;
		}
	});

	writeFileSync(join(runDir, 'grounding-check.log'), groundingLog.join('\n') + '\n');

	const runId = basename(runDir);
	const reflectionFired = runReflectionIfNeeded({
		agentName: 'plan-agent',
		agentDir,
		task,
		runId,
		attempts: result.attempts,
		lastError: result.ok ? undefined : result.lastError,
		lastOutput: result.ok ? result.output : result.lastOutput
	});

	const trace: StageTrace = {
		name: 'plan',
		attempts: result.attempts,
		outcome: result.ok ? 'ok' : 'escalated',
		durationMs: Date.now() - start,
		costUsd,
		reflectionFired
	};

	if (!result.ok) {
		writeEscalation(runDir, {
			stageName: 'plan',
			reason: result.lastError,
			lastAttempt: result.lastOutput
		});
		return { ok: false, trace };
	}

	return { ok: true, plan: result.output, trace };
}

function runPipeline(task: string, runDir: string): void {
	const specResult = runSpecStage(task, runDir);
	if (!specResult.ok) {
		writeRunTrace(runDir, {
			runId: basename(runDir),
			task,
			stages: [specResult.trace],
			injected: false
		});
		console.error('spec stage: ESCALATED — see runs/%s/escalation.md', basename(runDir));
		process.exitCode = 1;
		return;
	}

	const planResult = runPlanStage(task, specResult.spec, runDir);
	const trace: RunTrace = {
		runId: basename(runDir),
		task,
		stages: [specResult.trace, planResult.trace],
		injected: false
	};
	writeRunTrace(runDir, trace);

	if (!planResult.ok) {
		console.error('plan stage: ESCALATED — see runs/%s/escalation.md', basename(runDir));
		process.exitCode = 1;
		return;
	}

	console.log(`pipeline OK — spec + plan written to runs/${basename(runDir)}/`);
}

function runInjected(fixturePath: string, runDir: string): void {
	const fixtureRaw = readFileSync(fixturePath, 'utf-8');
	const agentDir = join(PIPELINE_DIR, 'agents', 'plan-agent');
	let attempt = 0;
	const groundingLog: string[] = [];

	const result = runStage<Plan>({
		maxAttempts: MAX_ATTEMPTS,
		callAgent: () => {
			attempt++;
			writeFileSync(join(runDir, `plan.attempt-${attempt}.json`), fixtureRaw);
			return { ok: true, text: fixtureRaw, costUsd: 0, inputTokens: 0, outputTokens: 0 };
		},
		buildPrompt: () =>
			'(injected fixture — no live prompt sent, deterministic demo of the retry/escalation path)',
		parseAndValidate: (text) => {
			const parsed = parseJsonLoose<unknown>(text);
			if (!parsed.ok) return parsed;
			return isPlan(parsed.value)
				? { ok: true, value: parsed.value }
				: { ok: false, reason: 'fixture did not match the Plan schema' };
		},
		gate: (plan) => {
			const g = groundingCheck(plan, REPO_ROOT);
			groundingLog.push(`attempt ${attempt}: ${g.ok ? 'PASS' : `FAIL — ${g.reason}`}`);
			return g;
		}
	});

	writeFileSync(join(runDir, 'grounding-check.log'), groundingLog.join('\n') + '\n');

	const runId = basename(runDir);
	const task = `(injected fixture demo: ${basename(fixturePath)})`;
	const reflectionFired = runReflectionIfNeeded({
		agentName: 'plan-agent',
		agentDir,
		task,
		runId,
		attempts: result.attempts,
		lastError: result.ok ? undefined : result.lastError,
		lastOutput: result.ok ? result.output : result.lastOutput
	});

	const trace: StageTrace = {
		name: 'plan',
		attempts: result.attempts,
		outcome: result.ok ? 'ok' : 'escalated',
		durationMs: 0,
		costUsd: 0,
		reflectionFired
	};

	if (!result.ok) {
		writeEscalation(runDir, {
			stageName: 'plan',
			reason: result.lastError,
			lastAttempt: result.lastOutput
		});
	}

	writeRunTrace(runDir, { runId, task, stages: [trace], injected: true });

	if (result.ok) {
		console.log(
			`injected demo: gate eventually passed after ${result.attempts} attempt(s) (unexpected for this fixture)`
		);
	} else {
		console.log(
			`injected demo: escalated after ${result.attempts} attempts, as designed — see runs/${runId}/escalation.md`
		);
		process.exitCode = 1;
	}
}

function main(): void {
	const args = process.argv.slice(2);
	const runId = timestamp();
	const runDir = join(PIPELINE_DIR, 'runs', runId);
	mkdirSync(runDir, { recursive: true });

	const injectIdx = args.indexOf('--inject');
	if (injectIdx !== -1) {
		const fixturePath = args[injectIdx + 1];
		if (!fixturePath || !existsSync(resolve(fixturePath))) {
			console.error('Usage: node run.ts --inject <path-to-fixture.json>');
			process.exit(1);
		}
		runInjected(resolve(fixturePath), runDir);
		return;
	}

	const task = args.join(' ').trim();
	if (!task) {
		console.error(
			'Usage: node run.ts "<task description>"  |  node run.ts --inject <fixture.json>'
		);
		process.exit(1);
	}

	runPipeline(task, runDir);
}

main();
