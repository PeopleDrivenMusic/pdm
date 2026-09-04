import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeEscalation, writeReviewNotes, writeRunTrace } from './trace.ts';
import type { RunTrace } from '../types.ts';

describe('writeRunTrace', () => {
	let runDir: string;

	beforeEach(() => {
		runDir = mkdtempSync(join(tmpdir(), 'trace-'));
	});

	afterEach(() => {
		rmSync(runDir, { recursive: true, force: true });
	});

	it('writes summary.json with the exact trace shape', () => {
		const trace: RunTrace = {
			runId: '2026-09-03T00-00-00',
			task: 'artist-page URL routing',
			stages: [
				{
					name: 'spec',
					attempts: 1,
					outcome: 'ok',
					durationMs: 5694,
					usage: { costUsd: 0.12, inputTokens: 2100, outputTokens: 340 },
					lessons: []
				}
			],
			totals: { costUsd: 0.12, inputTokens: 2100, outputTokens: 340, durationMs: 5694 },
			outcome: 'ok',
			injected: false
		};
		writeRunTrace(runDir, trace);
		const written = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf-8'));
		expect(written).toEqual(trace);
	});
});

describe('writeEscalation', () => {
	let runDir: string;

	beforeEach(() => {
		runDir = mkdtempSync(join(tmpdir(), 'trace-'));
	});

	afterEach(() => {
		rmSync(runDir, { recursive: true, force: true });
	});

	it('writes escalation.md containing the stage name, reason, and last attempt', () => {
		writeEscalation(runDir, {
			stageName: 'plan',
			reason: "fileMap[0].path 'src/ghost.ts' does not exist",
			lastAttempt: { decisions: ['x'], fileMap: [], verifyCommands: [] }
		});
		const written = readFileSync(join(runDir, 'escalation.md'), 'utf-8');
		expect(written).toContain('plan');
		expect(written).toContain("fileMap[0].path 'src/ghost.ts' does not exist");
		expect(written).toContain('"decisions"');
	});
});

describe('writeReviewNotes', () => {
	let runDir: string;

	beforeEach(() => {
		runDir = mkdtempSync(join(tmpdir(), 'trace-'));
	});

	afterEach(() => {
		rmSync(runDir, { recursive: true, force: true });
	});

	it('writes review-notes.md with the round count and every unresolved comment', () => {
		writeReviewNotes(runDir, {
			rounds: 3,
			comments: ["Requirement 'per-view lazy loading' has no matching decision"]
		});
		const written = readFileSync(join(runDir, 'review-notes.md'), 'utf-8');
		expect(written).toContain('3');
		expect(written).toContain("Requirement 'per-view lazy loading' has no matching decision");
		expect(written).toContain('final call is yours');
	});
});
