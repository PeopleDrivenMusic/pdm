import { describe, expect, it } from 'vitest';
import { runCommand } from './runCommand.ts';

describe('runCommand', () => {
	it('reports ok:true and captures stdout for a command that exits 0', () => {
		const result = runCommand('node', ['-e', "console.log('hello')"]);
		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('hello');
	});

	it('reports ok:false with the real exit code for a command that exits non-zero', () => {
		const result = runCommand('node', ['-e', 'process.exit(3)']);
		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(3);
	});

	it('captures stderr in output too, not just stdout', () => {
		const result = runCommand('node', ['-e', "console.error('boom'); process.exit(1)"]);
		expect(result.ok).toBe(false);
		expect(result.output).toContain('boom');
	});

	it('never throws for a nonexistent binary — reports ok:false instead', () => {
		const result = runCommand('this-binary-does-not-exist-xyz', []);
		expect(result.ok).toBe(false);
	});

	// Live bug (2026-09-07): a real coder attempt OOM'd running the project's
	// test/check gates on a machine separately known to BSOD under heavy I/O —
	// an unbounded child heap can take the whole OS down, not just its own
	// process. This must be a real cap the child process receives, not just
	// documented intent.
	it('caps the child process heap via NODE_OPTIONS to avoid an unbounded OOM', () => {
		const result = runCommand('node', ['-e', 'console.log(process.env.NODE_OPTIONS)']);
		expect(result.output).toContain('--max-old-space-size=4096');
	});

	it('appends to an existing NODE_OPTIONS rather than overwriting it', () => {
		const original = process.env.NODE_OPTIONS;
		process.env.NODE_OPTIONS = '--stack-trace-limit=50';
		try {
			const result = runCommand('node', ['-e', 'console.log(process.env.NODE_OPTIONS)']);
			expect(result.output).toContain('--stack-trace-limit=50');
			expect(result.output).toContain('--max-old-space-size=4096');
		} finally {
			if (original === undefined) delete process.env.NODE_OPTIONS;
			else process.env.NODE_OPTIONS = original;
		}
	});
});
