import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunTrace } from '../types.ts';

export function writeRunTrace(runDir: string, trace: RunTrace): void {
	writeFileSync(join(runDir, 'summary.json'), JSON.stringify(trace, null, 2));
}

export function writeEscalation(
	runDir: string,
	params: { stageName: string; reason: string; lastAttempt: unknown }
): void {
	const body = `# Escalation — stage "${params.stageName}"

## Reason

${params.reason}

## Last attempt

\`\`\`json
${JSON.stringify(params.lastAttempt, null, 2)}
\`\`\`
`;
	writeFileSync(join(runDir, 'escalation.md'), body);
}

export function writeReviewNotes(
	runDir: string,
	params: { rounds: number; comments: string[] }
): void {
	const body = `# Review notes — not approved after ${params.rounds} round(s)

The plan already passed \`groundingCheck\` (every citation is real), but
plan-reviewer did not sign off. The final call is yours:

${params.comments.map((c) => `- ${c}`).join('\n')}
`;
	writeFileSync(join(runDir, 'review-notes.md'), body);
}
