import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groundingCheck } from './groundingCheck.ts';
import type { Plan } from '../types.ts';

describe('groundingCheck', () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), 'grounding-check-'));
		writeFileSync(join(repoRoot, 'three-lines.ts'), 'line1\nline2\nline3\n');
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	function planWithRefs(fileMap: Plan['fileMap']): Plan {
		return { decisions: ['x'], fileMap, verifyCommands: ['yarn check'] };
	}

	it('passes when every ref points at a real path and an in-range line', () => {
		const plan = planWithRefs([{ path: 'three-lines.ts', line: 2, reason: 'edit here' }]);
		expect(groundingCheck(plan, repoRoot)).toEqual({ ok: true });
	});

	it('fails when the path does not exist', () => {
		const plan = planWithRefs([{ path: 'does-not-exist.ts', line: 1, reason: 'x' }]);
		const result = groundingCheck(plan, repoRoot);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failedRefs).toEqual([{ path: 'does-not-exist.ts', line: 1, reason: 'x' }]);
			expect(result.reason).toContain('does-not-exist.ts');
		}
	});

	it('fails when the line number is past the end of a real file', () => {
		const plan = planWithRefs([{ path: 'three-lines.ts', line: 99, reason: 'x' }]);
		const result = groundingCheck(plan, repoRoot);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failedRefs).toEqual([{ path: 'three-lines.ts', line: 99, reason: 'x' }]);
		}
	});

	it('reports every failing ref, not just the first', () => {
		const plan = planWithRefs([
			{ path: 'three-lines.ts', line: 1, reason: 'ok ref' },
			{ path: 'missing-a.ts', line: 1, reason: 'x' },
			{ path: 'missing-b.ts', line: 1, reason: 'x' }
		]);
		const result = groundingCheck(plan, repoRoot);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failedRefs).toHaveLength(2);
			expect(result.failedRefs.map((r) => r.path)).toEqual(['missing-a.ts', 'missing-b.ts']);
		}
	});

	it('rejects a path that escapes repoRoot via ..', () => {
		const plan = planWithRefs([{ path: '../outside.ts', line: 1, reason: 'x' }]);
		const result = groundingCheck(plan, repoRoot);
		expect(result.ok).toBe(false);
	});
});
