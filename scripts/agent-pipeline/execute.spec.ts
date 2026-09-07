import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeDirtyFiles, loadPreviousSliceTrace } from './execute.ts';
import type { ExecuteTrace } from './types.ts';

describe('loadPreviousSliceTrace', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'execute-resume-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('returns undefined when no previous summary file exists — resume must fail loudly, not silently skip', () => {
		expect(loadPreviousSliceTrace(join(dir, 'execute-summary.json'), 0)).toBeUndefined();
	});

	it('returns the trace for the given slice index from a previous run', () => {
		const summaryPath = join(dir, 'execute-summary.json');
		const previous: ExecuteTrace = {
			runId: 'r1',
			planPath: 'plan.json',
			branch: 'feature',
			slices: [
				{
					sliceIndex: 0,
					kind: 'tdd-pair',
					testFile: 'a.spec.ts',
					outcome: 'ok',
					durationMs: 100,
					attempts: { testWriter: 1, coder: 1 },
					usage: { costUsd: 0.1, inputTokens: 10, outputTokens: 5 },
					lessons: [],
					review: [{ round: 1, verdict: 'approved', commentCount: 0, comments: [] }],
					committed: true
				}
			],
			totals: { costUsd: 0.1, inputTokens: 10, outputTokens: 5, durationMs: 100 },
			outcome: 'ok'
		};
		writeFileSync(summaryPath, JSON.stringify(previous, null, 2));

		const carried = loadPreviousSliceTrace(summaryPath, 0);
		expect(carried).toEqual(previous.slices[0]);
	});

	it('returns undefined for an index the previous run never reached', () => {
		const summaryPath = join(dir, 'execute-summary.json');
		writeFileSync(
			summaryPath,
			JSON.stringify({
				runId: 'r1',
				planPath: 'plan.json',
				branch: 'feature',
				slices: [],
				totals: { costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 },
				outcome: 'ok'
			})
		);

		expect(loadPreviousSliceTrace(summaryPath, 0)).toBeUndefined();
	});
});

describe('codeDirtyFiles', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'code-dirty-files-'));
		execFileSync('git', ['init', '--initial-branch=main'], { cwd: repo });
		execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
		execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
	});

	afterEach(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	// Real bug (2026-09-07): a real coder escalation had reflectOnRetry write a
	// genuine lesson to agents/coder/learnings.md, then the escalation's own
	// `revertFiles(repoRoot, listDirtyFiles(repoRoot))` wiped it right back out
	// because it re-queried every dirty file in the repo, learnings.md included
	// — self-improvement could never survive the exact failures it exists to
	// learn from.
	it('excludes an agent learnings.md file from the dirty-file list', () => {
		// learnings.md must already be tracked, matching the real repo (agent
		// directories are committed) — an untracked new directory collapses to
		// one "dir/" entry in git status, which would trivially "pass" without
		// exercising the real modified-tracked-file path this bug happened on.
		mkdirSync(join(repo, 'scripts/agent-pipeline/agents/coder'), { recursive: true });
		writeFileSync(join(repo, 'scripts/agent-pipeline/agents/coder/learnings.md'), 'initial\n');
		execFileSync('git', ['add', '.'], { cwd: repo });
		execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo });

		writeFileSync(join(repo, 'scripts/agent-pipeline/agents/coder/learnings.md'), 'a lesson\n');
		writeFileSync(join(repo, 'real-code.ts'), 'export const x = 1;\n');

		expect(codeDirtyFiles(repo).sort()).toEqual(['real-code.ts']);
	});

	it('still reports real code changes when no learnings file is dirty', () => {
		writeFileSync(join(repo, 'real-code.ts'), 'export const x = 1;\n');
		expect(codeDirtyFiles(repo)).toEqual(['real-code.ts']);
	});
});
