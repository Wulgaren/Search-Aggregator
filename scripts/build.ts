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

  const css = await Bun.spawn(
    ["bun", "build", "src/style.css", "--outfile=style.css", "--minify", "--production"],
    { stdout: "inherit", stderr: "inherit", cwd: root }
  ).exited;
  if (css !== 0) process.exit(css);

  console.log("Built script.js + style.css");
}

await build();

if (process.argv.includes("--watch")) {
  watch(join(root, "src"), { recursive: true }, () => {
    void build();
  });
  console.log("Watching src/ …");
}
