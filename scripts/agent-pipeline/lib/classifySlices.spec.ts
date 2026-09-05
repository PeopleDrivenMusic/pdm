import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifySlices } from './classifySlices.ts';

describe('classifySlices — synthetic cases', () => {
	it('pairs a Write-test decision with the next Implement decision', () => {
		const decisions = [
			'Write `src/foo.spec.ts` first, covering the happy path.',
			'Implement `src/foo.ts` to make the spec pass.'
		];
		expect(classifySlices(decisions)).toEqual([
			{
				kind: 'tdd-pair',
				testDecisionIndex: 0,
				testDecision: decisions[0],
				implDecisionIndex: 1,
				implDecision: decisions[1],
				testFile: 'src/foo.spec.ts'
			}
		]);
	});

	it('treats a Write-test decision not followed by an Implement decision as test-only (self-paired)', () => {
		const decisions = [
			'Write `src/foo.spec.ts` first, covering the happy path.',
			'Write `src/bar.spec.ts` first, covering another case.'
		];
		const slices = classifySlices(decisions);
		expect(slices).toHaveLength(2);
		expect(slices[0]).toEqual({
			kind: 'tdd-pair',
			testDecisionIndex: 0,
			testDecision: decisions[0],
			implDecisionIndex: 0,
			implDecision: decisions[0],
			testFile: 'src/foo.spec.ts'
		});
	});

	it('classifies a decision with no test file and no imperative verb as manual', () => {
		const decisions = ['Do not call invalidateAll() anywhere in the new navigation path.'];
		expect(classifySlices(decisions)).toEqual([
			{ kind: 'manual', decisionIndex: 0, decision: decisions[0] }
		]);
	});

	it('classifies an orphan Implement decision (no preceding test) as manual, not auto-paired', () => {
		const decisions = [
			'Do not call invalidateAll() anywhere in the new navigation path.',
			'Move `+page.svelte` to the new location.'
		];
		const slices = classifySlices(decisions);
		expect(slices).toEqual([
			{ kind: 'manual', decisionIndex: 0, decision: decisions[0] },
			{ kind: 'manual', decisionIndex: 1, decision: decisions[1] }
		]);
	});

	it('covers every decision index exactly once', () => {
		const decisions = [
			'Write `a.spec.ts` first.',
			'Implement `a.ts`.',
			'Manual verification: click around.'
		];
		const slices = classifySlices(decisions);
		const covered = slices.flatMap((s) =>
			s.kind === 'tdd-pair' ? [s.testDecisionIndex, s.implDecisionIndex] : [s.decisionIndex]
		);
		expect(new Set(covered)).toEqual(new Set([0, 1, 2]));
	});
});

describe('classifySlices — the real approved plan', () => {
	const plan = JSON.parse(
		readFileSync(
			join(import.meta.dirname, '..', 'runs', '2026-09-04T02-23-31-790Z', 'plan.json'),
			'utf-8'
		)
	);
	const slices = classifySlices(plan.decisions);

	it('produces 6 real tdd-pairs, 2 test-only slices, and 4 manual slices', () => {
		const pairs = slices.filter(
			(s) => s.kind === 'tdd-pair' && s.testDecisionIndex !== s.implDecisionIndex
		);
		const testOnly = slices.filter(
			(s) => s.kind === 'tdd-pair' && s.testDecisionIndex === s.implDecisionIndex
		);
		const manual = slices.filter((s) => s.kind === 'manual');
		expect(pairs).toHaveLength(6);
		expect(testOnly).toHaveLength(2);
		expect(manual).toHaveLength(4);
	});

	it('extracts a real, existing-shaped test file path for every tdd-pair slice', () => {
		for (const s of slices) {
			if (s.kind === 'tdd-pair') {
				expect(s.testFile).toMatch(/\.(spec|test)\.ts$/);
			}
		}
	});

	it('covers all 18 decisions exactly once', () => {
		const covered = slices.flatMap((s) =>
			s.kind === 'tdd-pair' ? [s.testDecisionIndex, s.implDecisionIndex] : [s.decisionIndex]
		);
		expect(new Set(covered).size).toBe(plan.decisions.length);
	});
});
