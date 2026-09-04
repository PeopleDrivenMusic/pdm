import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callAgent, execClaude } from './lib/callAgent.ts';
import { groundingCheck } from './lib/groundingCheck.ts';
import { loadAgent } from './lib/loadAgent.ts';
import { reflect } from './lib/reflect.ts';
import { renderPlanMarkdown } from './lib/renderPlanMarkdown.ts';
import { renderReportHtml } from './lib/renderReportHtml.ts';
import { runStage } from './lib/runStage.ts';
import { writeEscalation, writeReviewNotes, writeRunTrace } from './lib/trace.ts';
import { isPlan, isReview, isSpec } from './types.ts';
import type {
	LessonRecord,
	Plan,
	Review,
	ReviewRoundTrace,
	RunTrace,
	Spec,
	StageTrace,
	Usage
} from './types.ts';
import type { CallAgentResult } from './lib/callAgent.ts';

const PIPELINE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PIPELINE_DIR, '..', '..');
const MAX_ATTEMPTS = 3;
const MAX_REVIEW_ROUNDS = 3;

const PLAN_AGENT_DIR = join(PIPELINE_DIR, 'agents', 'plan-agent');
const SPEC_AGENT_DIR = join(PIPELINE_DIR, 'agents', 'spec-agent');
const REVIEWER_AGENT_DIR = join(PIPELINE_DIR, 'agents', 'plan-reviewer');

// Fixed per-agent triggerTag vocabularies. Without this, two reflection calls
// on the *same* underlying mistake can each invent a differently-worded tag
// (observed live: 'unread-line-citation' vs 'unverified-filemap-line' for the
// identical failure across two runs) — the promotion counter in learnings.ts
// matches by exact tag string, so a free-text tag silently defeats it. A
// closed vocabulary makes recurrence detectable instead of a coin flip.
const SPEC_AGENT_TAGS = [
	'unverified-file-path',
	'vague-requirement',
	'missing-out-of-scope',
	'other'
];
const PLAN_AGENT_TAGS = [
	'stale-line-citation',
	'unverified-file-path',
	'unrequested-scope',
	'missing-test-first-sequencing',
	'spec-requirement-gap',
	'vague-verify-commands',
	'other'
];
const REVIEWER_TAGS = [
	'flagged-out-of-scope-item',
	'flagged-style-preference',
	'appropriately-blocked',
	'other'
];

function tagInstruction(allowedTags: string[]): string {
	return `Pick the closest matching triggerTag from this fixed list — do not invent a new one: ${allowedTags.join(', ')}. Use "other" only if truly none fit.`;
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

function emptyUsage(): Usage {
	return { costUsd: 0, inputTokens: 0, outputTokens: 0 };
}

function addUsage(target: Usage, r: Extract<CallAgentResult, { ok: true }>): void {
	target.costUsd += r.costUsd;
	target.inputTokens += r.inputTokens;
	target.outputTokens += r.outputTokens;
}

function mergeUsage(target: Usage, src: Usage): void {
	target.costUsd += src.costUsd;
	target.inputTokens += src.inputTokens;
	target.outputTokens += src.outputTokens;
}

function computeOutcome(stages: StageTrace[]): RunTrace['outcome'] {
	if (stages.some((s) => s.outcome === 'escalated')) return 'escalated';
	if (stages.some((s) => s.outcome === 'unapproved')) return 'unapproved';
	return 'ok';
}

function computeTotals(stages: StageTrace[]): RunTrace['totals'] {
	const totals = { costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
	for (const s of stages) {
		totals.costUsd += s.usage.costUsd;
		totals.inputTokens += s.usage.inputTokens;
		totals.outputTokens += s.usage.outputTokens;
		totals.durationMs += s.durationMs;
	}
	return totals;
}

function writeReport(runDir: string, trace: RunTrace): void {
	writeRunTrace(runDir, trace);
	writeFileSync(join(runDir, 'report.html'), renderReportHtml(trace));
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
	attempts: number,
	allowedTags: string[]
): string {
	return `You are ${agentName}, reflecting on your own performance on this task: "${task}".

It took ${attempts} attempt(s) to satisfy the mechanical gate. ${
		lastError ? `The final blocking error was: ${lastError}` : 'It eventually succeeded.'
	}

Your last output was:
${JSON.stringify(lastOutput, null, 2)}

In one sentence, name the concrete mistake pattern that caused the retry, and
one imperative rule that would have prevented it on the first attempt. ${tagInstruction(
		allowedTags
	)} Reply with exactly one JSON object: {"triggerTag": "...", "rule": "one
imperative sentence"}. No markdown fences, no other text.`;
}

function runReflectionIfNeeded(params: {
	agentName: string;
	agentDir: string;
	allowedTags: string[];
	task: string;
	runId: string;
	attempts: number;
	lastError: string | undefined;
	lastOutput: unknown;
}): LessonRecord | null {
	if (params.attempts <= 1) return null;
	const config = loadAgent(params.agentDir);
	const prompt = buildReflectionPrompt(
		params.agentName,
		params.task,
		params.lastError,
		params.lastOutput,
		params.attempts,
		params.allowedTags
	);
	const result = reflect({
		learningsPath: join(params.agentDir, 'learnings.md'),
		runId: params.runId,
		prompt,
		callAgent: (p) => callAgent(config, p, execClaude)
	});
	if (!result.fired) return null;
	return {
		agent: params.agentName,
		triggerTag: result.triggerTag,
		rule: result.rule,
		promoted: result.promoted
	};
}

function reflectFromReviewComments(runId: string, comments: string[]): LessonRecord | null {
	const config = loadAgent(PLAN_AGENT_DIR);
	const prompt = `You are plan-agent. A reviewer found these issues with your plan:
${comments.map((c) => `- ${c}`).join('\n')}

In one sentence, name the concrete habit that caused this and one imperative
rule that would prevent it next time. ${tagInstruction(
		PLAN_AGENT_TAGS
	)} Reply with exactly one JSON object: {"triggerTag": "...", "rule": "one
imperative sentence"}. No markdown fences, no other text.`;
	const result = reflect({
		learningsPath: join(PLAN_AGENT_DIR, 'learnings.md'),
		runId,
		prompt,
		callAgent: (p) => callAgent(config, p, execClaude)
	});
	if (!result.fired) return null;
	return {
		agent: 'plan-agent',
		triggerTag: result.triggerTag,
		rule: result.rule,
		promoted: result.promoted
	};
}

function reflectReviewerCalibration(
	runId: string,
	rounds: ReviewRoundTrace[]
): LessonRecord | null {
	const config = loadAgent(REVIEWER_AGENT_DIR);
	const roundsSummary = rounds
		.map(
			(r) =>
				`round ${r.round}: ${r.verdict}${r.verdict === 'needs-revision' ? ` (${r.commentCount} comment(s))` : ''}`
		)
		.join('\n');
	const prompt = `You are plan-reviewer. It took ${rounds.length} round(s) to reach a final verdict on one plan:
${roundsSummary}

In one sentence, reflect: were your earlier comments essential (a real
defect against your rubric) or could you have approved sooner? Name one
imperative calibration rule for next time. ${tagInstruction(
		REVIEWER_TAGS
	)} Reply with exactly one JSON object: {"triggerTag": "...", "rule": "one
imperative sentence"}. No markdown fences, no other text.`;
	const result = reflect({
		learningsPath: join(REVIEWER_AGENT_DIR, 'learnings.md'),
		runId,
		prompt,
		callAgent: (p) => callAgent(config, p, execClaude)
	});
	if (!result.fired) return null;
	return {
		agent: 'plan-reviewer',
		triggerTag: result.triggerTag,
		rule: result.rule,
		promoted: result.promoted
	};
}

function runSpecStage(
	task: string,
	runDir: string
): { ok: true; spec: Spec; trace: StageTrace } | { ok: false; trace: StageTrace } {
	const config = loadAgent(SPEC_AGENT_DIR);
	const start = Date.now();
	const usage = emptyUsage();

	const result = runStage<Spec>({
		maxAttempts: MAX_ATTEMPTS,
		callAgent: (prompt) => {
			const r = callAgent(config, prompt, execClaude);
			if (r.ok) addUsage(usage, r);
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
	const lessons: LessonRecord[] = [];
	const lesson = runReflectionIfNeeded({
		agentName: 'spec-agent',
		agentDir: SPEC_AGENT_DIR,
		allowedTags: SPEC_AGENT_TAGS,
		task,
		runId,
		attempts: result.attempts,
		lastError: result.ok ? undefined : result.lastError,
		lastOutput: result.ok ? result.output : result.lastOutput
	});
	if (lesson) lessons.push(lesson);

	const trace: StageTrace = {
		name: 'spec',
		attempts: result.attempts,
		outcome: result.ok ? 'ok' : 'escalated',
		durationMs: Date.now() - start,
		usage,
		lessons
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

/** Retries plan-agent until groundingCheck passes (or MAX_ATTEMPTS is exhausted). */
function generateGroundedPlan(
	basePrompt: string,
	runDir: string,
	attemptPrefix: string,
	groundingLog: string[]
): { result: ReturnType<typeof runStage<Plan>>; usage: Usage; attemptCount: number } {
	const config = loadAgent(PLAN_AGENT_DIR);
	const usage = emptyUsage();
	let attempt = 0;

	const result = runStage<Plan>({
		maxAttempts: MAX_ATTEMPTS,
		callAgent: (prompt) => {
			attempt++;
			const r = callAgent(config, prompt, execClaude);
			if (r.ok) {
				addUsage(usage, r);
				writeFileSync(join(runDir, `${attemptPrefix}.attempt-${attempt}.json`), r.text);
			}
			return r;
		},
		buildPrompt: (lastError) =>
			lastError
				? `${basePrompt}\n\nYour previous attempt was rejected: ${lastError}\n\nTry again.`
				: basePrompt,
		parseAndValidate: (text) => {
			const parsed = parseJsonLoose<unknown>(text);
			if (!parsed.ok) return parsed;
			return isPlan(parsed.value)
				? { ok: true, value: parsed.value }
				: { ok: false, reason: 'output did not match the Plan schema (see types.ts isPlan)' };
		},
		gate: (plan) => {
			const g = groundingCheck(plan, REPO_ROOT);
			groundingLog.push(
				`${attemptPrefix} attempt ${attempt}: ${g.ok ? 'PASS' : `FAIL — ${g.reason}`}`
			);
			return g;
		}
	});

	return { result, usage, attemptCount: attempt };
}

/** Runs one plan-reviewer verdict call (with its own schema-retry, not a review round). */
function callReviewer(
	spec: Spec,
	plan: Plan,
	round: number,
	isFinalRound: boolean
): { result: ReturnType<typeof runStage<Review>>; usage: Usage } {
	const config = loadAgent(REVIEWER_AGENT_DIR);
	const usage = emptyUsage();
	const basePrompt = `Spec:\n${JSON.stringify(spec, null, 2)}\n\nPlan (already grounding-checked):\n${JSON.stringify(
		plan,
		null,
		2
	)}${isFinalRound ? '\n\nThis is the final round (3 of 3).' : ''}`;

	const result = runStage<Review>({
		maxAttempts: MAX_ATTEMPTS,
		callAgent: (prompt) => {
			const r = callAgent(config, prompt, execClaude);
			if (r.ok) addUsage(usage, r);
			return r;
		},
		buildPrompt: (lastError) =>
			lastError
				? `${basePrompt}\n\nYour previous reply was rejected: ${lastError}\n\nReply again, JSON only.`
				: basePrompt,
		parseAndValidate: (text) => {
			const parsed = parseJsonLoose<unknown>(text);
			if (!parsed.ok) return parsed;
			return isReview(parsed.value)
				? { ok: true, value: parsed.value }
				: { ok: false, reason: 'output did not match the Review schema (see types.ts isReview)' };
		},
		gate: () => ({ ok: true })
	});

	return { result, usage };
}

type PlanStageResult =
	| { ok: true; plan: Plan; approved: boolean; trace: StageTrace }
	| { ok: false; trace: StageTrace };

function runPlanStage(task: string, spec: Spec, runDir: string): PlanStageResult {
	const start = Date.now();
	const runId = basename(runDir);
	const usage = emptyUsage();
	let totalAttempts = 0;
	const lessons: LessonRecord[] = [];
	const groundingLog: string[] = [];
	const reviewRounds: ReviewRoundTrace[] = [];
	let lastReviewComments: string[] = [];

	const specPrompt = `Spec:\n${JSON.stringify(spec, null, 2)}`;
	const initial = generateGroundedPlan(specPrompt, runDir, 'plan', groundingLog);
	mergeUsage(usage, initial.usage);
	totalAttempts += initial.attemptCount;
	const initialLesson = runReflectionIfNeeded({
		agentName: 'plan-agent',
		agentDir: PLAN_AGENT_DIR,
		allowedTags: PLAN_AGENT_TAGS,
		task,
		runId,
		attempts: initial.attemptCount,
		lastError: initial.result.ok ? undefined : initial.result.lastError,
		lastOutput: initial.result.ok ? initial.result.output : initial.result.lastOutput
	});
	if (initialLesson) lessons.push(initialLesson);

	if (!initial.result.ok) {
		writeFileSync(join(runDir, 'grounding-check.log'), groundingLog.join('\n') + '\n');
		writeEscalation(runDir, {
			stageName: 'plan',
			reason: initial.result.lastError,
			lastAttempt: initial.result.lastOutput
		});
		return {
			ok: false,
			trace: {
				name: 'plan',
				attempts: totalAttempts,
				outcome: 'escalated',
				durationMs: Date.now() - start,
				usage,
				lessons,
				review: []
			}
		};
	}

	let currentPlan = initial.result.output;
	let approved = false;

	for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
		const isFinalRound = round === MAX_REVIEW_ROUNDS;
		const { result: reviewResult, usage: reviewUsage } = callReviewer(
			spec,
			currentPlan,
			round,
			isFinalRound
		);
		mergeUsage(usage, reviewUsage);
		writeFileSync(
			join(runDir, `review.round-${round}.json`),
			JSON.stringify(
				reviewResult.ok ? reviewResult.output : { schemaFailure: reviewResult.lastError },
				null,
				2
			)
		);

		if (!reviewResult.ok) {
			lastReviewComments = [
				`plan-reviewer failed to return a valid verdict: ${reviewResult.lastError}`
			];
			reviewRounds.push({ round, verdict: 'needs-revision', commentCount: 1 });
			break;
		}

		const review = reviewResult.output;
		if (review.verdict === 'approved') {
			reviewRounds.push({ round, verdict: 'approved', commentCount: 0 });
			approved = true;
			break;
		}

		lastReviewComments = review.comments;
		reviewRounds.push({ round, verdict: 'needs-revision', commentCount: review.comments.length });
		const commentLesson = reflectFromReviewComments(runId, review.comments);
		if (commentLesson) lessons.push(commentLesson);

		if (isFinalRound) break;

		const revisionPrompt = `Spec:\n${JSON.stringify(spec, null, 2)}\n\nYour previous plan:\n${JSON.stringify(
			currentPlan,
			null,
			2
		)}\n\nThe reviewer requested changes:\n${review.comments
			.map((c) => `- ${c}`)
			.join('\n')}\n\nRevise the plan to address these, keeping every fileMap citation grounded.`;
		const revision = generateGroundedPlan(
			revisionPrompt,
			runDir,
			`plan.review-${round}`,
			groundingLog
		);
		mergeUsage(usage, revision.usage);
		totalAttempts += revision.attemptCount;
		const revisionLesson = runReflectionIfNeeded({
			agentName: 'plan-agent',
			agentDir: PLAN_AGENT_DIR,
			allowedTags: PLAN_AGENT_TAGS,
			task,
			runId,
			attempts: revision.attemptCount,
			lastError: revision.result.ok ? undefined : revision.result.lastError,
			lastOutput: revision.result.ok ? revision.result.output : revision.result.lastOutput
		});
		if (revisionLesson) lessons.push(revisionLesson);

		if (!revision.result.ok) {
			writeFileSync(join(runDir, 'grounding-check.log'), groundingLog.join('\n') + '\n');
			writeEscalation(runDir, {
				stageName: 'plan',
				reason: revision.result.lastError,
				lastAttempt: revision.result.lastOutput
			});
			return {
				ok: false,
				trace: {
					name: 'plan',
					attempts: totalAttempts,
					outcome: 'escalated',
					durationMs: Date.now() - start,
					usage,
					lessons,
					review: reviewRounds
				}
			};
		}

		currentPlan = revision.result.output;
	}

	writeFileSync(join(runDir, 'grounding-check.log'), groundingLog.join('\n') + '\n');

	if (reviewRounds.length > 1) {
		const calibrationLesson = reflectReviewerCalibration(runId, reviewRounds);
		if (calibrationLesson) lessons.push(calibrationLesson);
	}

	writeFileSync(join(runDir, 'plan.json'), JSON.stringify(currentPlan, null, 2));
	writeFileSync(
		join(runDir, 'plan.md'),
		renderPlanMarkdown(currentPlan, { approved, comments: approved ? [] : lastReviewComments })
	);

	if (!approved) {
		writeReviewNotes(runDir, { rounds: reviewRounds.length, comments: lastReviewComments });
	}

	return {
		ok: true,
		plan: currentPlan,
		approved,
		trace: {
			name: 'plan',
			attempts: totalAttempts,
			outcome: approved ? 'ok' : 'unapproved',
			durationMs: Date.now() - start,
			usage,
			lessons,
			review: reviewRounds
		}
	};
}

function runPipeline(task: string, runDir: string): void {
	const specResult = runSpecStage(task, runDir);
	if (!specResult.ok) {
		const stages = [specResult.trace];
		writeReport(runDir, {
			runId: basename(runDir),
			task,
			stages,
			totals: computeTotals(stages),
			outcome: computeOutcome(stages),
			injected: false
		});
		console.error('spec stage: ESCALATED — see runs/%s/escalation.md', basename(runDir));
		process.exitCode = 1;
		return;
	}

	const planResult = runPlanStage(task, specResult.spec, runDir);
	const stages = [specResult.trace, planResult.trace];
	writeReport(runDir, {
		runId: basename(runDir),
		task,
		stages,
		totals: computeTotals(stages),
		outcome: computeOutcome(stages),
		injected: false
	});

	if (!planResult.ok) {
		console.error('plan stage: ESCALATED — see runs/%s/escalation.md', basename(runDir));
		process.exitCode = 1;
		return;
	}

	if (!planResult.approved) {
		console.log(
			`pipeline done, NOT reviewer-approved — see runs/${basename(runDir)}/review-notes.md and plan.md`
		);
		return;
	}

	console.log(`pipeline OK, reviewer-approved — plan.md written to runs/${basename(runDir)}/`);
}

function runInjected(fixturePath: string, runDir: string): void {
	const fixtureRaw = readFileSync(fixturePath, 'utf-8');
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
	const lessons: LessonRecord[] = [];
	const lesson = runReflectionIfNeeded({
		agentName: 'plan-agent',
		agentDir: PLAN_AGENT_DIR,
		allowedTags: PLAN_AGENT_TAGS,
		task,
		runId,
		attempts: result.attempts,
		lastError: result.ok ? undefined : result.lastError,
		lastOutput: result.ok ? result.output : result.lastOutput
	});
	if (lesson) lessons.push(lesson);

	const trace: StageTrace = {
		name: 'plan',
		attempts: result.attempts,
		outcome: result.ok ? 'ok' : 'escalated',
		durationMs: 0,
		usage: emptyUsage(),
		lessons
	};

	if (!result.ok) {
		writeEscalation(runDir, {
			stageName: 'plan',
			reason: result.lastError,
			lastAttempt: result.lastOutput
		});
	}

	const stages = [trace];
	writeReport(runDir, {
		runId,
		task,
		stages,
		totals: computeTotals(stages),
		outcome: computeOutcome(stages),
		injected: true
	});

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
