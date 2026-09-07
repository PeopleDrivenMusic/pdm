import { describe, expect, it } from 'vitest';
import { renderPlanMarkdown } from './renderPlanMarkdown.ts';
import type { Plan } from '../types.ts';

const plan: Plan = {
	decisions: [
		'Add a nested route layout under /artist/[slug]/[view]',
		'Cache each loaded view client-side so navigating back never refetches it'
	],
	fileMap: [
		{ path: 'src/routes/(app)/artist/[slug]/+page.svelte', line: 22, reason: 'static tabs array' },
		{ path: 'src/lib/ui/Tabs.svelte', line: 67, reason: 'click() handler needs branching' }
	],
	verifyCommands: ['yarn check', 'yarn test:unit -- --run']
};

describe('renderPlanMarkdown', () => {
	it('numbers the decisions', () => {
		const md = renderPlanMarkdown(plan);
		expect(md).toContain('1. Add a nested route layout under /artist/[slug]/[view]');
		expect(md).toContain(
			'2. Cache each loaded view client-side so navigating back never refetches it'
		);
	});

	it('renders fileMap as a markdown table with path, line, and reason', () => {
		const md = renderPlanMarkdown(plan);
		expect(md).toContain('| Path | Line | Reason |');
		expect(md).toContain(
			'| `src/routes/(app)/artist/[slug]/+page.svelte` | 22 | static tabs array |'
		);
		expect(md).toContain('| `src/lib/ui/Tabs.svelte` | 67 | click() handler needs branching |');
	});

	it('renders verifyCommands as a fenced code block', () => {
		const md = renderPlanMarkdown(plan);
		expect(md).toContain('```\nyarn check\nyarn test:unit -- --run\n```');
	});

	it('appends a review section only when review comments are passed', () => {
		const withoutReview = renderPlanMarkdown(plan);
		expect(withoutReview).not.toContain('Review notes');

		const withReview = renderPlanMarkdown(plan, {
			approved: false,
			comments: ['spec requirement 3 (lazy per-view loading) has no matching decision']
		});
		expect(withReview).toContain('Review notes');
		expect(withReview).toContain('_Not approved by plan-reviewer');
		expect(withReview).toContain(
			'- spec requirement 3 (lazy per-view loading) has no matching decision'
		);
	});

	it('marks an approved review distinctly from an unapproved one', () => {
		const md = renderPlanMarkdown(plan, { approved: true, comments: [] });
		expect(md).toContain('_Approved by plan-reviewer.');
	});

	it('renders a decision\'s "covering:" case list as a nested markdown sub-list', () => {
		const planWithCases: Plan = {
			...plan,
			decisions: [
				'Write `foo.spec.ts` first, covering: throws when input is null; returns true for a valid id.'
			]
		};
		const md = renderPlanMarkdown(planWithCases);
		expect(md).toContain('1. Write `foo.spec.ts` first:');
		expect(md).toContain('   - throws when input is null');
		expect(md).toContain('   - returns true for a valid id.');
	});
});
