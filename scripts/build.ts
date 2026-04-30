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
  const result = await Bun.build({
    entrypoints: [join(root, "src/script.ts")],
    outdir: root,
    naming: "script.js",
    minify: true,
    target: "browser",
    define: {
      __DISABLE_GOOGLE_BANG__: JSON.stringify(disableGoogleBang),
    },
  });
  if (!result.success) {
    console.error(result.logs);
    process.exit(1);
  }

  await Bun.write(
    join(root, "style.css"),
    await Bun.file(join(root, "src/style.css")).text()
  );

  console.log("Built script.js + style.css");
}

await build();

if (process.argv.includes("--watch")) {
  watch(join(root, "src"), { recursive: true }, () => {
    void build();
  });
  console.log("Watching src/ …");
}
