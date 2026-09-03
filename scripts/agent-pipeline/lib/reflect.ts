import { readFileSync, writeFileSync } from 'node:fs';
import { parseLearnings, recordCandidate, serializeLearnings } from './learnings.ts';
import type { CallAgentResult } from './callAgent.ts';

export type ReflectResult =
	| { fired: true; triggerTag: string; rule: string; promoted: boolean }
	| { fired: false };

function parseReflection(text: string): { triggerTag: string; rule: string } | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) return undefined;
	const v = parsed as Record<string, unknown>;
	if (typeof v.triggerTag !== 'string' || typeof v.rule !== 'string') return undefined;
	if (v.triggerTag.trim() === '' || v.rule.trim() === '') return undefined;
	return { triggerTag: v.triggerTag, rule: v.rule };
}

export function reflect(params: {
	learningsPath: string;
	runId: string;
	prompt: string;
	callAgent: (prompt: string) => CallAgentResult;
}): ReflectResult {
	const agentResult = params.callAgent(params.prompt);
	if (!agentResult.ok) return { fired: false };

	const lesson = parseReflection(agentResult.text);
	if (!lesson) return { fired: false };

	const before = parseLearnings(readFileSync(params.learningsPath, 'utf-8'));
	const after = recordCandidate(before, lesson.triggerTag, lesson.rule, params.runId);
	writeFileSync(params.learningsPath, serializeLearnings(after));

	return {
		fired: true,
		triggerTag: lesson.triggerTag,
		rule: lesson.rule,
		promoted: after.active.length > before.active.length
	};
}
