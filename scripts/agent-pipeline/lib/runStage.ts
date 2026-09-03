import type { GateResult } from '../types.ts';
import type { CallAgentResult } from './callAgent.ts';

export type StageResult<T> =
	| { ok: true; output: T; attempts: number }
	| { ok: false; attempts: number; lastOutput: T | undefined; lastError: string };

export function runStage<T>(params: {
	maxAttempts: number;
	callAgent: (prompt: string) => CallAgentResult;
	buildPrompt: (lastError?: string) => string;
	parseAndValidate: (text: string) => { ok: true; value: T } | { ok: false; reason: string };
	gate: (value: T) => GateResult;
}): StageResult<T> {
	let lastError: string | undefined;
	let lastOutput: T | undefined;

	for (let attempt = 1; attempt <= params.maxAttempts; attempt++) {
		const prompt = params.buildPrompt(lastError);
		const agentResult = params.callAgent(prompt);

		if (!agentResult.ok) {
			lastError = agentResult.reason;
			continue;
		}

		const parsed = params.parseAndValidate(agentResult.text);
		if (!parsed.ok) {
			lastError = parsed.reason;
			continue;
		}

		lastOutput = parsed.value;
		const gateResult = params.gate(parsed.value);
		if (gateResult.ok) {
			return { ok: true, output: parsed.value, attempts: attempt };
		}
		lastError = gateResult.reason;
	}

	return {
		ok: false,
		attempts: params.maxAttempts,
		lastOutput,
		lastError: lastError ?? 'unknown error'
	};
}
