export function parseJsonLoose<T>(
	text: string
): { ok: true; value: T } | { ok: false; reason: string } {
	let cleaned = text.trim();
	// A real agent reply has opened with prose before its ```json fence
	// ("Now producing the revised plan JSON.\n\n```json\n{...}") — strip
	// everything before the fence, not just an anchored-to-start one, so
	// that costs a parse instead of a wasted retry.
	const fenceStart = cleaned.indexOf('```');
	if (fenceStart !== -1) {
		cleaned = cleaned
			.slice(fenceStart)
			.replace(/^```(?:json)?\n?/, '')
			.replace(/```[\s\S]*$/, '')
			.trim();
	}
	try {
		return { ok: true, value: JSON.parse(cleaned) as T };
	} catch (err) {
		return { ok: false, reason: `invalid JSON: ${(err as Error).message}` };
	}
}
