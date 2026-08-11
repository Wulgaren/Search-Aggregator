#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type InlineConfig } from 'vite';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');

const CACHE_BUST_ASSETS = ['style.css', 'early-fetch-entry.js', 'script.js'] as const;

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

async function shortContentHash(filePath: string): Promise<string> {
    const buf = await readFile(filePath);
    return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

/** Rewrite `asset?v=…` in index.html from content hashes of built public assets. */
async function updateIndexCacheBustVersions(): Promise<Record<string, string>> {
    const versions: Record<string, string> = {};
    for (const asset of CACHE_BUST_ASSETS) {
        versions[asset] = await shortContentHash(join(publicDir, asset));
    }

    const indexPaths = [join(root, 'index.html'), join(publicDir, 'index.html')];
    for (const indexPath of indexPaths) {
        let html = await readFile(indexPath, 'utf8');
        for (const [asset, version] of Object.entries(versions)) {
            const pattern = new RegExp(`${asset.replace(/\./g, '\\.')}\\?v=[^"'\\s]*`, 'g');
            html = html.replace(pattern, `${asset}?v=${version}`);
        }
        await writeFile(indexPath, html);
    }

    return versions;
}

async function buildClient(): Promise<void> {
    await syncStaticAssetsToPublic();

    await build(
        iifeBuildConfig(join(root, 'src/early-fetch-entry.ts'), 'early-fetch-entry.js', 'EarlyFetch')
    );
    await build(iifeBuildConfig(join(root, 'src/script.ts'), 'script.js', 'SearchApp'));

    await copyFile(join(root, 'src/style.css'), join(publicDir, 'style.css'));

    const versions = await updateIndexCacheBustVersions();
    const versionSummary = CACHE_BUST_ASSETS.map((asset) => `${asset}?v=${versions[asset]}`).join(', ');
    console.log(`Built early-fetch-entry.js + script.js + style.css → ${publicDir}/`);
    console.log(`Cache bust: ${versionSummary}`);
}

await buildClient();

if (process.argv.includes('--watch')) {
    watch(join(root, 'src'), { recursive: true }, () => {
        void buildClient();
    });
    console.log('Watching src/ …');
}
