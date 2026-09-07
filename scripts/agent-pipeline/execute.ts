import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callAgent, execClaude } from './lib/callAgent.ts';
import { classifySlices } from './lib/classifySlices.ts';
import {
	commitFiles,
	currentBranch,
	diffFile,
	isWorkingTreeClean,
	listDirtyFiles,
	revertFiles
} from './lib/git.ts';
import { loadAgent } from './lib/loadAgent.ts';
import { parseJsonLoose } from './lib/parseJsonLoose.ts';
import { reflect } from './lib/reflect.ts';
import { renderReportHtml } from './lib/renderReportHtml.ts';
import { runCommand } from './lib/runCommand.ts';
import { runStage } from './lib/runStage.ts';
import { addUsage, emptyUsage, mergeUsage } from './lib/usage.ts';
import { vitestArgsFor } from './lib/vitestArgs.ts';
import { isPlan, isReview, isWriteResult } from './types.ts';
import type {
	ExecuteTrace,
	LessonRecord,
	Plan,
	Review,
	ReviewRoundTrace,
	RunTrace,
	Slice,
	SliceTrace,
	Usage,
	WriteResult
} from './types.ts';

const PIPELINE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PIPELINE_DIR, '..', '..');
const MAX_ATTEMPTS = 3;
const MAX_REVIEW_ROUNDS = 3;

const TEST_WRITER_DIR = join(PIPELINE_DIR, 'agents', 'test-writer');
const CODER_DIR = join(PIPELINE_DIR, 'agents', 'coder');
const CODE_REVIEWER_DIR = join(PIPELINE_DIR, 'agents', 'code-reviewer');

const TEST_WRITER_TAGS = ['unclear-decision', 'wrong-test-pattern', 'vacuous-assertion', 'other'];
const CODER_TAGS = [
	'touched-test-file',
	'unrequested-scope',
	'missing-reuse',
	'wrong-fix',
	'other'
];
const CODE_REVIEWER_TAGS = [
	'flagged-test-weakening',
	'flagged-style-preference',
	'appropriately-blocked',
	'other'
];

function tagInstruction(allowedTags: string[]): string {
	return `Pick the closest matching triggerTag from this fixed list — do not invent a new one: ${allowedTags.join(', ')}. Use "other" only if truly none fit.`;
}

function reflectOnRetry(params: {
	agentName: string;
	agentDir: string;
	allowedTags: string[];
	runId: string;
	attempts: number;
	lastError: string;
	lastOutput: unknown;
}): LessonRecord | null {
	if (params.attempts <= 1) return null;
	const config = loadAgent(params.agentDir);
	const prompt = `You are ${params.agentName}. It took ${params.attempts} attempt(s) to satisfy the mechanical gate. The final blocking error was: ${params.lastError}

Your last output was:
${JSON.stringify(params.lastOutput, null, 2)}

In one sentence, name the concrete mistake pattern that caused the retry, and one imperative rule that would have prevented it on the first attempt. ${tagInstruction(
		params.allowedTags
	)} Reply with exactly one JSON object: {"triggerTag": "...", "rule": "one imperative sentence"}. No markdown fences, no other text.`;
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

function reflectReviewerCalibration(
	runId: string,
	rounds: ReviewRoundTrace[]
): LessonRecord | null {
	const config = loadAgent(CODE_REVIEWER_DIR);
	const summary = rounds
		.map(
			(r) =>
				`round ${r.round}: ${r.verdict}${r.verdict === 'needs-revision' ? ` (${r.commentCount} comment(s))` : ''}`
		)
		.join('\n');
	const prompt = `You are code-reviewer. It took ${rounds.length} round(s) to reach a final verdict on one slice:
${summary}

In one sentence, reflect: were your earlier comments essential (a real defect against your rubric) or could you have approved sooner? Name one imperative calibration rule for next time. ${tagInstruction(
		CODE_REVIEWER_TAGS
	)} Reply with exactly one JSON object: {"triggerTag": "...", "rule": "one imperative sentence"}. No markdown fences, no other text.`;
	const result = reflect({
		learningsPath: join(CODE_REVIEWER_DIR, 'learnings.md'),
		runId,
		prompt,
		callAgent: (p) => callAgent(config, p, execClaude)
	});
	if (!result.fired) return null;
	return {
		agent: 'code-reviewer',
		triggerTag: result.triggerTag,
		rule: result.rule,
		promoted: result.promoted
	};
}

export type Exec = (
	command: string,
	args: string[],
	cwd: string
) => import('./lib/runCommand.ts').CommandResult;

/** Runs test-writer, retrying up to MAX_ATTEMPTS until a real command run against testFile confirms it fails (red). `exec` is injected so this can be tested without a real vitest project on disk. */
function runTestWriter(params: {
	repoRoot: string;
	agentDir: string;
	decision: string;
	testFile: string;
	exec: Exec;
}): { result: ReturnType<typeof runStage<WriteResult>>; usage: Usage } {
	const config = loadAgent(params.agentDir);
	const usage = emptyUsage();
	const basePrompt = `Decision: ${params.decision}\n\nTest file to write: \`${params.testFile}\``;

	const result = runStage<WriteResult>({
		maxAttempts: MAX_ATTEMPTS,
		callAgent: (prompt) => {
			const r = callAgent(config, prompt, execClaude);
			if (r.ok) addUsage(usage, r);
			return r;
		},
		buildPrompt: (lastError) =>
			lastError
				? `${basePrompt}\n\nYour previous attempt was rejected: ${lastError}\n\nTry again.`
				: basePrompt,
		parseAndValidate: (text) => {
			const parsed = parseJsonLoose<unknown>(text);
			if (!parsed.ok) return parsed;
			return isWriteResult(parsed.value)
				? { ok: true, value: parsed.value }
				: { ok: false, reason: 'output did not match the WriteResult schema' };
		},
		gate: (value) => {
			if (value.status === 'blocked') return { ok: false, reason: value.reason, failedRefs: [] };
			if (!existsSync(join(params.repoRoot, params.testFile))) {
				return { ok: false, reason: `${params.testFile} was not created`, failedRefs: [] };
			}
			const check = params.exec('yarn', vitestArgsFor(params.testFile), params.repoRoot);
			if (check.ok) {
				return {
					ok: false,
					reason: `test passed when it should be red (nothing to test yet):\n${check.output.slice(0, 2000)}`,
					failedRefs: []
				};
			}
			return { ok: true };
		}
	});

	return { result, usage };
}

/** Runs coder, retrying up to MAX_ATTEMPTS until the same test file plus `yarn check` both pass (green). `exec` is injected so this can be tested without a real vitest project on disk. */
function runCoder(params: {
	repoRoot: string;
	agentDir: string;
	decision: string;
	testFile: string;
	testWriterOutput: string;
	extraContext?: string;
	exec: Exec;
}): { result: ReturnType<typeof runStage<WriteResult>>; usage: Usage } {
	const config = loadAgent(params.agentDir);
	const usage = emptyUsage();
	const basePrompt = `Decision: ${params.decision}\n\nThe test at \`${params.testFile}\` is confirmed red:\n${params.testWriterOutput.slice(0, 1500)}${params.extraContext ? `\n\n${params.extraContext}` : ''}`;

	const result = runStage<WriteResult>({
		maxAttempts: MAX_ATTEMPTS,
		callAgent: (prompt) => {
			const r = callAgent(config, prompt, execClaude);
			if (r.ok) addUsage(usage, r);
			return r;
		},
		buildPrompt: (lastError) =>
			lastError
				? `${basePrompt}\n\nYour previous attempt was rejected: ${lastError}\n\nTry again.`
				: basePrompt,
		parseAndValidate: (text) => {
			const parsed = parseJsonLoose<unknown>(text);
			if (!parsed.ok) return parsed;
			return isWriteResult(parsed.value)
				? { ok: true, value: parsed.value }
				: { ok: false, reason: 'output did not match the WriteResult schema' };
		},
		gate: (value) => {
			if (value.status === 'blocked') return { ok: false, reason: value.reason, failedRefs: [] };
			const testRun = params.exec('yarn', vitestArgsFor(params.testFile), params.repoRoot);
			if (!testRun.ok) {
				return {
					ok: false,
					reason: `test still failing:\n${testRun.output.slice(0, 2000)}`,
					failedRefs: []
				};
			}
			// 'run' is required: Yarn Classic 1.x treats "check" as a reserved
			// built-in (its own lockfile-integrity checker), which silently
			// shadows a same-named package.json script — `yarn check` never once
			// ran svelte-check here, live-verified 2026-09-07.
			const typecheck = params.exec('yarn', ['run', 'check'], params.repoRoot);
			if (!typecheck.ok) {
				return {
					ok: false,
					reason: `yarn check failed:\n${typecheck.output.slice(0, 2000)}`,
					failedRefs: []
				};
			}
			return { ok: true };
		}
	});

	return { result, usage };
}

function runCodeReviewer(params: {
	repoRoot: string;
	decision: string;
	diff: string;
	testFileTouched: boolean;
	testFileDiff: string;
	round: number;
	isFinalRound: boolean;
}): { result: ReturnType<typeof runStage<Review>>; usage: Usage } {
	const config = loadAgent(CODE_REVIEWER_DIR);
	const usage = emptyUsage();
	const cheatNote = params.testFileTouched
		? `\n\nThe test file was modified by coder — review this diff first:\n${params.testFileDiff}`
		: '';
	const basePrompt = `Decision: ${params.decision}\n\nDiff:\n${params.diff}${cheatNote}${params.isFinalRound ? '\n\nThis is the final round (3 of 3).' : ''}`;

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
				: { ok: false, reason: 'output did not match the Review schema' };
		},
		gate: () => ({ ok: true })
	});

	return { result, usage };
}

export function runSlice(params: {
	repoRoot: string;
	runId: string;
	sliceIndex: number;
	slice: Extract<Slice, { kind: 'tdd-pair' }>;
	exec: Exec;
}): SliceTrace {
	const start = Date.now();
	const { repoRoot, runId, sliceIndex, slice, exec } = params;
	const usage = emptyUsage();
	const lessons: LessonRecord[] = [];

	const testWriterRun = runTestWriter({
		repoRoot,
		agentDir: TEST_WRITER_DIR,
		decision: slice.testDecision,
		testFile: slice.testFile,
		exec
	});
	mergeUsage(usage, testWriterRun.usage);
	const testWriterLesson = reflectOnRetry({
		agentName: 'test-writer',
		agentDir: TEST_WRITER_DIR,
		allowedTags: TEST_WRITER_TAGS,
		runId,
		attempts: testWriterRun.result.attempts,
		lastError: testWriterRun.result.ok ? '' : testWriterRun.result.lastError,
		lastOutput: testWriterRun.result.ok
			? testWriterRun.result.output
			: testWriterRun.result.lastOutput
	});
	if (testWriterLesson) lessons.push(testWriterLesson);

	if (!testWriterRun.result.ok) {
		revertFiles(repoRoot, listDirtyFiles(repoRoot));
		return {
			sliceIndex,
			kind: 'tdd-pair',
			testFile: slice.testFile,
			outcome: 'escalated',
			durationMs: Date.now() - start,
			attempts: { testWriter: testWriterRun.result.attempts, coder: 0 },
			usage,
			lessons,
			review: [],
			committed: false
		};
	}

	const redOutput = exec('yarn', vitestArgsFor(slice.testFile), repoRoot).output;
	let coderRun = runCoder({
		repoRoot,
		agentDir: CODER_DIR,
		decision: slice.implDecision,
		testFile: slice.testFile,
		testWriterOutput: redOutput,
		exec
	});
	mergeUsage(usage, coderRun.usage);
	let coderLesson = reflectOnRetry({
		agentName: 'coder',
		agentDir: CODER_DIR,
		allowedTags: CODER_TAGS,
		runId,
		attempts: coderRun.result.attempts,
		lastError: coderRun.result.ok ? '' : coderRun.result.lastError,
		lastOutput: coderRun.result.ok ? coderRun.result.output : coderRun.result.lastOutput
	});
	if (coderLesson) lessons.push(coderLesson);

	if (!coderRun.result.ok) {
		revertFiles(repoRoot, listDirtyFiles(repoRoot));
		return {
			sliceIndex,
			kind: 'tdd-pair',
			testFile: slice.testFile,
			outcome: 'escalated',
			durationMs: Date.now() - start,
			attempts: { testWriter: testWriterRun.result.attempts, coder: coderRun.result.attempts },
			usage,
			lessons,
			review: [],
			committed: false
		};
	}

	const reviewRounds: ReviewRoundTrace[] = [];
	let approved = false;
	let totalCoderAttempts = coderRun.result.attempts;

	for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
		const isFinalRound = round === MAX_REVIEW_ROUNDS;
		const dirtyFiles = listDirtyFiles(repoRoot);
		const diff = dirtyFiles.map((f) => diffFile(repoRoot, f)).join('\n');
		const testFileTouched = dirtyFiles.includes(slice.testFile);
		const testFileDiff = testFileTouched ? diffFile(repoRoot, slice.testFile) : '';

		const { result: reviewResult, usage: reviewUsage } = runCodeReviewer({
			repoRoot,
			decision: `${slice.testDecision}\n\n${slice.implDecision}`,
			diff,
			testFileTouched,
			testFileDiff,
			round,
			isFinalRound
		});
		mergeUsage(usage, reviewUsage);

		if (!reviewResult.ok) {
			reviewRounds.push({
				round,
				verdict: 'needs-revision',
				commentCount: 1,
				comments: [`code-reviewer failed to return a valid verdict: ${reviewResult.lastError}`]
			});
			break;
		}

		const review = reviewResult.output;
		if (review.verdict === 'approved') {
			reviewRounds.push({ round, verdict: 'approved', commentCount: 0, comments: [] });
			approved = true;
			break;
		}

		reviewRounds.push({
			round,
			verdict: 'needs-revision',
			commentCount: review.comments.length,
			comments: review.comments
		});

		if (isFinalRound) break;

		coderRun = runCoder({
			repoRoot,
			agentDir: CODER_DIR,
			decision: slice.implDecision,
			testFile: slice.testFile,
			testWriterOutput: redOutput,
			extraContext: `The reviewer requested changes:\n${review.comments.map((c) => `- ${c}`).join('\n')}`,
			exec
		});
		mergeUsage(usage, coderRun.usage);
		totalCoderAttempts += coderRun.result.attempts;
		coderLesson = reflectOnRetry({
			agentName: 'coder',
			agentDir: CODER_DIR,
			allowedTags: CODER_TAGS,
			runId,
			attempts: coderRun.result.attempts,
			lastError: coderRun.result.ok ? '' : coderRun.result.lastError,
			lastOutput: coderRun.result.ok ? coderRun.result.output : coderRun.result.lastOutput
		});
		if (coderLesson) lessons.push(coderLesson);

		if (!coderRun.result.ok) {
			revertFiles(repoRoot, listDirtyFiles(repoRoot));
			return {
				sliceIndex,
				kind: 'tdd-pair',
				testFile: slice.testFile,
				outcome: 'escalated',
				durationMs: Date.now() - start,
				attempts: { testWriter: testWriterRun.result.attempts, coder: totalCoderAttempts },
				usage,
				lessons,
				review: reviewRounds,
				committed: false
			};
		}
	}

	if (reviewRounds.length > 1) {
		const calibrationLesson = reflectReviewerCalibration(runId, reviewRounds);
		if (calibrationLesson) lessons.push(calibrationLesson);
	}

	if (!approved) {
		// Unlike plan-reviewer, code that never earned approval is not shipped —
		// the stakes of committed, unreviewed code are higher than an unapproved
		// document. Roll back and stop the whole execute run.
		revertFiles(repoRoot, listDirtyFiles(repoRoot));
		return {
			sliceIndex,
			kind: 'tdd-pair',
			testFile: slice.testFile,
			outcome: 'escalated',
			durationMs: Date.now() - start,
			attempts: { testWriter: testWriterRun.result.attempts, coder: totalCoderAttempts },
			usage,
			lessons,
			review: reviewRounds,
			committed: false
		};
	}

	const filesToCommit = listDirtyFiles(repoRoot);
	commitFiles(repoRoot, filesToCommit, `feat: ${slice.implDecision.slice(0, 72)}`);

	return {
		sliceIndex,
		kind: 'tdd-pair',
		testFile: slice.testFile,
		outcome: 'ok',
		durationMs: Date.now() - start,
		attempts: { testWriter: testWriterRun.result.attempts, coder: totalCoderAttempts },
		usage,
		lessons,
		review: reviewRounds,
		committed: true
	};
}

function toRunTraceLike(execTrace: ExecuteTrace): RunTrace {
	return {
		runId: execTrace.runId,
		task: `execute: ${execTrace.planPath}`,
		stages: execTrace.slices.map((s) => ({
			name:
				s.kind === 'manual'
					? `slice ${s.sliceIndex} (manual — needs your attention)`
					: `slice ${s.sliceIndex}: ${s.testFile}`,
			attempts: s.attempts.testWriter + s.attempts.coder,
			outcome: s.outcome,
			durationMs: s.durationMs,
			usage: s.usage,
			lessons: s.lessons,
			review: s.review
		})),
		totals: execTrace.totals,
		outcome: execTrace.outcome,
		injected: false
	};
}

function computeExecuteOutcome(slices: SliceTrace[]): ExecuteTrace['outcome'] {
	return slices.some((s) => s.outcome === 'escalated') ? 'escalated' : 'ok';
}

function computeExecuteTotals(slices: SliceTrace[]): ExecuteTrace['totals'] {
	const totals = { costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
	for (const s of slices) {
		mergeUsage(totals, s.usage);
		totals.durationMs += s.durationMs;
	}
	return totals;
}

function main(): void {
	const planPath = process.argv[2];
	if (!planPath || !existsSync(planPath)) {
		console.error('Usage: node execute.ts <path-to-plan.json>');
		process.exit(1);
	}

	const branch = currentBranch(REPO_ROOT);
	if (branch === 'main') {
		console.error('Refusing to run: currently on main. Check out a feature branch first.');
		process.exit(1);
	}
	if (!isWorkingTreeClean(REPO_ROOT)) {
		console.error('Refusing to run: working tree is not clean. Commit or stash first.');
		process.exit(1);
	}

	const plan: Plan = JSON.parse(readFileSync(planPath, 'utf-8'));
	if (!isPlan(plan)) {
		console.error('The file at the given path is not a valid Plan.');
		process.exit(1);
	}

	const runDir = dirname(planPath);
	const runId = basename(runDir);
	const slices = classifySlices(plan.decisions);

	const sliceTraces: SliceTrace[] = [];
	let escalated = false;

	slices.forEach((slice, sliceIndex) => {
		if (escalated) return;
		if (slice.kind === 'manual') {
			sliceTraces.push({
				sliceIndex,
				kind: 'manual',
				outcome: 'skipped',
				durationMs: 0,
				attempts: { testWriter: 0, coder: 0 },
				usage: emptyUsage(),
				lessons: [],
				review: [],
				committed: false
			});
			return;
		}

		console.log(`slice ${sliceIndex}: ${slice.testFile} ...`);
		const trace = runSlice({ repoRoot: REPO_ROOT, runId, sliceIndex, slice, exec: runCommand });
		sliceTraces.push(trace);
		if (trace.outcome === 'escalated') escalated = true;
	});

	let finalVerify: ExecuteTrace['finalVerify'];
	if (!escalated) {
		const failedCommands: string[] = [];
		for (const command of plan.verifyCommands) {
			const [bin, ...args] = command.split(' ');
			// Force `yarn run <script>` over bare `yarn <script>`: Yarn Classic
			// 1.x reserves some script names (e.g. "check") as built-in commands
			// that silently shadow a same-named package.json script otherwise.
			const finalArgs = bin === 'yarn' && args[0] !== 'run' ? ['run', ...args] : args;
			const result = runCommand(bin, finalArgs, REPO_ROOT);
			if (!result.ok) failedCommands.push(command);
		}
		finalVerify = { ok: failedCommands.length === 0, failedCommands };
	}

	const executeTrace: ExecuteTrace = {
		runId,
		planPath,
		branch,
		slices: sliceTraces,
		finalVerify,
		totals: computeExecuteTotals(sliceTraces),
		outcome:
			escalated || finalVerify?.ok === false ? 'escalated' : computeExecuteOutcome(sliceTraces)
	};

	writeFileSync(join(runDir, 'execute-summary.json'), JSON.stringify(executeTrace, null, 2));
	writeFileSync(
		join(runDir, 'execute-report.html'),
		renderReportHtml(toRunTraceLike(executeTrace))
	);

	if (escalated) {
		console.error(
			`Execution stopped — see runs/${runId}/execute-report.html for what completed before the escalation.`
		);
		process.exit(1);
	}
	if (finalVerify && !finalVerify.ok) {
		console.error(
			`All slices passed individually, but the final full verify failed: ${finalVerify.failedCommands.join(', ')}`
		);
		process.exit(1);
	}
	console.log(`Execution complete — see runs/${runId}/execute-report.html`);
}

main();
