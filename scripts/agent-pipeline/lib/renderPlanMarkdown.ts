import { splitDecisionCases } from './splitDecisionCases.ts';
import type { Plan } from '../types.ts';

function renderDecisionLine(decision: string, index: number): string {
	const split = splitDecisionCases(decision);
	if (!split) return `${index + 1}. ${decision}`;
	const caseLines = split.cases.map((c) => `   - ${c}`).join('\n');
	return `${index + 1}. ${split.intro}:\n${caseLines}`;
}

export function renderPlanMarkdown(
	plan: Plan,
	review?: { approved: boolean; comments: string[] }
): string {
	const decisions = plan.decisions.map(renderDecisionLine).join('\n');

	const fileMapRows = plan.fileMap
		.map((r) => `| \`${r.path}\` | ${r.line} | ${r.reason} |`)
		.join('\n');
	const fileMapTable = `| Path | Line | Reason |\n| --- | --- | --- |\n${fileMapRows}`;

	const verifyBlock = '```\n' + plan.verifyCommands.join('\n') + '\n```';

	const reviewSection = review
		? `\n\n## Review notes\n\n${
				review.approved
					? '_Approved by plan-reviewer._'
					: `_Not approved by plan-reviewer — open questions below, final call is yours:_\n\n${review.comments
							.map((c) => `- ${c}`)
							.join('\n')}`
			}`
		: '';

	return `# Plan

## Decisions

${decisions}

## Files

${fileMapTable}

## Verify

${verifyBlock}${reviewSection}
`;
}
