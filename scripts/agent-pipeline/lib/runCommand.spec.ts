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
});
