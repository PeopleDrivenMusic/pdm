import { describe, expect, it } from 'vitest';
import { addUsage, emptyUsage, mergeUsage } from './usage.ts';

describe('usage helpers', () => {
	it('emptyUsage starts at all zeros', () => {
		expect(emptyUsage()).toEqual({ costUsd: 0, inputTokens: 0, outputTokens: 0 });
	});

	it('addUsage accumulates a successful callAgent result into a target', () => {
		const target = emptyUsage();
		addUsage(target, { ok: true, text: 'x', costUsd: 0.1, inputTokens: 100, outputTokens: 20 });
		addUsage(target, { ok: true, text: 'y', costUsd: 0.2, inputTokens: 50, outputTokens: 10 });
		expect(target.costUsd).toBeCloseTo(0.3);
		expect(target.inputTokens).toBe(150);
		expect(target.outputTokens).toBe(30);
	});

	it('mergeUsage adds one usage total into another', () => {
		const target = { costUsd: 1, inputTokens: 10, outputTokens: 2 };
		mergeUsage(target, { costUsd: 0.5, inputTokens: 5, outputTokens: 1 });
		expect(target).toEqual({ costUsd: 1.5, inputTokens: 15, outputTokens: 3 });
	});
});
