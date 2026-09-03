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

export type ReviewRoundTrace = { round: number; verdict: Review['verdict']; commentCount: number };

export type StageTrace = {
	name: string;
	attempts: number;
	outcome: 'ok' | 'escalated' | 'unapproved';
	durationMs: number;
	costUsd: number;
	reflectionFired: boolean;
	review?: ReviewRoundTrace[];
};

export type RunTrace = {
	runId: string;
	task: string;
	stages: StageTrace[];
	injected: boolean;
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

export function isReview(value: unknown): value is Review {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	if (v.verdict === 'approved') return true;
	if (v.verdict === 'needs-revision') return isNonEmptyStringArray(v.comments);
	return false;
}
