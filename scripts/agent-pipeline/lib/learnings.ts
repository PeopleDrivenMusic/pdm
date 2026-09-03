const PROMOTE_THRESHOLD = 2;

type ActiveRule = { rule: string; survived: number };
type Candidate = { triggerTag: string; rule: string; count: number; runs: string[] };
type LearningsDoc = { agentName: string; active: ActiveRule[]; candidates: Candidate[] };

const HEADER_RE = /^# (.+) learnings$/m;
const ACTIVE_ITEM_RE = /^- (.+) \(survived x(\d+)\)$/;
const CANDIDATE_ITEM_RE = /^- x(\d+) ([a-z0-9-]+): (.+) → (.+)$/;

export function parseLearnings(markdown: string): LearningsDoc {
	const headerMatch = markdown.match(HEADER_RE);
	const agentName = headerMatch ? headerMatch[1] : '';

	const active: ActiveRule[] = [];
	const candidates: Candidate[] = [];

	for (const line of markdown.split('\n')) {
		const activeMatch = line.match(ACTIVE_ITEM_RE);
		if (activeMatch) {
			active.push({ rule: activeMatch[1], survived: Number(activeMatch[2]) });
			continue;
		}
		const candidateMatch = line.match(CANDIDATE_ITEM_RE);
		if (candidateMatch) {
			candidates.push({
				count: Number(candidateMatch[1]),
				triggerTag: candidateMatch[2],
				rule: candidateMatch[3],
				runs: candidateMatch[4].split(', ')
			});
		}
	}

	return { agentName, active, candidates };
}

export function serializeLearnings(doc: LearningsDoc): string {
	const activeBlock =
		doc.active.length === 0
			? ''
			: doc.active.map((a) => `- ${a.rule} (survived x${a.survived})`).join('\n') + '\n\n';
	const candidateBlock =
		doc.candidates.length === 0
			? ''
			: '\n' +
				doc.candidates
					.map((c) => `- x${c.count} ${c.triggerTag}: ${c.rule} → ${c.runs.join(', ')}`)
					.join('\n') +
				'\n';

	return `# ${doc.agentName} learnings

## Active rules (promoted)

${activeBlock}## Candidates (pending promotion)
${candidateBlock}`;
}

export function recordCandidate(
	doc: LearningsDoc,
	triggerTag: string,
	rule: string,
	runId: string
): LearningsDoc {
	const existing = doc.candidates.find((c) => c.triggerTag === triggerTag);

	if (!existing) {
		return {
			...doc,
			candidates: [...doc.candidates, { triggerTag, rule, count: 1, runs: [runId] }]
		};
	}

	const newCount = existing.count + 1;

	if (newCount >= PROMOTE_THRESHOLD) {
		return {
			...doc,
			candidates: doc.candidates.filter((c) => c.triggerTag !== triggerTag),
			active: [...doc.active, { rule, survived: 1 }]
		};
	}

	return {
		...doc,
		candidates: doc.candidates.map((c) =>
			c.triggerTag === triggerTag ? { ...c, rule, count: newCount, runs: [...c.runs, runId] } : c
		)
	};
}
