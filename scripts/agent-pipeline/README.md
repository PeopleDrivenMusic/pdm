# Agent Pipeline

A real, headless three-stage agent pipeline: `spec-agent` → `plan-agent` →
`plan-reviewer`. The plan stage is gated by a deterministic `groundingCheck`
(no LLM decides pass/fail on realness) before the reviewer ever sees it — the
reviewer judges quality, not whether citations are real. See
`docs/superpowers/specs/2026-09-03-agent-pipeline-takehome-design.md`.

## Run it

```bash
yarn agent:pipeline "<task description>"
```

Writes `runs/<timestamp>/` containing `spec.json`, `plan.attempt-N.json` per
attempt, `plan.review-N.attempt-M.json` for any reviewer-triggered revision,
`review.round-N.json` per reviewer verdict, `grounding-check.log`,
the final **`plan.json` + `plan.md`** (human-readable — always written once
the plan is grounded, whether or not the reviewer approved it),
`review-notes.md` (only if the reviewer never approved after 3 rounds — the
plan still ships, this file just says what's still open), `escalation.md`
(only if grounding itself was never satisfied — the hard failure mode), and
**`summary.json` + `report.html`** — the observability pair, written on
every run regardless of outcome:

- `summary.json` — per stage: attempts, outcome, duration, token usage
  (`{costUsd, inputTokens, outputTokens}`), and every lesson that fired
  (`{agent, triggerTag, rule, promoted}`); plus pipeline-wide `totals` and a
  single top-level `outcome` (`ok` | `unapproved` | `escalated` — the worst
  outcome across all stages).
- `report.html` — a static, self-contained rendering of the exact same
  `summary.json` (`lib/renderReportHtml.ts`, pure function, no template
  drifts from the data) — open it directly in a browser, no server needed.

## Demo the failure path without spending real API calls on the plan stage

```bash
yarn agent:pipeline --inject scripts/agent-pipeline/fixtures/bad-plan.json
```

Feeds a fixture with one real file:line reference and one deliberately
out-of-range one straight into the retry loop (skipping the real plan-agent
call), exercising retry → escalation deterministically. The reflection call
after escalation is still real — see `agents/plan-agent/learnings.md` for a
genuine lesson recorded this way.

## Layout

- `types.ts` — `Spec`/`Plan`/`Review` shapes + structural type guards (the
  spec stage's and reviewer's schema-level gate).
- `lib/groundingCheck.ts` — the plan stage's hard gate: every `fileMap` entry
  must be a real, existing path at an in-range line. Pure, no LLM. Runs
  before the reviewer ever sees a plan, and again after every
  reviewer-triggered revision.
- `lib/runStage.ts` — the bounded-retry engine (3 attempts, gate error fed
  back into the next prompt), agent-agnostic — used for spec, plan, and each
  reviewer verdict call.
- `lib/callAgent.ts` — wraps `claude -p --output-format json`. Keys off the
  JSON body's `is_error`, never the process exit code (a live probe showed
  the CLI can return `is_error:false` with a nonzero exit). `inputTokens` is
  `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` —
  a real run showed `input_tokens` alone under-reports by orders of
  magnitude (2 vs. ~47k), since most of a turn's context is cached system
  prompt/tool defs, not fresh input.
- `lib/renderPlanMarkdown.ts` — pure renderer, `plan.json` → `plan.md`
  (numbered decisions, a file:line:reason table, the verify commands, and a
  review-status section). `plan.json` stays the single source every
  machine consumer reads (gate, reviewer, and eventually a coder/test-writer
  stage) — `plan.md` is a view over it, never a second source of truth.
- `lib/learnings.ts` + `lib/reflect.ts` — the self-improvement loop: a lesson
  becomes a `Candidate`, and only gets promoted to `Active` (and folded into
  that agent's system prompt) once the same `triggerTag` recurs — a counter
  decides, not an LLM. Three feeds into it: plan-agent reflects on its own
  grounding retries, plan-agent reflects on the reviewer's comments
  (so the _next_ plan starts stronger, not just the next attempt of this
  one), and plan-reviewer reflects on its own calibration when a plan took
  more than one round to approve.
- `agents/<name>/` — `config.json` (model + allowed tools), `system-prompt.md`
  (base instructions — `plan-reviewer`'s rubric is a YAGNI/reuse-first ladder,
  the same discipline this repo's `ponytail` mode applies to code, applied
  here to plans), `learnings.md` (Active/Candidates, same shape as this
  repo's own `.claude/learn/LEARNINGS.md`).
- `fixtures/bad-plan.json` — the `--inject` fixture.

## The plan-reviewer loop

Runs only after `groundingCheck` passes — it is never the thing that decides
whether a citation is real, only whether the plan is _good_ (satisfies every
spec requirement, doesn't reinvent something that already exists, doesn't
add unrequested scope, has verify commands that would actually catch a
regression). Up to 3 rounds: `needs-revision` sends the reviewer's comments
back to plan-agent, which revises and is re-grounded before the reviewer
sees it again. On round 3 the reviewer is told explicitly to approve unless
something is actually broken, not to keep polishing.

If it still hasn't approved after 3 rounds, the pipeline does **not** hard-fail
— the plan already cleared the harder bar (grounding), so it ships anyway,
with `review-notes.md` carrying the reviewer's last comments and the run
marked `unapproved` rather than `escalated`. A model that won't sign off
should never be able to block a plan forever; a human reads the notes and
decides.

## Why plain `node`, not `vite-node`/`tsx`

Node 24 runs `.ts` files natively (type erasure, no transform step) as long
as relative imports carry an explicit `.ts` extension — every import in this
tree does. `tsconfig.json`'s `allowImportingTsExtensions` makes `yarn check`
accept the same imports.
