import type { Slice } from '../types.ts';

const TEST_FILE_RE = /`([^`]+\.(?:spec|test)\.ts)`/;
// Not anchored to the start of the decision — a real decision reads "Move X
// into Y ... Write `foo.spec.ts` first, modeled on..." with the TDD intent
// stated mid-sentence, not as the decision's opening word.
const TEST_INTENT_RE = /\bwrite\s+`[^`]+\.(?:spec|test)\.ts`\s+first\b/i;
// Checked against the first 80 chars, not the literal first word — real
// decisions phrase this as "Only after that spec is red, implement `X`..."
// as often as "Implement `X`...".
const IMPL_VERB_RE =
	/\b(implement|move|replace|update|retype|reduce|refactor|change|add|remove|create)\b/i;

function extractTestFile(text: string): string | null {
	const m = TEST_FILE_RE.exec(text);
	return m ? m[1] : null;
}

function classifyDecisionKind(text: string): 'test' | 'impl' | 'manual' {
	const trimmed = text.trim();
	if (extractTestFile(trimmed) && TEST_INTENT_RE.test(trimmed)) return 'test';
	if (IMPL_VERB_RE.test(trimmed.slice(0, 80))) return 'impl';
	return 'manual';
}

/**
 * Carves a Plan's decisions into executable slices. A "test" decision names
 * a real *.spec.ts/*.test.ts file it wants written first; if the next
 * decision reads as an implementation step, they pair up. A test decision
 * with no such follow-up (or an "impl"-looking decision with no preceding
 * test) never gets silently guessed into a pair — orphan impl decisions are
 * `manual`, since running coder against them without a test-writer gate
 * would violate this repo's own TDD convention.
 */
export function classifySlices(decisions: string[]): Slice[] {
	const kinds = decisions.map(classifyDecisionKind);
	const slices: Slice[] = [];
	let i = 0;
	while (i < decisions.length) {
		if (kinds[i] === 'test') {
			const testFile = extractTestFile(decisions[i])!;
			if (kinds[i + 1] === 'impl') {
				slices.push({
					kind: 'tdd-pair',
					testDecisionIndex: i,
					testDecision: decisions[i],
					implDecisionIndex: i + 1,
					implDecision: decisions[i + 1],
					testFile
				});
				i += 2;
			} else {
				slices.push({
					kind: 'tdd-pair',
					testDecisionIndex: i,
					testDecision: decisions[i],
					implDecisionIndex: i,
					implDecision: decisions[i],
					testFile
				});
				i += 1;
			}
		} else {
			slices.push({ kind: 'manual', decisionIndex: i, decision: decisions[i] });
			i += 1;
		}
	}
	return slices;
}
