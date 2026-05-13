#!/usr/bin/env bun
import { watch } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

function disableGoogleBangFromEnv(): boolean {
  const v = process.env.DISABLE_GOOGLE_BANG ?? process.env.disable_google_bang;
  return v === "true" || v === "1" || v === "yes";
}

async function build(): Promise<void> {
  const disableGoogleBang = disableGoogleBangFromEnv();
  const define = {
    __DISABLE_GOOGLE_BANG__: JSON.stringify(disableGoogleBang),
  };

  const early = await Bun.build({
    entrypoints: [join(root, "src/early-fetch-entry.ts")],
    outdir: root,
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
    outdir: root,
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
    join(root, "style.css"),
    await Bun.file(join(root, "src/style.css")).text()
  );

  console.log("Built early-fetch-entry.js + script.js + style.css");
}

await build();

if (process.argv.includes("--watch")) {
  watch(join(root, "src"), { recursive: true }, () => {
    void build();
  });
  console.log("Watching src/ …");
}
