/** Matches this repo's own vitest project split (vite.config.ts): browser env for *.svelte.{test,spec}.ts, node env for everything else. */
export function vitestArgsFor(testFile: string): string[] {
	const project = /\.svelte\.(?:spec|test)\.ts$/.test(testFile) ? 'client' : 'server';
	return ['vitest', '--project', project, '--run', testFile];
}
