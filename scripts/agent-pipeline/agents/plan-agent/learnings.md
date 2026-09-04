# plan-agent learnings

## Active rules (promoted)

- Before finalizing, re-check each spec's TDD test cases against the exact behavior the implementation decision claims to produce (e.g. an exact-string redirect path), so a mismatch is caught by the plan itself rather than by the mechanical gate. (survived x1)

## Candidates (pending promotion)

- x1 unread-line-citation: Re-open every cited file with Read immediately before writing its path:line into fileMap, and never cite a line beyond the file's actual length. → 2026-09-03T03-44-39-252Z
- x1 unverified-filemap-line: Re-open every fileMap path with Read immediately before citing it, and never cite a line number beyond the file's actual length. → 2026-09-03T11-17-29-440Z
- x1 wiring-steps-skip-tdd: Give every wiring point that connects two already-tested pieces its own test-first step naming the exact assertion (e.g. replaceState called, goto not called), not just a bare 'Implement' decision. → 2026-09-03T11-18-05-027Z
- x1 stale-line-citation: Re-Read the exact file immediately before citing any path:line in fileMap, never reuse a remembered or guessed line number. → 2026-09-04T02-17-25-653Z
- x1 unrequested-scope: Before asserting a behavior claim (streaming semantics) or an absence claim (no test infrastructure exists), grep/read the actual source to confirm it rather than stating it as established fact. → 2026-09-04T02-23-31-790Z
