import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import net from 'node:net';
import path from 'path';

const DEV_HOST = '127.0.0.1';
const DEV_PORT = 5173;

// Returns true if the port can actually be bound on the host (catches both
// EADDRINUSE and Windows EACCES on excluded/reserved port ranges).
function canBind(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const srv = net.createServer();
		srv.once('error', () => resolve(false));
		srv.once('listening', () => srv.close(() => resolve(true)));
		srv.listen(port, host);
	});
}

async function findDevPort(host: string, start: number, tries = 25): Promise<number> {
	for (let port = start; port < start + tries; port += 1) {
		if (await canBind(host, port)) return port;
	}
	return start;
}

// Dev only: bind to 127.0.0.1 and auto-pick the first bindable port from 5173.
// Kept in a plugin so the exported config stays a plain (sync) object.
function devPortPlugin(): Plugin {
	return {
		name: 'pdm-dev-port',
		async config(_config, { command }) {
			if (command !== 'serve' || process.env.VITEST) return;
			return {
				server: { host: DEV_HOST, port: await findDevPort(DEV_HOST, DEV_PORT), strictPort: true }
			};
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), devPortPlugin()],
	resolve: {
		alias: {
			$styles: path.resolve('./src/styles')
		}
	},
	css: {
		preprocessorOptions: {
			scss: {
				additionalData: `@use '$styles/variables' as *;`
			}
		}
	},
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			include: [
				'src/lib/server/music/**',
				'src/lib/server/events/**',
				'src/lib/server/media/validation.ts',
				'src/lib/server/media/uploadTargetHandler.ts',
				'src/lib/server/media/logging.ts',
				'src/lib/server/security/**',
				'src/lib/server/chat/**',
				'src/lib/db/services/ChatRepository.ts',
				'src/routes/api/chat/**'
			],
			// Barrel re-exports and type-only modules carry no testable logic.
			exclude: ['**/index.ts', '**/types.ts'],
			thresholds: {
				lines: 90,
				branches: 90,
				functions: 90,
				statements: 90,

				'src/lib/server/chat/**': {
					lines: 100,
					branches: 100,
					functions: 100,
					statements: 100
				},
				'src/lib/db/services/ChatRepository.ts': {
					lines: 100,
					branches: 100,
					functions: 100,
					statements: 100
				},
				'src/routes/api/chat/**': {
					lines: 100,
					branches: 100,
					functions: 100,
					statements: 100
				}
			}
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
