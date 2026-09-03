# Agent Pipeline (Take-Home Evidence) — Design Spec

**Date:** 2026-09-03
**Status:** Approved, pending implementation
**Author:** Ivan Izobov (with Claude Code)
**Branch:** `experiment/agent-pipeline-takehome`

## 1. Goal

Build a real, running, headless multi-agent pipeline as Path A evidence for a
job take-home ("Multi-agent system design and operation"). It must produce
real artifacts (a plan for a real PDM backlog item), not stop at a spec, and
must demonstrate mechanical validation, bounded retry, escalation, and a
grounded self-improvement loop — not "an LLM checks it."

Target backlog item: artist-page URL-routing (`/artist/[slug]/[view]`,
recorded in project memory `artist-page-url-routing-backlog`, not started).

Scope is deliberately two LLM stages, not the full six-stage pipeline
discussed earlier (spec → plan → test-writer → coder → PR-review → done).
Depth on two stages, done honestly, outweighs breadth across six done as
theater — the assignment explicitly rejects polish over substance.

## 2. Decisions

| Decision          | Choice                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invocation        | `claude -p "<prompt>" --output-format json --permission-mode plan --allowedTools "Read Grep Glob"` — headless CLI, no new dependency. Verified live via `claude --help` on 2026-09-03 (CLI 2.1.258).                                                         |
| Runner            | `vite-node -c vite.config.script.ts`, already used by `scripts/import-artist.ts`. No new dependency.                                                                                                                                                         |
| Schema validation | Hand-rolled TS type guards, not Zod. Two flat object shapes don't justify a new dependency.                                                                                                                                                                  |
| The gate          | `groundingCheck()` — pure TS function, no LLM. This is what the earlier 3-agent "plan-reviewer" design collapsed into: the assignment explicitly rejects "an LLM checks it," so the reviewer role is mechanical, not conversational.                         |
| Retry             | Bounded, 2 retries (3 attempts total) per stage, error text from the failed gate appended to the next prompt.                                                                                                                                                |
| Escalation        | On exhaustion: write `escalation.md` with the last attempt + last gate error, exit non-zero. No silent fallback.                                                                                                                                             |
| Self-improvement  | Per-agent, reflection-triggered only on retry (never on first-try success — avoids overfitting to noise), promotion gated by a repeat counter (not an LLM judgment call). Reuses the `.claude/learn/` Active/Candidates pattern already proven in this repo. |
| Failure demo      | A committed fixture (`fixtures/bad-plan.json`) fed directly into `groundingCheck` via `--inject`, so the retry → escalation path is reproducible on demand for the recording, not gambled on a live run.                                                     |
| Branch base       | `main`, not `feat/seeded-artist-profiles` — unrelated work.                                                                                                                                                                                                  |

## 3. Directory structure

```
scripts/agent-pipeline/
  run.ts                       # orchestrator entry point
  types.ts                     # Spec, Plan, GateResult, RunTrace types + guards
  lib/
    callAgent.ts                # wraps `claude -p`, parses --output-format json
    groundingCheck.ts           # the mechanical gate
    reflect.ts                  # reflection call + counter-based promotion
    trace.ts                    # run.ts writes to runs/<ts>/, trace.ts shapes it
  agents/
    spec-agent/
      system-prompt.md          # base init prompt (role, output schema, constraints)
      learnings.md              # Active rules / Candidates, same shape as .claude/learn/LEARNINGS.md
    plan-agent/
      system-prompt.md
      learnings.md
  fixtures/
    bad-plan.json                # deliberately broken plan.json for --inject demo
  runs/
    <timestamp>/
      spec.json
      plan.attempt-1.json
      plan.attempt-2.json        # only present if a retry happened
      grounding-check.log
      escalation.md               # only present if all attempts exhausted
      summary.json
```

`runs/` is gitignored (run artifacts, not source); one representative run
(including the injected-failure run) gets committed under `runs/` explicitly
for the take-home submission, named so it survives `.gitignore` (see §9).

## 4. Data shapes

```ts
type Spec = {
	problem: string;
	requirements: string[];
	outOfScope: string[];
	filesLikely: string[];
};

type PlanFileRef = { path: string; line: number; reason: string };

type Plan = {
	decisions: string[];
	fileMap: PlanFileRef[];
	verifyCommands: string[];
};

type GateResult = { ok: true } | { ok: false; reason: string; failedRefs: PlanFileRef[] };
```

Type guards (`isSpec`, `isPlan`) reject missing/empty required fields — this
_is_ the spec-stage's gate (structural grounding; spec is prose, so there is
no deeper mechanical check available for it, and pretending otherwise would
be the hand-waving the assignment rejects).

## 5. The gate — `groundingCheck(plan: Plan): GateResult`

For every `fileMap` entry:

- `fs.existsSync(path)` relative to repo root.
- If it exists, `line <= readFileSync(path, 'utf-8').split('\n').length`.

Any failing entry → `{ ok: false, reason, failedRefs }`. All pass → `{ ok: true }`.
No LLM involved. This is the only function whose return value decides
retry vs. proceed vs. escalate.

## 6. Retry and escalation (`run.ts`)

```
for attempt in 1..3:
  output = callAgent(agent, prompt(input, lastError))
  if !isPlan(output): lastError = "schema: " + reason; continue
  result = groundingCheck(output)
  if result.ok: return { ok: true, plan: output, attempts: attempt }
  lastError = result.reason
return { ok: false, escalate: lastError, lastAttempt: output }
```

On escalation, `run.ts` writes `escalation.md` (last plan + last gate error)
into the run directory and exits 1. Nothing downstream runs.

## 7. Self-improvement loop

Per-agent `learnings.md`, identical shape to `.claude/learn/LEARNINGS.md`:

```markdown
# <agent-name> learnings

## Active rules (promoted)

- <rule text> (survived x<n>)

## Candidates (pending promotion)

- x<n> <trigger tag>: <rule text> → runs/<ts>, runs/<ts>
```

**Trigger:** only when a stage needed a retry (attempt count > 1). A
first-try success has no failure to learn from; asking anyway would generate
plausible-sounding but ungrounded "best practices."

**Reflection call:** one extra `claude -p` call to the same agent, given the
failed attempt(s) + gate error(s) + the attempt that finally passed (if any),
asked to return `{ triggerTag: string; rule: string }` — a short slug plus a
one-line actionable rule. Same schema-guard discipline as the main stages.

**Promotion — counter-based, not LLM-judged:** `reflect.ts` looks up
`triggerTag` in that agent's `Candidates`. New tag → added at count 1.
Existing tag → count++. At `count >= 2` → moved to `Active rules`, and from
the _next_ run onward `run.ts` appends the `Active rules` section into that
agent's system prompt via `--append-system-prompt`. The promotion decision
is arithmetic on a string key, not a model call — the loop cannot silently
change agent behavior after a single ambiguous incident.

This directly answers "context management" too: each agent's context =
`system-prompt.md` + current `Active rules`, nothing else — no shared
transcript, no other agent's output except what's explicitly passed as
`input`.

## 8. Trace format (`summary.json`)

```ts
type RunTrace = {
	runId: string;
	task: string;
	stages: {
		name: 'spec' | 'plan';
		attempts: number;
		outcome: 'ok' | 'escalated';
		durationMs: number;
		tokensUsed?: number; // from --output-format json's usage field, if present
		reflectionFired: boolean;
	}[];
	injected: boolean; // true for the --inject fixture run
};
```

## 9. `--inject` fixture path

`run.ts --inject fixtures/bad-plan.json` skips `plan-agent` entirely and
feeds the fixture straight into `groundingCheck`, exercising retry →
escalation deterministically (the fixture references a real file at a line
number past its actual end, mirroring a genuinely plausible LLM mistake —
stale line number after other edits — not a strawman). The run is marked
`injected: true` in its trace and its output directory is committed for the
submission so the reviewer can inspect it without re-running anything.

## 10. Out of scope (YAGNI)

- test-writer / coder / PR-review stages — designed conversationally
  earlier, explicitly called out as not implemented in the recording.
- GitHub Projects webhook trigger — CLI arg (`vitest` task string) stands in;
  webhook plumbing isn't what the assignment scores.
- Zod or any schema library — hand-rolled guards suffice at this size.
- Cross-run learnings aggregation UI — `learnings.md` files are read directly.
- Concurrent/parallel agent dispatch — stages are strictly sequential
  (plan depends on spec); nothing here is independent enough to parallelize.

## 11. To verify during implementation

1. Exact shape of `--output-format json`'s result object (message content
   path, `usage` field name) — probe with one real `claude -p` call before
   writing `callAgent.ts`'s parser against an assumed shape.
2. Whether `--permission-mode plan` combined with `--allowedTools "Read Grep Glob"`
   actually blocks writes as expected, or whether `--allowedTools` alone is
   sufficient and `--permission-mode` should be `dontAsk` — probe live.
