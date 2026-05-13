#!/usr/bin/env bun
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { watch as watchLegacy } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");

function disableGoogleBangFromEnv(): boolean {
  const v = process.env.DISABLE_GOOGLE_BANG ?? process.env.disable_google_bang;
  return v === "true" || v === "1" || v === "yes";
}

async function syncStaticAssetsToPublic(): Promise<void> {
  await mkdir(publicDir, { recursive: true });
  const copies: Array<[string, string]> = [
    [join(root, "index.html"), join(publicDir, "index.html")],
    [join(root, "favicon.svg"), join(publicDir, "favicon.svg")],
    [join(root, "robots.txt"), join(publicDir, "robots.txt")],
  ];
  for (const [from, to] of copies) {
    if (!existsSync(from)) {
      throw new Error(`Missing static asset: ${from}`);
    }
    await cp(from, to);
  }
  const fontsSrc = join(root, "fonts");
  if (existsSync(fontsSrc)) {
    await cp(fontsSrc, join(publicDir, "fonts"), { recursive: true });
  }
}

async function build(): Promise<void> {
  const disableGoogleBang = disableGoogleBangFromEnv();
  const define = {
    __DISABLE_GOOGLE_BANG__: JSON.stringify(disableGoogleBang),
  };

  await syncStaticAssetsToPublic();

  const early = await Bun.build({
    entrypoints: [join(root, "src/early-fetch-entry.ts")],
    outdir: publicDir,
    naming: "early-fetch-entry.js",
    minify: true,
    format: "iife",
    target: "browser",
    define,
  });
  if (!early.success) {
    console.error(early.logs);
    process.exit(1);
  }

  const main = await Bun.build({
    entrypoints: [join(root, "src/script.ts")],
    outdir: publicDir,
    naming: "script.js",
    minify: true,
    target: "browser",
    define,
  });
  if (!main.success) {
    console.error(main.logs);
    process.exit(1);
  }

  await Bun.write(
    join(publicDir, "style.css"),
    await Bun.file(join(root, "src/style.css")).text()
  );

  console.log(
    `Built early-fetch-entry.js + script.js + style.css → ${publicDir}/`
  );
}

await build();

if (process.argv.includes("--watch")) {
  watchLegacy(join(root, "src"), { recursive: true }, () => {
    void build();
  });
  console.log("Watching src/ …");
}
