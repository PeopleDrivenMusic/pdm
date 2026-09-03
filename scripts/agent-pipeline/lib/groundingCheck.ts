import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { GateResult, Plan, PlanFileRef } from '../types.ts';

function isWithinRepo(repoRoot: string, refPath: string): boolean {
	const resolved = resolve(repoRoot, refPath);
	const rel = relative(repoRoot, resolved);
	return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function refFails(repoRoot: string, ref: PlanFileRef): boolean {
	if (!isWithinRepo(repoRoot, ref.path)) return true;
	const absolute = join(repoRoot, ref.path);
	if (!existsSync(absolute)) return true;
	const lineCount = readFileSync(absolute, 'utf-8').split('\n').length;
	return ref.line > lineCount;
}

export function groundingCheck(plan: Plan, repoRoot: string): GateResult {
	const failedRefs = plan.fileMap.filter((ref) => refFails(repoRoot, ref));
	if (failedRefs.length === 0) return { ok: true };
	const reason = `${failedRefs.length} plan reference(s) do not resolve to a real path/line: ${failedRefs
		.map((r) => `${r.path}:${r.line}`)
		.join(', ')}`;
	return { ok: false, reason, failedRefs };
}
