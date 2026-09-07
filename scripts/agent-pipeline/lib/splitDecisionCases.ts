const CASE_TRIGGER_RE = /\b(?:cases?|covering|cover)\s*[:,]\s*/i;

/** Splits `text` on `sep`, but only at "top level" — never inside `` `backticks` `` or (parentheses), so a case description's own punctuation can't be mistaken for a case boundary. */
function splitTopLevel(text: string, sep: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let inBacktick = false;
	let current = '';
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '`') inBacktick = !inBacktick;
		if (!inBacktick) {
			if (ch === '(') depth++;
			if (ch === ')') depth--;
		}
		if (!inBacktick && depth === 0 && text.startsWith(sep, i)) {
			parts.push(current.trim());
			current = '';
			i += sep.length;
			continue;
		}
		current += ch;
		i++;
	}
	if (current.trim()) parts.push(current.trim());
	return parts;
}

const LETTER_MARKER_RE = /\([a-z]\)\s+/g;

/**
 * Splits on (a)/(b)/(c) markers when the text uses them — a live case (from
 * the real approved plan) has a semicolon *inside* case (c)'s own clause,
 * not as a case separator, which naive semicolon-splitting can't tell apart
 * from a real boundary; the lettered markers are unambiguous when present.
 */
function splitByLetterMarkers(text: string): string[] | null {
	const markers = [...text.matchAll(LETTER_MARKER_RE)];
	if (markers.length < 2) return null;
	return markers.map((marker, i) => {
		const start = marker.index;
		const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
		return text.slice(start, end).trim();
	});
}

/**
 * A plan decision often reads as one dense paragraph ending in a
 * semicolon-separated case list ("...covering: throws 404 when X; returns Y
 * when Z."), which is real, specific content — but unreadable as a wall of
 * text. Pulls the case list out for separate rendering; returns null when
 * there's no case-list trigger word or fewer than 2 cases (a single case
 * isn't worth restructuring into a list of one).
 */
export function splitDecisionCases(decision: string): { intro: string; cases: string[] } | null {
	const match = CASE_TRIGGER_RE.exec(decision);
	if (!match) return null;
	const intro = decision
		.slice(0, match.index)
		.replace(/[.,:\s]+$/, '')
		.trim();
	const rest = decision.slice(match.index + match[0].length);
	const cases = (splitByLetterMarkers(rest) ?? splitTopLevel(rest, ';'))
		.map((s) => s.replace(/;\s*$/, '').trim())
		.filter(Boolean);
	if (cases.length < 2) return null;
	return { intro, cases };
}
