import { spawnSync } from 'node:child_process';

export type AgentConfig = {
	model: string;
	allowedTools: string[];
	appendSystemPrompt: string;
	/** 'plan' for read-only agents (spec/plan/reviewers) — blocks all writes.
	 * 'acceptEdits' for agents that must actually write files (test-writer,
	 * coder) — allows Write/Edit through without a per-call prompt. */
	permissionMode: string;
};

export type CallAgentResult =
	| { ok: true; text: string; costUsd: number; inputTokens: number; outputTokens: number }
	| { ok: false; reason: string };

export type ExecFn = (args: string[]) => string;

/** Turns a spawnSync-shaped result into the string callAgent parses as JSON — pulled out of execClaude so the fallback branches (spawn never started, or produced no stdout) are testable without a real subprocess. */
export function describeSpawnResult(result: {
	stdout: string | null;
	stderr: string | null;
	error?: Error;
}): string {
	if (result.error) return `[claude CLI failed to start: ${result.error.message}]`;
	if (result.stdout) return result.stdout;
	if (result.stderr) {
		return `[claude CLI produced no stdout; stderr: ${result.stderr.slice(0, 500)}]`;
	}
	return '';
}

// spawnSync, not execFileSync: live probe (2026-09-03, CLI 2.1.258) showed a
// call denied a tool write returns is_error:false in its JSON body but exit
// code 2 — execFileSync would throw on that exit code before we could read
// the JSON. spawnSync never throws on a nonzero exit; we always parse stdout
// and never look at the exit code.
export function execClaude(args: string[]): string {
	const result = spawnSync('claude', args, { encoding: 'utf-8' });
	return describeSpawnResult(result);
}

export function callAgent(config: AgentConfig, prompt: string, exec: ExecFn): CallAgentResult {
	const args = [
		'-p',
		prompt,
		'--output-format',
		'json',
		'--model',
		config.model,
		'--allowedTools',
		config.allowedTools.join(' '),
		'--permission-mode',
		config.permissionMode,
		// Live-verified (2026-09-07): --allowedTools alone does not remove
		// Bash/PowerShell once permission-mode isn't "plan" — a real
		// acceptEdits call ran a shell command with zero permission denials
		// despite never listing Bash. --restricted is the flag that actually
		// removes code-execution tools unless named explicitly; no agent in
		// this pipeline should ever run a real command itself (the
		// orchestrator does, so its output is grounded), so this is
		// unconditional, not configurable.
		'--restricted',
		'--append-system-prompt',
		config.appendSystemPrompt
	];

	const stdout = exec(args);

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return { ok: false, reason: `CLI stdout was not valid JSON: ${stdout.slice(0, 200)}` };
	}

	if (parsed.is_error) {
		return {
			ok: false,
			reason: typeof parsed.result === 'string' ? parsed.result : 'unknown error'
		};
	}

	const usage = (parsed.usage as Record<string, unknown>) ?? {};
	const num = (key: string): number =>
		typeof usage[key] === 'number' ? (usage[key] as number) : 0;
	// Most of a real turn's input is cached (system prompt, tool defs), not
	// "fresh" — usage.input_tokens alone undercounts by orders of magnitude
	// (a live probe: input_tokens:2 but cache_read_input_tokens:17972 on the
	// same $0.12 call). Sum all three so inputTokens reflects what was
	// actually read, matching what total_cost_usd already bills for.
	return {
		ok: true,
		text: typeof parsed.result === 'string' ? parsed.result : '',
		costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
		inputTokens:
			num('input_tokens') + num('cache_read_input_tokens') + num('cache_creation_input_tokens'),
		outputTokens: num('output_tokens')
	};
}
