#!/usr/bin/env bun
import { watch } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

async function build(): Promise<void> {
  const js = await Bun.spawn(
    [
      "bun",
      "build",
      "src/script.ts",
      "--outfile=script.js",
      "--minify",
      "--target=browser",
      "--production",
    ],
    { stdout: "inherit", stderr: "inherit", cwd: root }
  ).exited;
  if (js !== 0) process.exit(js);

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
