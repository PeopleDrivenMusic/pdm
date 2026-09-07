import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLearnings } from './learnings.ts';
import type { AgentConfig } from './callAgent.ts';

export function loadAgent(agentDir: string): AgentConfig {
	const rawConfig = JSON.parse(readFileSync(join(agentDir, 'config.json'), 'utf-8')) as {
		model: string;
		allowedTools: string[];
		permissionMode: string;
	};
	const systemPrompt = readFileSync(join(agentDir, 'system-prompt.md'), 'utf-8');
	const learnings = parseLearnings(readFileSync(join(agentDir, 'learnings.md'), 'utf-8'));

	const appendSystemPrompt =
		learnings.active.length === 0
			? systemPrompt
			: systemPrompt +
				'\n\nLearned rules from past runs:\n' +
				learnings.active.map((a) => `- ${a.rule}`).join('\n');

	return {
		model: rawConfig.model,
		allowedTools: rawConfig.allowedTools,
		permissionMode: rawConfig.permissionMode,
		appendSystemPrompt
	};
}
