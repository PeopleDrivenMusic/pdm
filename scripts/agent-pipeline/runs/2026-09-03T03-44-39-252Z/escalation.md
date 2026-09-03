# Escalation — stage "plan"

## Reason

1 plan reference(s) do not resolve to a real path/line: src/routes/(app)/artist/[slug]/+page.svelte:999

## Last attempt

```json
{
	"decisions": [
		"Convert artist page tabs (Feed/Music/Posts/Photos/Videos) into a nested route layout under /artist/[slug]/[view]",
		"Add a client-side loaded-view cache so navigating back to a view already fetched does not refetch it"
	],
	"fileMap": [
		{
			"path": "src/routes/(app)/artist/[slug]/+page.svelte",
			"line": 42,
			"reason": "existing activeTab state and tab-switch handler live here"
		},
		{
			"path": "src/routes/(app)/artist/[slug]/+page.svelte",
			"line": 999,
			"reason": "existing per-view data loading block to replace with the nested route's load functions"
		}
	],
	"verifyCommands": ["yarn check", "yarn test:unit -- --run"]
}
```
