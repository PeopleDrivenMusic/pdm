import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reflect } from './reflect.ts';

describe('reflect', () => {
	let learningsPath: string;
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'reflect-'));
		learningsPath = join(dir, 'learnings.md');
		writeFileSync(
			learningsPath,
			'# plan-agent learnings\n\n## Active rules (promoted)\n\n## Candidates (pending promotion)\n'
		);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('records a new candidate when the reflection call returns a valid lesson', () => {
		const result = reflect({
			learningsPath,
			runId: 'runs/2026-09-03T00-00-00',
			prompt: 'reflect on the failure',
			callAgent: () => ({
				ok: true,
				text: JSON.stringify({
					triggerTag: 'stale-line-number',
					rule: 'Re-read the file right before citing a line'
				}),
				costUsd: 0,
				inputTokens: 0,
				outputTokens: 0
			})
		});

		expect(result).toEqual({
			fired: true,
			triggerTag: 'stale-line-number',
			rule: 'Re-read the file right before citing a line',
			promoted: false
		});
		const written = readFileSync(learningsPath, 'utf-8');
		expect(written).toContain('x1 stale-line-number');
	});

	it('reports promoted:true and writes it under Active rules once the count crosses the threshold', () => {
		writeFileSync(
			learningsPath,
			'# plan-agent learnings\n\n## Active rules (promoted)\n\n## Candidates (pending promotion)\n\n- x1 stale-line-number: Re-read before citing → runs/2026-09-01T00-00-00\n'
		);

		const result = reflect({
			learningsPath,
			runId: 'runs/2026-09-03T00-00-00',
			prompt: 'reflect on the failure',
			callAgent: () => ({
				ok: true,
				text: JSON.stringify({
					triggerTag: 'stale-line-number',
					rule: 'Re-read before citing'
				}),
				costUsd: 0,
				inputTokens: 0,
				outputTokens: 0
			})
		});

		expect(result).toEqual({
			fired: true,
			triggerTag: 'stale-line-number',
			rule: 'Re-read before citing',
			promoted: true
		});
		const written = readFileSync(learningsPath, 'utf-8');
		expect(written).toContain('Re-read before citing (survived x1)');
		expect(written).not.toContain('stale-line-number:');
	});

	it('leaves the file untouched and reports fired:false when the reflection call itself fails', () => {
		const before = readFileSync(learningsPath, 'utf-8');
		const result = reflect({
			learningsPath,
			runId: 'runs/A',
			prompt: 'reflect',
			callAgent: () => ({ ok: false, reason: 'CLI error' })
		});
		expect(result).toEqual({ fired: false });
		expect(readFileSync(learningsPath, 'utf-8')).toBe(before);
	});

	it('leaves the file untouched and reports fired:false when the response is not valid {triggerTag, rule} JSON', () => {
		const before = readFileSync(learningsPath, 'utf-8');
		const result = reflect({
			learningsPath,
			runId: 'runs/A',
			prompt: 'reflect',
			callAgent: () => ({ ok: true, text: 'not json', costUsd: 0, inputTokens: 0, outputTokens: 0 })
		});
		expect(result).toEqual({ fired: false });
		expect(readFileSync(learningsPath, 'utf-8')).toBe(before);
	});
});
