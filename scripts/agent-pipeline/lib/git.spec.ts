import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	commitFiles,
	currentBranch,
	diffFile,
	isWorkingTreeClean,
	listDirtyFiles,
	revertFiles
} from './git.ts';

describe('git helpers', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'git-helpers-'));
		execFileSync('git', ['init', '--initial-branch=main'], { cwd: repo });
		execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
		execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
		// Pin line endings for this temp repo regardless of the machine's global
		// core.autocrlf — otherwise `git checkout` can restore CRLF where the
		// test wrote LF, which is a Windows git config artifact, not a real
		// difference this test should be sensitive to.
		execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repo });
		writeFileSync(join(repo, 'tracked.txt'), 'original\n');
		execFileSync('git', ['add', 'tracked.txt'], { cwd: repo });
		execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo });
	});

	afterEach(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	it('currentBranch returns the real checked-out branch name', () => {
		expect(currentBranch(repo)).toBe('main');
	});

	it('isWorkingTreeClean is true right after a commit, false after an edit', () => {
		expect(isWorkingTreeClean(repo)).toBe(true);
		writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
		expect(isWorkingTreeClean(repo)).toBe(false);
	});

	it('commitFiles stages exactly the given files and commits them', () => {
		writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
		writeFileSync(join(repo, 'new.txt'), 'brand new\n');
		commitFiles(repo, ['tracked.txt', 'new.txt'], 'slice 1');
		expect(isWorkingTreeClean(repo)).toBe(true);
		const log = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf-8' });
		expect(log.trim()).toBe('slice 1');
	});

	it('revertFiles restores a tracked file to its last commit', () => {
		writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
		revertFiles(repo, ['tracked.txt']);
		expect(readFileSync(join(repo, 'tracked.txt'), 'utf-8')).toBe('original\n');
		expect(isWorkingTreeClean(repo)).toBe(true);
	});

	it('revertFiles deletes an untracked (never-committed) new file entirely', () => {
		const newFile = join(repo, 'never-committed.txt');
		writeFileSync(newFile, 'oops\n');
		revertFiles(repo, ['never-committed.txt']);
		expect(existsSync(newFile)).toBe(false);
		expect(isWorkingTreeClean(repo)).toBe(true);
	});

	it('does not print git\'s "did you forget to add" noise for an untracked file being reverted', () => {
		// Live bug (2026-09-07): the real first execute run logged two scary
		// "pathspec did not match... did you forget to 'git add'?" lines for
		// its two brand-new files, which looked like a crash but wasn't —
		// revertFiles completed and left the tree clean either way. The noise
		// comes from the internal is-it-tracked probe, which is *expected* to
		// "fail" for every new file; it should never reach stderr.
		const newFile = join(repo, 'never-committed.txt');
		writeFileSync(newFile, 'oops\n');
		const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		try {
			revertFiles(repo, ['never-committed.txt']);
		} finally {
			expect(stderrSpy).not.toHaveBeenCalled();
			stderrSpy.mockRestore();
		}
	});

	it('diffFile returns an empty string when the file matches HEAD', () => {
		expect(diffFile(repo, 'tracked.txt')).toBe('');
	});

	it('diffFile returns a non-empty unified diff when the file changed', () => {
		writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
		const diff = diffFile(repo, 'tracked.txt');
		expect(diff).toContain('-original');
		expect(diff).toContain('+changed');
	});

	it('listDirtyFiles lists both modified tracked files and new untracked files', () => {
		writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
		writeFileSync(join(repo, 'new.txt'), 'brand new\n');
		expect(listDirtyFiles(repo).sort()).toEqual(['new.txt', 'tracked.txt']);
	});

	it('listDirtyFiles returns an empty array on a clean tree', () => {
		expect(listDirtyFiles(repo)).toEqual([]);
	});
});
