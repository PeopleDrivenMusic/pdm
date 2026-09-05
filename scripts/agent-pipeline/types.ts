export type Spec = {
	problem: string;
	requirements: string[];
	outOfScope: string[];
	filesLikely: string[];
};

export type PlanFileRef = { path: string; line: number; reason: string };

export type Plan = {
	decisions: string[];
	fileMap: PlanFileRef[];
	verifyCommands: string[];
};

export type GateResult = { ok: true } | { ok: false; reason: string; failedRefs: PlanFileRef[] };

export type Review = { verdict: 'approved' } | { verdict: 'needs-revision'; comments: string[] };

export type ReviewRoundTrace = {
	round: number;
	verdict: Review['verdict'];
	commentCount: number;
	comments: string[];
};

export type LessonRecord = { agent: string; triggerTag: string; rule: string; promoted: boolean };

export type Usage = { costUsd: number; inputTokens: number; outputTokens: number };

export type Outcome = 'ok' | 'escalated' | 'unapproved' | 'skipped';

export type StageTrace = {
	name: string;
	attempts: number;
	outcome: Outcome;
	durationMs: number;
	usage: Usage;
	lessons: LessonRecord[];
	review?: ReviewRoundTrace[];
};

export type RunTrace = {
	runId: string;
	task: string;
	stages: StageTrace[];
	totals: Usage & { durationMs: number };
	outcome: Outcome;
	injected: boolean;
};

/**
 * A unit of executable work carved out of a Plan's decisions. `tdd-pair` is
 * a (write-test, implement) pair identified by the test decision naming a
 * real *.spec.ts/*.test.ts path; anything that doesn't fit that shape
 * (a note, a manual-verification step) is `manual` — never run through
 * test-writer/coder, just surfaced for the human.
 */
export type Slice =
	| {
			kind: 'tdd-pair';
			testDecisionIndex: number;
			testDecision: string;
			implDecisionIndex: number;
			implDecision: string;
			testFile: string;
	  }
	| { kind: 'manual'; decisionIndex: number; decision: string };

export type SliceTrace = {
	sliceIndex: number;
	kind: Slice['kind'];
	testFile?: string;
	outcome: Outcome;
	durationMs: number;
	attempts: { testWriter: number; coder: number };
	usage: Usage;
	lessons: LessonRecord[];
	review: ReviewRoundTrace[];
	committed: boolean;
};

export type WriteResult = { status: 'done' } | { status: 'blocked'; reason: string };

export type ExecuteTrace = {
	runId: string;
	planPath: string;
	branch: string;
	slices: SliceTrace[];
	finalVerify?: { ok: boolean; failedCommands: string[] };
	totals: Usage & { durationMs: number };
	outcome: Outcome;
};

function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every((x) => typeof x === 'string');
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

export function isSpec(value: unknown): value is Spec {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		isNonEmptyString(v.problem) &&
		isNonEmptyStringArray(v.requirements) &&
		Array.isArray(v.outOfScope) &&
		v.outOfScope.every((x) => typeof x === 'string') &&
		isNonEmptyStringArray(v.filesLikely)
	);
}

export function isPlanFileRef(value: unknown): value is PlanFileRef {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		isNonEmptyString(v.path) &&
		typeof v.line === 'number' &&
		Number.isInteger(v.line) &&
		v.line > 0 &&
		isNonEmptyString(v.reason)
	);
}

export function isPlan(value: unknown): value is Plan {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		isNonEmptyStringArray(v.decisions) &&
		Array.isArray(v.fileMap) &&
		v.fileMap.length > 0 &&
		v.fileMap.every(isPlanFileRef) &&
		isNonEmptyStringArray(v.verifyCommands)
	);
}

export function isWriteResult(value: unknown): value is WriteResult {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	if (v.status === 'done') return true;
	if (v.status === 'blocked') return isNonEmptyString(v.reason);
	return false;
}

export function isReview(value: unknown): value is Review {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	if (v.verdict === 'approved') return true;
	if (v.verdict === 'needs-revision') return isNonEmptyStringArray(v.comments);
	return false;
}
