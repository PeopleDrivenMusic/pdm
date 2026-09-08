# coder learnings

## Active rules (promoted)

- Run the test suite with a memory-bounded/limited config (or increase Node heap via NODE_OPTIONS) rather than retrying the same OOM-prone invocation unchanged. (survived x1)

## Candidates (pending promotion)

- x1 wrong-fix: Match assertion expectations exactly against the actual redirect target value the code produces, not an assumed one. → 2026-09-04T02-23-31-790Z
