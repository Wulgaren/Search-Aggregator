#!/usr/bin/env node
import { cp, mkdir, copyFile } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type InlineConfig } from 'vite';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');

function disableGoogleBangFromEnv(): boolean {
    const v = process.env.DISABLE_GOOGLE_BANG ?? process.env.disable_google_bang;
    return v === 'true' || v === '1' || v === 'yes';
}

async function syncStaticAssetsToPublic(): Promise<void> {
    await mkdir(publicDir, { recursive: true });
    const copies: Array<[string, string]> = [
        [join(root, 'index.html'), join(publicDir, 'index.html')],
        [join(root, 'favicon.svg'), join(publicDir, 'favicon.svg')],
        [join(root, 'robots.txt'), join(publicDir, 'robots.txt')],
    ];
    for (const [from, to] of copies) {
        if (!existsSync(from)) {
            throw new Error(`Missing static asset: ${from}`);
        }
        await cp(from, to);
    }
    const fontsSrc = join(root, 'fonts');
    if (existsSync(fontsSrc)) {
        await cp(fontsSrc, join(publicDir, 'fonts'), { recursive: true });
    }
}

function iifeBuildConfig(entry: string, fileName: string, globalName: string): InlineConfig {
    return {
        configFile: join(root, 'vite.config.ts'),
        root,
        publicDir: false,
        define: {
            __DISABLE_GOOGLE_BANG__: JSON.stringify(disableGoogleBangFromEnv()),
        },
        build: {
            outDir: publicDir,
            emptyOutDir: false,
            minify: true,
            lib: {
                entry,
                name: globalName,
                formats: ['iife'],
                fileName: () => fileName,
            },
            rollupOptions: {
                output: {
                    inlineDynamicImports: true,
                },
            },
        },
        logLevel: 'warn',
    };
}

async function buildClient(): Promise<void> {
    await syncStaticAssetsToPublic();

    await build(
        iifeBuildConfig(join(root, 'src/early-fetch-entry.ts'), 'early-fetch-entry.js', 'EarlyFetch')
    );
    await build(iifeBuildConfig(join(root, 'src/script.ts'), 'script.js', 'SearchApp'));

    await copyFile(join(root, 'src/style.css'), join(publicDir, 'style.css'));

    console.log(`Built early-fetch-entry.js + script.js + style.css → ${publicDir}/`);
}

await buildClient();

if (process.argv.includes('--watch')) {
    watch(join(root, 'src'), { recursive: true }, () => {
        void buildClient();
    });
    console.log('Watching src/ …');
}
