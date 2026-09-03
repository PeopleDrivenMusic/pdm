import { describe, expect, it } from 'vitest';
import { isPlan, isPlanFileRef, isSpec } from './types.ts';

describe('isSpec', () => {
	it('accepts a well-formed spec', () => {
		expect(
			isSpec({
				problem: 'Tabs are client-only state, not URL-addressable.',
				requirements: ['Shareable per-view URLs', 'No refetch on nav'],
				outOfScope: ['SSR streaming'],
				filesLikely: ['src/routes/(app)/artist/[slug]/+page.svelte']
			})
		).toBe(true);
	});

	it('rejects a spec with an empty problem string', () => {
		expect(isSpec({ problem: '  ', requirements: ['x'], outOfScope: [], filesLikely: ['a'] })).toBe(
			false
		);
	});

	it('rejects a spec with zero requirements', () => {
		expect(isSpec({ problem: 'x', requirements: [], outOfScope: [], filesLikely: ['a'] })).toBe(
			false
		);
	});

	it('rejects a spec with zero filesLikely', () => {
		expect(isSpec({ problem: 'x', requirements: ['x'], outOfScope: [], filesLikely: [] })).toBe(
			false
		);
	});

	it('allows an empty outOfScope array', () => {
		expect(isSpec({ problem: 'x', requirements: ['x'], outOfScope: [], filesLikely: ['a'] })).toBe(
			true
		);
	});

	it('rejects non-object input', () => {
		expect(isSpec(null)).toBe(false);
		expect(isSpec('spec')).toBe(false);
		expect(isSpec(undefined)).toBe(false);
	});

	it('rejects a spec missing a required field', () => {
		expect(isSpec({ requirements: ['x'], outOfScope: [], filesLikely: ['a'] })).toBe(false);
	});
});

describe('isPlanFileRef', () => {
	it('accepts a well-formed ref', () => {
		expect(isPlanFileRef({ path: 'src/foo.ts', line: 12, reason: 'add guard here' })).toBe(true);
	});

	it('rejects a zero or negative line number', () => {
		expect(isPlanFileRef({ path: 'src/foo.ts', line: 0, reason: 'x' })).toBe(false);
		expect(isPlanFileRef({ path: 'src/foo.ts', line: -1, reason: 'x' })).toBe(false);
	});

	it('rejects a non-integer line number', () => {
		expect(isPlanFileRef({ path: 'src/foo.ts', line: 1.5, reason: 'x' })).toBe(false);
	});

	it('rejects an empty path', () => {
		expect(isPlanFileRef({ path: '', line: 1, reason: 'x' })).toBe(false);
	});
});

describe('isPlan', () => {
	const validRef = { path: 'src/foo.ts', line: 12, reason: 'add guard here' };

	it('accepts a well-formed plan', () => {
		expect(
			isPlan({
				decisions: ['Use nested route layout'],
				fileMap: [validRef],
				verifyCommands: ['yarn check', 'yarn test:unit -- --run']
			})
		).toBe(true);
	});

	it('rejects a plan with zero decisions', () => {
		expect(isPlan({ decisions: [], fileMap: [validRef], verifyCommands: ['yarn check'] })).toBe(
			false
		);
	});

	it('rejects a plan with zero fileMap entries', () => {
		expect(isPlan({ decisions: ['x'], fileMap: [], verifyCommands: ['yarn check'] })).toBe(false);
	});

	it('rejects a plan with an invalid fileMap entry', () => {
		expect(
			isPlan({
				decisions: ['x'],
				fileMap: [{ path: 'src/foo.ts', line: 0, reason: 'x' }],
				verifyCommands: ['yarn check']
			})
		).toBe(false);
	});

	it('rejects a plan with zero verifyCommands', () => {
		expect(isPlan({ decisions: ['x'], fileMap: [validRef], verifyCommands: [] })).toBe(false);
	});
});
