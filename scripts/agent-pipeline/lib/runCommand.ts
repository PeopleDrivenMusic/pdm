import { spawnSync } from 'node:child_process';

export type CommandResult = { ok: boolean; exitCode: number | null; output: string };

/**
 * Runs a real command and reports its real exit code — this is the
 * mechanical gate for test-writer (expects a nonzero exit: confirmed red)
 * and coder (expects zero: confirmed green). The orchestrator runs the
 * command itself; the agent never self-reports whether its own code passes.
 */
export function runCommand(command: string, args: string[], cwd?: string): CommandResult {
	// Live bug (2026-09-07): a real coder attempt hit an actual OOM running the
	// project's vitest/svelte-check gates on this machine, which is separately
	// known to BSOD under heavy I/O — an unbounded child heap can take down the
	// whole OS instead of just failing its own process. Capping it turns that
	// into an ordinary, catchable, retryable gate failure. Appended (not
	// overwritten) in case the environment already sets NODE_OPTIONS.
	const env = {
		...process.env,
		NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim()
	};

	// Live-verified (2026-09-04): spawnSync('yarn', ...) with shell:false is a
	// real ENOENT on Windows — yarn resolves only via its .cmd shim. `shell:
	// true` looks like the fix but isn't safe: Node's own deprecation warning
	// says it only concatenates args unescaped, and a live test proved it —
	// a semicolon inside a quoted arg silently swallowed the real exit code.
	// The correct fix (same approach cross-spawn uses on Windows) is to run
	// cmd.exe directly with /d /s /c and the real command as its own argv
	// entries, never shell:true — verified live to preserve both exit codes
	// and paths containing ()/[] (real SvelteKit route segments).
	const isWindows = process.platform === 'win32';
	const result = isWindows
		? spawnSync('cmd.exe', ['/d', '/s', '/c', command, ...args], { cwd, encoding: 'utf-8', env })
		: spawnSync(command, args, { cwd, encoding: 'utf-8', env });
	if (result.error) {
		return { ok: false, exitCode: null, output: result.error.message };
	}
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	return { ok: result.status === 0, exitCode: result.status, output };
}
