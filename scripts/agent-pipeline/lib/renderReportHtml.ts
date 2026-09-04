import type { RunTrace, StageTrace } from '../types.ts';

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function fmtNum(n: number): string {
	return n.toLocaleString('en-US');
}

function fmtCost(n: number): string {
	return `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function fmtMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function outcomeClass(outcome: string): string {
	if (outcome === 'ok') return 'ok';
	if (outcome === 'unapproved') return 'warn';
	return 'fail';
}

function renderStageRow(stage: StageTrace): string {
	const reviewLine = stage.review
		? `<div class="review-line">review: ${stage.review
				.map(
					(r) =>
						`round ${r.round} ${escapeHtml(r.verdict)}${r.verdict === 'needs-revision' ? ` (${r.commentCount})` : ''}`
				)
				.join(' → ')}</div>`
		: '';
	return `<tr>
	<td class="mono">${escapeHtml(stage.name)}</td>
	<td><span class="badge ${outcomeClass(stage.outcome)}">${escapeHtml(stage.outcome)}</span></td>
	<td class="num">${stage.attempts}</td>
	<td class="num">${fmtMs(stage.durationMs)}</td>
	<td class="num">${fmtNum(stage.usage.inputTokens)}</td>
	<td class="num">${fmtNum(stage.usage.outputTokens)}</td>
	<td class="num">${fmtCost(stage.usage.costUsd)}</td>
</tr>
<tr class="sub-row"><td colspan="7">${reviewLine}</td></tr>`;
}

function renderLessons(trace: RunTrace): string {
	const lessons = trace.stages.flatMap((s) => s.lessons);
	if (lessons.length === 0) {
		return '<p class="empty">No lessons fired this run — every stage either succeeded on the first attempt or was approved without a retry.</p>';
	}
	return `<table>
<thead><tr><th>Agent</th><th>Trigger</th><th>Rule</th><th>Promoted</th></tr></thead>
<tbody>
${lessons
	.map(
		(l) => `<tr>
	<td class="mono">${escapeHtml(l.agent)}</td>
	<td class="mono">${escapeHtml(l.triggerTag)}</td>
	<td>${escapeHtml(l.rule)}</td>
	<td><span class="badge ${l.promoted ? 'ok' : 'muted'}">${l.promoted ? 'Active' : 'Candidate'}</span></td>
</tr>`
	)
	.join('\n')}
</tbody>
</table>`;
}

export function renderReportHtml(trace: RunTrace): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Pipeline report — ${escapeHtml(trace.runId)}</title>
<style>
	:root {
		--paper: #f5f6f2; --ink: #1c2321; --ink-soft: #565f5b; --line: #dadED7;
		--accent: #2e6f6b; --ok: #3a7d44; --ok-soft: #e6f0e3;
		--warn: #a56a1f; --warn-soft: #f3ead8; --fail: #b33a3a; --fail-soft: #f5e6e4;
		--muted: #8fa39b; --muted-soft: #eceeea; --card: #ffffff;
	}
	* { box-sizing: border-box; }
	body { background: var(--paper); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, sans-serif; margin: 0; padding: 32px 24px 64px; }
	.mono, td.mono, th.mono, code { font-family: ui-monospace, Consolas, monospace; }
	.wrap { max-width: 860px; margin: 0 auto; }
	h1 { font-size: 22px; margin: 0 0 4px; }
	.task { color: var(--ink-soft); font-size: 15px; margin: 0 0 20px; max-width: 70ch; }
	.meta { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; color: var(--ink-soft); margin-bottom: 24px; }
	.badge { display: inline-block; font-family: ui-monospace, Consolas, monospace; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
	.badge.ok { background: var(--ok-soft); color: var(--ok); }
	.badge.warn { background: var(--warn-soft); color: var(--warn); }
	.badge.fail { background: var(--fail-soft); color: var(--fail); }
	.badge.muted { background: var(--muted-soft); color: var(--muted); }
	.totals { display: flex; gap: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--card); margin-bottom: 28px; }
	.totals .cell { flex: 1; padding: 14px 16px; border-right: 1px solid var(--line); }
	.totals .cell:last-child { border-right: none; }
	.totals .n { font-family: ui-monospace, Consolas, monospace; font-size: 19px; font-weight: 600; color: var(--accent); }
	.totals .l { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
	h2 { font-size: 16px; margin: 32px 0 12px; }
	table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
	th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
	th { font-family: ui-monospace, Consolas, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); background: #eef1ef; }
	td.num, th.num { text-align: right; font-family: ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
	tr.sub-row td { border-bottom: 1px solid var(--line); padding: 0 12px 8px; font-size: 12px; color: var(--ink-soft); }
	.review-line { font-family: ui-monospace, Consolas, monospace; }
	.empty { color: var(--ink-soft); font-size: 13.5px; }
</style>
</head>
<body>
<div class="wrap">
	<h1>Pipeline report <span class="badge ${outcomeClass(trace.outcome)}">${escapeHtml(trace.outcome)}</span></h1>
	<p class="task">${escapeHtml(trace.task)}</p>
	<div class="meta">${escapeHtml(trace.runId)}${trace.injected ? ' · injected demo' : ''}</div>

	<div class="totals">
		<div class="cell"><div class="n">${fmtCost(trace.totals.costUsd)}</div><div class="l">total cost</div></div>
		<div class="cell"><div class="n">${fmtNum(trace.totals.inputTokens)}</div><div class="l">input tokens</div></div>
		<div class="cell"><div class="n">${fmtNum(trace.totals.outputTokens)}</div><div class="l">output tokens</div></div>
		<div class="cell"><div class="n">${fmtMs(trace.totals.durationMs)}</div><div class="l">wall time</div></div>
	</div>

	<h2>Stages</h2>
	<table>
		<thead><tr><th>Stage</th><th>Outcome</th><th class="num">Attempts</th><th class="num">Duration</th><th class="num">Tokens in</th><th class="num">Tokens out</th><th class="num">Cost</th></tr></thead>
		<tbody>
${trace.stages.map(renderStageRow).join('\n')}
		</tbody>
	</table>

	<h2>Lessons this run</h2>
	${renderLessons(trace)}
</div>
</body>
</html>
`;
}
