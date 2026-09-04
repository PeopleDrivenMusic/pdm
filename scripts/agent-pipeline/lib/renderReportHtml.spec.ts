import { describe, expect, it } from 'vitest';
import { renderReportHtml } from './renderReportHtml.ts';
import type { RunTrace } from '../types.ts';

const trace: RunTrace = {
	runId: '2026-09-04T05-00-00',
	task: 'Make the artist page tabs URL-addressable',
	stages: [
		{
			name: 'spec',
			attempts: 1,
			outcome: 'ok',
			durationMs: 59977,
			usage: { costUsd: 0.1376, inputTokens: 2100, outputTokens: 340 },
			lessons: []
		},
		{
			name: 'plan',
			attempts: 1,
			outcome: 'unapproved',
			durationMs: 214164,
			usage: { costUsd: 0.6294, inputTokens: 48000, outputTokens: 1800 },
			lessons: [
				{
					agent: 'plan-agent',
					triggerTag: 'missing-test-first-sequencing',
					rule: 'Write a test-first step for every decision that wires two existing pieces together.',
					promoted: false
				}
			],
			review: [{ round: 1, verdict: 'needs-revision', commentCount: 1 }]
		}
	],
	totals: { costUsd: 0.767, inputTokens: 50100, outputTokens: 2140, durationMs: 274141 },
	outcome: 'unapproved',
	injected: false
};

describe('renderReportHtml', () => {
	it('includes the task text and run id', () => {
		const html = renderReportHtml(trace);
		expect(html).toContain('Make the artist page tabs URL-addressable');
		expect(html).toContain('2026-09-04T05-00-00');
	});

	it('shows attempts, tokens, and cost per stage', () => {
		const html = renderReportHtml(trace);
		expect(html).toContain('spec');
		expect(html).toContain('plan');
		expect(html).toMatch(/2,?100/); // spec input tokens
		expect(html).toMatch(/48,?000/); // plan input tokens
		expect(html).toContain('$0.1376');
		expect(html).toContain('$0.6294');
	});

	it('shows the pipeline totals', () => {
		const html = renderReportHtml(trace);
		expect(html).toContain('$0.767');
		expect(html).toMatch(/50,?100/);
	});

	it('lists lessons with their promotion status', () => {
		const html = renderReportHtml(trace);
		expect(html).toContain('missing-test-first-sequencing');
		expect(html).toContain(
			'Write a test-first step for every decision that wires two existing pieces together.'
		);
	});

	it('shows an empty state when no lessons fired', () => {
		const noLessons: RunTrace = { ...trace, stages: [{ ...trace.stages[0] }] };
		const html = renderReportHtml(noLessons);
		expect(html).toContain('No lessons');
	});

	it('escapes HTML in the task text', () => {
		const withHtml: RunTrace = { ...trace, task: '<script>alert(1)</script>' };
		const html = renderReportHtml(withHtml);
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('reflects the overall outcome and per-stage outcome distinctly', () => {
		const html = renderReportHtml(trace);
		expect(html).toContain('unapproved');
	});
});
