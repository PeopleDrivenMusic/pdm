# Agent Pipeline

A minimal, real, headless two-stage agent pipeline: `spec-agent` → `plan-agent`,
gated by a deterministic `groundingCheck` (no LLM decides pass/fail — see
`docs/superpowers/specs/2026-09-03-agent-pipeline-takehome-design.md`).

## Run it

```bash
yarn agent:pipeline "<task description>"
```

Writes `runs/<timestamp>/` containing `spec.json`, `plan.attempt-N.json` per
attempt, `grounding-check.log`, `summary.json`, and — only if all 3 attempts
were rejected — `escalation.md`.

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

- `types.ts` — `Spec`/`Plan` shapes + structural type guards (the spec
  stage's gate).
- `lib/groundingCheck.ts` — the plan stage's gate: every `fileMap` entry must
  be a real, existing path at an in-range line. Pure, no LLM.
- `lib/runStage.ts` — the bounded-retry engine (3 attempts, gate error fed
  back into the next prompt), agent-agnostic.
- `lib/callAgent.ts` — wraps `claude -p --output-format json`. Keys off the
  JSON body's `is_error`, never the process exit code (a live probe showed
  the CLI can return `is_error:false` with a nonzero exit).
- `lib/learnings.ts` + `lib/reflect.ts` — the self-improvement loop: a lesson
  from a retried stage becomes a `Candidate`, and only gets promoted to
  `Active` (and folded into that agent's system prompt) once the same
  `triggerTag` recurs — a counter decides, not an LLM.
- `agents/<name>/` — `config.json` (model + allowed tools), `system-prompt.md`
  (base instructions), `learnings.md` (Active/Candidates, same shape as this
  repo's own `.claude/learn/LEARNINGS.md`).
- `fixtures/bad-plan.json` — the `--inject` fixture.

## Why plain `node`, not `vite-node`/`tsx`

Node 24 runs `.ts` files natively (type erasure, no transform step) as long
as relative imports carry an explicit `.ts` extension — every import in this
tree does. `tsconfig.json`'s `allowImportingTsExtensions` makes `yarn check`
accept the same imports.
