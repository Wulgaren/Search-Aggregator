import process from 'node:process';
import { defineConfig } from 'vitest/config';

function disableGoogleBangFromEnv(): boolean {
    const v = process.env.DISABLE_GOOGLE_BANG ?? process.env.disable_google_bang;
    return v === 'true' || v === '1' || v === 'yes';
}

// Node ≥25 enables native Web Storage that shadows jsdom's localStorage (Vitest #8757).
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
const webstorageExecArgv = nodeMajor >= 25 ? ['--no-webstorage'] : [];

export default defineConfig({
    define: {
        __DISABLE_GOOGLE_BANG__: JSON.stringify(disableGoogleBangFromEnv()),
    },
    test: {
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                url: 'http://localhost/',
            },
        },
        pool: 'forks',
        poolOptions: {
            forks: {
                execArgv: webstorageExecArgv,
                // Cap workers — uncapped forks + jsdom melted the machine (load 14+).
                maxForks: 2,
                minForks: 1,
            },
        },
        fileParallelism: true,
        maxConcurrency: 4,
        setupFiles: ['./vitest.setup.ts'],
        include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
        globals: false,
    },
});
