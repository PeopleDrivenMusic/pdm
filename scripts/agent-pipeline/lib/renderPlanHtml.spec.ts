import { describe, expect, it } from 'vitest';
import { renderPlanHtml } from './renderPlanHtml.ts';
import type { Plan, ReviewRoundTrace, Spec } from '../types.ts';

const spec: Spec = {
	problem: 'Tabs are client-only state, not URL-addressable.',
	requirements: ['Shareable per-view URLs', 'No refetch on nav'],
	outOfScope: ['Shop view implementation'],
	filesLikely: ['src/routes/(app)/artist/[slug]/+page.svelte']
};

const plan: Plan = {
	decisions: [
		'Write `Tabs.spec.ts` first, covering the `onTabChange` callback.',
		'Only after that spec is red, implement `onTabChange` in `Tabs.svelte`.'
	],
	fileMap: [
		{ path: 'src/lib/ui/Tabs.svelte', line: 67, reason: 'click handler' },
		{ path: 'src/lib/ui/Tabs.svelte', line: 22, reason: 'props interface' },
		{ path: 'src/routes/(app)/artist/[slug]/+page.svelte', line: 85, reason: 'Tabs usage' }
	],
	verifyCommands: ['yarn check', 'yarn test:unit -- --run src/lib/ui/Tabs.spec.ts']
};

const review: ReviewRoundTrace[] = [
	{
		round: 1,
		verdict: 'needs-revision',
		commentCount: 1,
		comments: ["Requirement 'No refetch on nav' has no matching decision."]
	},
	{ round: 2, verdict: 'approved', commentCount: 0, comments: [] }
];

describe('renderPlanHtml', () => {
	it('renders the spec problem, requirements, and out-of-scope', () => {
		const html = renderPlanHtml({ spec, plan, review });
		expect(html).toContain('Tabs are client-only state, not URL-addressable.');
		expect(html).toContain('Shareable per-view URLs');
		expect(html).toContain('Shop view implementation');
	});

	it('numbers decisions and converts backtick spans to <code>', () => {
		const html = renderPlanHtml({ spec, plan, review });
		expect(html).toMatch(/1[\s\S]{0,20}Write <code>Tabs\.spec\.ts<\/code> first/);
		expect(html).toContain('<code>onTabChange</code>');
	});

	it('groups fileMap by path with a citation count', () => {
		const html = renderPlanHtml({ spec, plan, review });
		expect(html).toContain('Tabs.svelte');
		expect(html).toMatch(/Tabs\.svelte[\s\S]{0,200}2/); // cited twice
	});

	it('renders verify commands', () => {
		const html = renderPlanHtml({ spec, plan, review });
		expect(html).toContain('yarn test:unit -- --run src/lib/ui/Tabs.spec.ts');
	});

	it('renders the review journey with real comment text per round', () => {
		const html = renderPlanHtml({ spec, plan, review });
		expect(html).toContain("Requirement 'No refetch on nav' has no matching decision.");
		expect(html).toContain('needs-revision');
		expect(html).toContain('approved');
	});

	it('shows a not-yet-reviewed state when review is empty', () => {
		const html = renderPlanHtml({ spec, plan, review: [] });
		expect(html).toContain('not yet reviewed');
	});

	it('renders a decision\'s "covering:" case list as a separate, visually distinct sub-list', () => {
		const planWithCases: Plan = {
			...plan,
			decisions: [
				'Write `foo.spec.ts` first, covering: throws when input is null; returns true for a valid id.'
			]
		};
		const html = renderPlanHtml({ spec, plan: planWithCases, review: [] });
		expect(html).toContain('class="cases"');
		expect(html).toContain('throws when input is null');
		expect(html).toContain('returns true for a valid id.');
	});

	it('escapes HTML in spec and plan text', () => {
		const withHtml: Spec = { ...spec, problem: '<script>alert(1)</script>' };
		const html = renderPlanHtml({ spec: withHtml, plan, review });
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
	});
});
