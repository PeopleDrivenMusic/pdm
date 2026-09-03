import { describe, expect, it } from 'vitest';
import { runStage } from './runStage.ts';

type Widget = { value: number };

function alwaysValid(value: unknown) {
	return { ok: true as const, value: value as Widget };
}

describe('runStage', () => {
	it('succeeds on the first attempt when parse and gate both pass', () => {
		let promptCalls = 0;
		const result = runStage<Widget>({
			maxAttempts: 3,
			callAgent: () => {
				promptCalls++;
				return { ok: true, text: '{"value":1}', costUsd: 0, inputTokens: 0, outputTokens: 0 };
			},
			buildPrompt: () => 'prompt',
			parseAndValidate: (text) => alwaysValid(JSON.parse(text)),
			gate: () => ({ ok: true })
		});
		expect(promptCalls).toBe(1);
		expect(result).toEqual({ ok: true, output: { value: 1 }, attempts: 1 });
	});

	it('retries with the gate error appended to the prompt, then succeeds', () => {
		let attempt = 0;
		const promptsSeen: (string | undefined)[] = [];
		const result = runStage<Widget>({
			maxAttempts: 3,
			callAgent: () => {
				attempt++;
				return {
					ok: true,
					text: attempt === 1 ? '{"value":-1}' : '{"value":1}',
					costUsd: 0,
					inputTokens: 0,
					outputTokens: 0
				};
			},
			buildPrompt: (lastError) => {
				promptsSeen.push(lastError);
				return 'prompt';
			},
			parseAndValidate: (text) => alwaysValid(JSON.parse(text)),
			gate: (value) =>
				value.value > 0
					? { ok: true }
					: { ok: false, reason: 'value must be positive', failedRefs: [] }
		});
		expect(result).toEqual({ ok: true, output: { value: 1 }, attempts: 2 });
		expect(promptsSeen).toEqual([undefined, 'value must be positive']);
	});

	it('escalates after exhausting maxAttempts, carrying the last output and error', () => {
		const result = runStage<Widget>({
			maxAttempts: 3,
			callAgent: () => ({
				ok: true,
				text: '{"value":-1}',
				costUsd: 0,
				inputTokens: 0,
				outputTokens: 0
			}),
			buildPrompt: () => 'prompt',
			parseAndValidate: (text) => alwaysValid(JSON.parse(text)),
			gate: () => ({ ok: false, reason: 'value must be positive', failedRefs: [] })
		});
		expect(result).toEqual({
			ok: false,
			attempts: 3,
			lastOutput: { value: -1 },
			lastError: 'value must be positive'
		});
	});

	it('treats a schema-validation failure as a retriable error, not a crash', () => {
		let attempt = 0;
		const result = runStage<Widget>({
			maxAttempts: 2,
			callAgent: () => {
				attempt++;
				return {
					ok: true,
					text: attempt === 1 ? 'not json' : '{"value":1}',
					costUsd: 0,
					inputTokens: 0,
					outputTokens: 0
				};
			},
			buildPrompt: () => 'prompt',
			parseAndValidate: (text) => {
				try {
					return alwaysValid(JSON.parse(text));
				} catch {
					return { ok: false as const, reason: 'invalid JSON' };
				}
			},
			gate: () => ({ ok: true })
		});
		expect(result).toEqual({ ok: true, output: { value: 1 }, attempts: 2 });
	});

	it('escalates immediately when callAgent itself fails (e.g. CLI error), without crashing', () => {
		const result = runStage<Widget>({
			maxAttempts: 2,
			callAgent: () => ({ ok: false, reason: 'claude CLI exited unexpectedly' }),
			buildPrompt: () => 'prompt',
			parseAndValidate: (text) => alwaysValid(JSON.parse(text)),
			gate: () => ({ ok: true })
		});
		expect(result).toEqual({
			ok: false,
			attempts: 2,
			lastOutput: undefined,
			lastError: 'claude CLI exited unexpectedly'
		});
	});
});
