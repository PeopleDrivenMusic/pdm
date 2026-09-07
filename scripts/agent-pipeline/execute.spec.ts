import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPreviousSliceTrace } from './execute.ts';
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
