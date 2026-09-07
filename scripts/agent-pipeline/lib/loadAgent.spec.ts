import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAgent } from './loadAgent.ts';

describe('loadAgent', () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), 'agent-'));
		writeFileSync(
			join(agentDir, 'config.json'),
			JSON.stringify({
				model: 'claude-sonnet-5',
				allowedTools: ['Read', 'Grep', 'Glob'],
				permissionMode: 'plan'
			})
		);
		writeFileSync(join(agentDir, 'system-prompt.md'), 'You are the plan agent.');
	});

	afterEach(() => {
		rmSync(agentDir, { recursive: true, force: true });
	});

	it('uses the base system prompt as-is when there are no active learnings', () => {
		writeFileSync(
			join(agentDir, 'learnings.md'),
			'# plan-agent learnings\n\n## Active rules (promoted)\n\n## Candidates (pending promotion)\n'
		);
		const config = loadAgent(agentDir);
		expect(config).toEqual({
			model: 'claude-sonnet-5',
			allowedTools: ['Read', 'Grep', 'Glob'],
			permissionMode: 'plan',
			appendSystemPrompt: 'You are the plan agent.'
		});
	});

	it('appends promoted active rules to the base system prompt', () => {
		writeFileSync(
			join(agentDir, 'learnings.md'),
			'# plan-agent learnings\n\n## Active rules (promoted)\n\n- Always cite an existing file, never one the plan itself creates (survived x2)\n\n## Candidates (pending promotion)\n'
		);
		const config = loadAgent(agentDir);
		expect(config.appendSystemPrompt).toBe(
			'You are the plan agent.\n\nLearned rules from past runs:\n- Always cite an existing file, never one the plan itself creates'
		);
	});
});
