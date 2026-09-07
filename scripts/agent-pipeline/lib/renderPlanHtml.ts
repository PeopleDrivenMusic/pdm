import { splitDecisionCases } from './splitDecisionCases.ts';
import type { Plan, PlanFileRef, ReviewRoundTrace, Spec } from '../types.ts';

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function mdLite(raw: string): string {
	return escapeHtml(raw).replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
}

function groupFiles(
	fileMap: PlanFileRef[]
): { path: string; count: number; refs: PlanFileRef[] }[] {
	const byPath = new Map<string, PlanFileRef[]>();
	for (const ref of fileMap) {
		const list = byPath.get(ref.path) ?? [];
		list.push(ref);
		byPath.set(ref.path, list);
	}
	return [...byPath.entries()]
		.map(([path, refs]) => ({ path, count: refs.length, refs }))
		.sort((a, b) => b.count - a.count);
}

function renderDecision(decision: string, index: number): string {
	const split = splitDecisionCases(decision);
	if (!split) {
		return `<li class="decision"><span class="num">${index + 1}</span>${mdLite(decision)}</li>`;
	}
	return `<li class="decision"><span class="num">${index + 1}</span>${mdLite(split.intro)}
	<ul class="cases">
${split.cases.map((c) => `		<li>${mdLite(c)}</li>`).join('\n')}
	</ul>
</li>`;
}

function reviewOutcome(review: ReviewRoundTrace[]): 'approved' | 'unapproved' | 'none' {
	if (review.length === 0) return 'none';
	return review[review.length - 1].verdict === 'approved' ? 'approved' : 'unapproved';
}

function renderFilesSection(fileMap: PlanFileRef[]): string {
	const grouped = groupFiles(fileMap);
	const max = Math.max(...grouped.map((g) => g.count), 1);
	return grouped
		.map(
			(g) => `<div class="file-row">
	<div class="file-head">
		<code>${escapeHtml(g.path)}</code>
		<span class="count">${g.count} citation${g.count === 1 ? '' : 's'}</span>
	</div>
	<div class="bar-track"><div class="bar" style="width:${(g.count / max) * 100}%"></div></div>
	<ul class="file-refs">
${g.refs.map((r) => `		<li><span class="line-no">:${r.line}</span> ${escapeHtml(r.reason)}</li>`).join('\n')}
	</ul>
</div>`
		)
		.join('\n');
}

function renderReviewJourney(review: ReviewRoundTrace[]): string {
	if (review.length === 0) {
		return '<p class="empty">This plan has not yet been through plan-reviewer — not yet reviewed.</p>';
	}
	return `<div class="journey">
${review
	.map(
		(r) => `<div class="round">
	<div class="round-head"><b>Round ${r.round}</b><span class="pill ${r.verdict === 'approved' ? 'pass' : 'warn'}">${escapeHtml(r.verdict)}</span></div>
	${
		r.comments.length > 0
			? `<ul>${r.comments.map((c) => `<li>${mdLite(c)}</li>`).join('')}</ul>`
			: '<p class="empty">No issues raised.</p>'
	}
</div>`
	)
	.join('\n')}
</div>`;
}

export function renderPlanHtml(params: {
	spec: Spec;
	plan: Plan;
	review: ReviewRoundTrace[];
}): string {
	const { spec, plan, review } = params;
	const outcome = reviewOutcome(review);
	const outcomeLabel =
		outcome === 'approved'
			? 'reviewer-approved'
			: outcome === 'unapproved'
				? 'not yet approved'
				: 'not yet reviewed';
	const outcomeClass =
		outcome === 'approved' ? 'pass' : outcome === 'unapproved' ? 'warn' : 'muted';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Plan</title>
<style>
	:root {
		--paper: #f6f5f2; --paper-raised: #ffffff; --ink: #211f1c; --ink-soft: #5c584f;
		--line: #ddd8cd; --accent: #3b4d8a; --accent-soft: #e7eaf3;
		--pass: #3a7d44; --pass-soft: #e6f0e3; --warn: #a56a1f; --warn-soft: #f3ead8;
		--muted: #8a8577; --muted-soft: #ece9e2; --code-bg: #171a1f; --code-ink: #dbe0e6;
	}
	* { box-sizing: border-box; }
	body { background: var(--paper); color: var(--ink); font: 15px/1.6 system-ui, -apple-system, sans-serif; margin: 0; padding: 32px 24px 72px; }
	code { font-family: ui-monospace, Consolas, monospace; background: var(--accent-soft); color: var(--accent); padding: 0.05em 0.35em; border-radius: 4px; font-size: 0.88em; word-break: break-word; }
	.wrap { max-width: 860px; margin: 0 auto; }
	h1 { font-size: 22px; margin: 0 0 4px; }
	h2 { font-size: 17px; margin: 34px 0 12px; }
	.problem { color: var(--ink-soft); font-size: 15px; max-width: 70ch; margin-top: 10px; }
	.pill { display: inline-flex; font-family: ui-monospace, Consolas, monospace; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
	.pill.pass { background: var(--pass-soft); color: var(--pass); }
	.pill.warn { background: var(--warn-soft); color: var(--warn); }
	.pill.muted { background: var(--muted-soft); color: var(--muted); }
	.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 20px; }
	.two-col h3 { font-size: 12px; font-family: ui-monospace, Consolas, monospace; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); margin: 0 0 8px; }
	.two-col ul { margin: 0; padding-left: 18px; font-size: 14px; }
	.two-col li { margin-bottom: 5px; }
	ol.decisions { list-style: none; counter-reset: dec; padding: 0; margin: 0; }
	.decision { position: relative; background: var(--paper-raised); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px 14px 48px; margin-bottom: 8px; font-size: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
	.decision .num { position: absolute; left: 14px; top: 14px; font-family: ui-monospace, Consolas, monospace; font-weight: 700; color: var(--accent); }
	ul.cases { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	ul.cases li { position: relative; padding-left: 16px; font-size: 13.5px; color: var(--ink-soft); }
	ul.cases li::before { content: '→'; position: absolute; left: 0; color: var(--accent); }
	.file-row { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin-bottom: 8px; }
	.file-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
	.count { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--ink-soft); white-space: nowrap; }
	.bar-track { height: 5px; background: var(--muted-soft); border-radius: 3px; margin: 8px 0; overflow: hidden; }
	.bar { height: 100%; background: var(--accent); border-radius: 3px; }
	.file-refs { margin: 6px 0 0; padding-left: 18px; font-size: 13px; color: var(--ink-soft); }
	.line-no { font-family: ui-monospace, Consolas, monospace; color: var(--accent); }
	.panel { background: var(--code-bg); color: var(--code-ink); border-radius: 10px; padding: 14px 16px; overflow-x: auto; }
	.panel pre { margin: 0; font-family: ui-monospace, Consolas, monospace; font-size: 13px; line-height: 1.7; }
	.journey { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--paper-raised); }
	.round { padding: 14px 16px; border-bottom: 1px solid var(--line); }
	.round:last-child { border-bottom: none; }
	.round-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
	.round ul { margin: 0; padding-left: 18px; }
	.round li { font-size: 13.5px; color: var(--ink-soft); margin-bottom: 5px; }
	.empty { color: var(--ink-soft); font-size: 13.5px; margin: 0; }
</style>
</head>
<body>
<div class="wrap">
	<h1>Plan <span class="pill ${outcomeClass}">${escapeHtml(outcomeLabel)}</span></h1>
	<p class="problem">${mdLite(spec.problem)}</p>

	<div class="two-col">
		<div>
			<h3>Requirements</h3>
			<ul>${spec.requirements.map((r) => `<li>${mdLite(r)}</li>`).join('')}</ul>
		</div>
		<div>
			<h3>Out of scope</h3>
			<ul>${spec.outOfScope.map((r) => `<li>${mdLite(r)}</li>`).join('')}</ul>
		</div>
	</div>

	<h2>Decisions</h2>
	<ol class="decisions">
${plan.decisions.map(renderDecision).join('\n')}
	</ol>

	<h2>Files touched</h2>
	${renderFilesSection(plan.fileMap)}

	<h2>Verify</h2>
	<div class="panel"><pre>${plan.verifyCommands.map((c) => `$ ${escapeHtml(c)}`).join('\n')}</pre></div>

	<h2>Review journey</h2>
	${renderReviewJourney(review)}
</div>
</body>
</html>
`;
}
