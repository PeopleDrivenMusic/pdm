import { describe, expect, it } from 'vitest';
import { callAgent, describeSpawnResult } from './callAgent.ts';
import type { AgentConfig } from './callAgent.ts';

const config: AgentConfig = {
	model: 'claude-sonnet-5',
	allowedTools: ['Read', 'Grep', 'Glob'],
	appendSystemPrompt: 'You are the spec agent.',
	permissionMode: 'plan'
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

	it('folds cache_read/cache_creation input tokens into inputTokens (most of a real turn is cached context, not fresh input)', () => {
		// Live probe (2026-09-03): a real call returned usage.input_tokens: 2 but
		// cache_read_input_tokens: 17972 and cache_creation_input_tokens: 29109 —
		// counting only input_tokens would report a $0.12 call as costing ~2 tokens
		// of input, which is misleading for a per-run cost/token report.
		const stdout = JSON.stringify({
			is_error: false,
			result: 'OK',
			total_cost_usd: 0.12,
			usage: {
				input_tokens: 2,
				cache_read_input_tokens: 17972,
				cache_creation_input_tokens: 29109,
				output_tokens: 4
			}
		});
		const result = callAgent(config, 'Reply with OK', fakeExec(stdout));
		expect(result).toEqual({
			ok: true,
			text: 'OK',
			costUsd: 0.12,
			inputTokens: 2 + 17972 + 29109,
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

	it('passes --model, --allowedTools, --permission-mode, and --append-system-prompt through to the exec function', () => {
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

	it('always passes --restricted, regardless of permission mode', () => {
		// Live-verified (2026-09-07): --allowedTools alone does NOT block
		// PowerShell/Bash once permission-mode is anything other than "plan" —
		// a real acceptEdits call ran a shell command with zero permission
		// denials despite Bash/PowerShell never being in --allowedTools.
		// --restricted is what actually removes code-execution tools unless
		// named explicitly, and none of this pipeline's agents should ever
		// have one — the orchestrator runs every real command, never the agent.
		const seenArgs: string[][] = [];
		const exec = (args: string[]) => {
			seenArgs.push(args);
			return JSON.stringify({ is_error: false, result: 'OK', total_cost_usd: 0, usage: {} });
		};
		callAgent({ ...config, permissionMode: 'acceptEdits' }, 'the prompt', exec);
		expect(seenArgs[0]).toContain('--restricted');
	});

	it('passes the configured permissionMode, not a hardcoded one', () => {
		const seenArgs: string[][] = [];
		const exec = (args: string[]) => {
			seenArgs.push(args);
			return JSON.stringify({ is_error: false, result: 'OK', total_cost_usd: 0, usage: {} });
		};
		callAgent({ ...config, permissionMode: 'acceptEdits' }, 'the prompt', exec);
		const args = seenArgs[0];
		const modeIndex = args.indexOf('--permission-mode');
		expect(args[modeIndex + 1]).toBe('acceptEdits');
	});
});

describe('describeSpawnResult', () => {
	// Live bug (2026-09-07): a real headless run had 3 attempts fail with zero
	// cost/tokens and an empty reflection — execClaude was silently collapsing
	// a spawn-level failure to '', so callAgent could only ever report "CLI
	// stdout was not valid JSON: " with nothing after the colon.
	it('surfaces the spawn error when the process never started', () => {
		const text = describeSpawnResult({ stdout: null, stderr: null, error: new Error('EAGAIN') });
		expect(text).toContain('EAGAIN');
	});

	it('surfaces stderr when the process ran but produced no stdout', () => {
		const text = describeSpawnResult({ stdout: null, stderr: 'permission denied' });
		expect(text).toContain('permission denied');
	});

	it('returns stdout unchanged when present, ignoring stderr/error', () => {
		expect(describeSpawnResult({ stdout: '{"ok":true}', stderr: 'some warning' })).toBe(
			'{"ok":true}'
		);
	});

	it('returns an empty string when there is truly nothing to report', () => {
		expect(describeSpawnResult({ stdout: null, stderr: null })).toBe('');
	});
});
