import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function git(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

export function currentBranch(cwd: string): string {
	return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

export function isWorkingTreeClean(cwd: string): boolean {
	return git(cwd, ['status', '--porcelain']).trim() === '';
}

export function commitFiles(cwd: string, files: string[], message: string): void {
	git(cwd, ['add', '--', ...files]);
	git(cwd, ['commit', '-m', message]);
}

function isTracked(cwd: string, file: string): boolean {
	try {
		// stdio suppressed: git prints its own "pathspec did not match... did
		// you forget to 'git add'?" error to stderr whenever this probe finds
		// an untracked file — which is the expected, routine outcome for every
		// new file a slice creates, not a real problem. Left un-suppressed,
		// a real run's log reads as if something crashed when nothing did
		// (confirmed live: revertFiles completed and left the tree clean while
		// this noise printed for every new file).
		execFileSync('git', ['ls-files', '--error-unmatch', '--', file], {
			cwd,
			stdio: ['ignore', 'ignore', 'ignore']
		});
		return true;
	} catch {
		return false;
	}
}

/** Restores tracked files to HEAD and deletes never-committed new files — used to roll a failed slice back to its last-good state. */
export function revertFiles(cwd: string, files: string[]): void {
	for (const file of files) {
		if (isTracked(cwd, file)) {
			git(cwd, ['checkout', '--', file]);
		} else {
			const absolute = join(cwd, file);
			if (existsSync(absolute)) rmSync(absolute);
		}
	}
}

export function diffFile(cwd: string, file: string): string {
	return git(cwd, ['diff', '--', file]);
}

/** Every modified-or-new path relative to HEAD — used to know exactly what a slice's agents touched, for both committing and rolling back. */
export function listDirtyFiles(cwd: string): string[] {
	const output = git(cwd, ['status', '--porcelain']);
	return output
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => line.slice(3).trim());
}
