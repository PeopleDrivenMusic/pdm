import type { Usage } from '../types.ts';
import type { CallAgentResult } from './callAgent.ts';

export function emptyUsage(): Usage {
	return { costUsd: 0, inputTokens: 0, outputTokens: 0 };
}

export function addUsage(target: Usage, r: Extract<CallAgentResult, { ok: true }>): void {
	target.costUsd += r.costUsd;
	target.inputTokens += r.inputTokens;
	target.outputTokens += r.outputTokens;
}

export function mergeUsage(target: Usage, src: Usage): void {
	target.costUsd += src.costUsd;
	target.inputTokens += src.inputTokens;
	target.outputTokens += src.outputTokens;
}
