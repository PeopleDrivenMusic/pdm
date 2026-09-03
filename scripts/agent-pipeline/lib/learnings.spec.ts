import { describe, expect, it } from 'vitest';
import { parseLearnings, recordCandidate, serializeLearnings } from './learnings.ts';

const EMPTY_DOC = `# plan-agent learnings

## Active rules (promoted)

## Candidates (pending promotion)
`;

describe('parseLearnings / serializeLearnings', () => {
	it('round-trips an empty doc', () => {
		const doc = parseLearnings(EMPTY_DOC);
		expect(doc).toEqual({ agentName: 'plan-agent', active: [], candidates: [] });
		expect(serializeLearnings(doc)).toBe(EMPTY_DOC);
	});

	it('parses active rules and candidates with counts and run links', () => {
		const markdown = `# plan-agent learnings

## Active rules (promoted)

- Always cite the nearest existing file, never a file the plan itself creates (survived x3)

## Candidates (pending promotion)

- x1 stale-line-number: Re-read the file right before citing a line → runs/2026-09-01T00-00-00
`;
		const doc = parseLearnings(markdown);
		expect(doc.active).toEqual([
			{
				rule: 'Always cite the nearest existing file, never a file the plan itself creates',
				survived: 3
			}
		]);
		expect(doc.candidates).toEqual([
			{
				triggerTag: 'stale-line-number',
				rule: 'Re-read the file right before citing a line',
				count: 1,
				runs: ['runs/2026-09-01T00-00-00']
			}
		]);
	});

	it('round-trips a non-empty doc byte for byte', () => {
		const markdown = `# spec-agent learnings

## Active rules (promoted)

- Keep requirements atomic, one per bullet (survived x2)

## Candidates (pending promotion)

- x1 vague-scope: Name the concrete route touched, not "the artist page" → runs/2026-09-02T10-00-00
`;
		expect(serializeLearnings(parseLearnings(markdown))).toBe(markdown);
	});
});

describe('recordCandidate', () => {
	function emptyDoc(agentName: string) {
		return parseLearnings(
			`# ${agentName} learnings\n\n## Active rules (promoted)\n\n## Candidates (pending promotion)\n`
		);
	}

	it('adds a brand-new candidate at count 1', () => {
		const doc = recordCandidate(
			emptyDoc('plan-agent'),
			'stale-line-number',
			'Re-read the file right before citing a line',
			'runs/2026-09-01T00-00-00'
		);
		expect(doc.candidates).toEqual([
			{
				triggerTag: 'stale-line-number',
				rule: 'Re-read the file right before citing a line',
				count: 1,
				runs: ['runs/2026-09-01T00-00-00']
			}
		]);
		expect(doc.active).toEqual([]);
	});

	it('promotes to active using the latest wording, and drops from candidates, once count reaches the threshold (2)', () => {
		let doc = emptyDoc('plan-agent');
		doc = recordCandidate(doc, 'stale-line-number', 'Re-read before citing', 'runs/A');
		doc = recordCandidate(doc, 'stale-line-number', 'Re-read before citing (v2 wording)', 'runs/B');
		expect(doc.candidates).toEqual([]);
		expect(doc.active).toEqual([{ rule: 'Re-read before citing (v2 wording)', survived: 1 }]);
	});

	it('keeps unrelated candidates and actives untouched', () => {
		let doc = emptyDoc('plan-agent');
		doc = recordCandidate(doc, 'tag-a', 'rule a', 'runs/A');
		doc = recordCandidate(doc, 'tag-b', 'rule b', 'runs/B');
		expect(doc.candidates).toHaveLength(2);
	});
});
