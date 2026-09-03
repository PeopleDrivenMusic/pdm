import { spawnSync } from 'node:child_process';

export type AgentConfig = {
	model: string;
	allowedTools: string[];
	appendSystemPrompt: string;
};

export type CallAgentResult =
	| { ok: true; text: string; costUsd: number; inputTokens: number; outputTokens: number }
	| { ok: false; reason: string };

export type ExecFn = (args: string[]) => string;

// spawnSync, not execFileSync: live probe (2026-09-03, CLI 2.1.258) showed a
// call denied a tool write returns is_error:false in its JSON body but exit
// code 2 — execFileSync would throw on that exit code before we could read
// the JSON. spawnSync never throws on a nonzero exit; we always parse stdout
// and never look at the exit code.
export function execClaude(args: string[]): string {
	const result = spawnSync('claude', args, { encoding: 'utf-8' });
	return result.stdout ?? '';
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
		'plan',
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
	return {
		ok: true,
		text: typeof parsed.result === 'string' ? parsed.result : '',
		costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
		inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
		outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
	};
}
