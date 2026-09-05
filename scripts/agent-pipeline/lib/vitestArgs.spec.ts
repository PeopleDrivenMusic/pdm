import { describe, expect, it } from 'vitest';
import { vitestArgsFor } from './vitestArgs.ts';

describe('vitestArgsFor', () => {
	it('routes a plain .spec.ts file to the server project', () => {
		expect(vitestArgsFor('src/lib/stores/artist-view-cache.spec.ts')).toEqual([
			'vitest',
			'--project',
			'server',
			'--run',
			'src/lib/stores/artist-view-cache.spec.ts'
		]);
	});

	it('routes a .svelte.spec.ts file to the client (browser) project', () => {
		expect(vitestArgsFor('src/routes/(app)/artist/[slug]/[view]/page.svelte.spec.ts')).toEqual([
			'vitest',
			'--project',
			'client',
			'--run',
			'src/routes/(app)/artist/[slug]/[view]/page.svelte.spec.ts'
		]);
	});

	it('routes a .test.ts file the same as .spec.ts', () => {
		expect(vitestArgsFor('src/lib/foo.test.ts')[2]).toBe('server');
	});
});
