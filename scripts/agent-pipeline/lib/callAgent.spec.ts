import { describe, expect, it } from 'vitest';
import { callAgent } from './callAgent.ts';
import type { AgentConfig } from './callAgent.ts';

const config: AgentConfig = {
	model: 'claude-sonnet-5',
	allowedTools: ['Read', 'Grep', 'Glob'],
	appendSystemPrompt: 'You are the spec agent.'
};

function fakeExec(stdout: string) {
	return (_args: string[]) => stdout;
}

describe('callAgent', () => {
	it('returns ok:true with text/cost/tokens on a successful CLI response, regardless of exit-code semantics', () => {
		// Live probe (2026-09-03, CLI 2.1.258): a call with a denied tool returned
		// is_error:false / subtype:"success" but shell exit code 2 — callAgent must
		// key off the JSON body, never a process exit code, so this test only ever
		// hands it a string (no exit-code channel exists to get this wrong).
		const stdout = JSON.stringify({
			is_error: false,
			subtype: 'success',
			result: 'OK',
			total_cost_usd: 0.12,
			usage: { input_tokens: 2, output_tokens: 4 }
		});
		const result = callAgent(config, 'Reply with OK', fakeExec(stdout));
		expect(result).toEqual({
			ok: true,
			text: 'OK',
			costUsd: 0.12,
			inputTokens: 2,
			outputTokens: 4
		});
	});

	it('returns ok:false when the CLI body reports is_error:true', () => {
		const stdout = JSON.stringify({
			is_error: true,
			subtype: 'error_max_turns',
			result: 'Ran out of turns'
		});
		const result = callAgent(config, 'do something', fakeExec(stdout));
		expect(result).toEqual({ ok: false, reason: 'Ran out of turns' });
	});

	it('returns ok:false when stdout is not valid JSON', () => {
		const result = callAgent(config, 'do something', fakeExec('not json'));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('JSON');
	});

	it('passes --model, --allowedTools, and --append-system-prompt through to the exec function', () => {
		const seenArgs: string[][] = [];
		const exec = (args: string[]) => {
			seenArgs.push(args);
			return JSON.stringify({ is_error: false, result: 'OK', total_cost_usd: 0, usage: {} });
		};
		callAgent(config, 'the prompt', exec);
		const args = seenArgs[0];
		expect(args).toContain('the prompt');
		expect(args).toContain('--model');
		expect(args).toContain('claude-sonnet-5');
		expect(args).toContain('--allowedTools');
		expect(args).toContain('Read Grep Glob');
		expect(args).toContain('--append-system-prompt');
		expect(args).toContain('You are the spec agent.');
		expect(args).toContain('--permission-mode');
		expect(args).toContain('plan');
	});
});
