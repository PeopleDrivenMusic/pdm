# coder learnings

## Active rules (promoted)

- Run the test suite with a memory-bounded/limited config (or increase Node heap via NODE_OPTIONS) rather than retrying the same OOM-prone invocation unchanged. (survived x1)
- Before declaring done, run `yarn check` locally (or at least visually re-verify the touched files against tsc/svelte-check rules) to catch type/lint errors introduced by the implementation. (survived x1)

## Candidates (pending promotion)
