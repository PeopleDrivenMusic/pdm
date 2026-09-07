import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitDecisionCases } from './splitDecisionCases.ts';

describe('splitDecisionCases — synthetic', () => {
	it('returns null when there is no case-list trigger word', () => {
		expect(splitDecisionCases('Implement `foo.ts` per the above.')).toBeNull();
	});

	it('returns null when only one case follows the trigger (nothing to separate)', () => {
		expect(splitDecisionCases('Write `x.spec.ts` first, covering: the happy path.')).toBeNull();
	});

	it('splits a semicolon-separated case list after "covering:"', () => {
		const result = splitDecisionCases(
			'Write `x.spec.ts` first, covering: throws when input is null; returns true for a valid id.'
		);
		expect(result).toEqual({
			intro: 'Write `x.spec.ts` first',
			cases: ['throws when input is null', 'returns true for a valid id.']
		});
	});

	it('does not split on a semicolon inside parentheses', () => {
		const result = splitDecisionCases(
			'Write `x.spec.ts` first, covering: calls `foo()` (see `bar.ts:1`); calls `baz()` once.'
		);
		expect(result?.cases).toEqual(['calls `foo()` (see `bar.ts:1`)', 'calls `baz()` once.']);
	});

	it('handles lettered (a)/(b)/(c) case markers after "Cases:"', () => {
		const result = splitDecisionCases(
			'Write `x.spec.ts` first. Cases: (a) cache miss calls fetch; (b) cache hit skips fetch.'
		);
		expect(result?.cases).toEqual(['(a) cache miss calls fetch', '(b) cache hit skips fetch.']);
	});
});

describe('splitDecisionCases — the real approved plan', () => {
	const plan = JSON.parse(
		readFileSync(
			join(import.meta.dirname, '..', 'runs', '2026-09-04T02-23-31-790Z', 'plan.json'),
			'utf-8'
		)
	);

	it('extracts 3+ cases from the layout.server.spec.ts decision (decision 1)', () => {
		const result = splitDecisionCases(plan.decisions[0]);
		expect(result).not.toBeNull();
		expect(result!.cases.length).toBeGreaterThanOrEqual(3);
		expect(result!.cases[0]).toContain('throws 404');
	});

	it('extracts the lettered (a)-(d) cases from the [view]/+page.ts load decision', () => {
		const result = splitDecisionCases(plan.decisions[10]);
		expect(result).not.toBeNull();
		expect(result!.cases).toHaveLength(4);
		expect(result!.cases[0]).toContain('(a)');
		expect(result!.cases[3]).toContain('(d)');
	});

	it('returns null for a pure implementation decision with no case list', () => {
		expect(splitDecisionCases(plan.decisions[1])).toBeNull();
	});
});
