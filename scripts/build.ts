#!/usr/bin/env bun
import { watch } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

/** Inline API secrets into the browser bundle (same vars as the former edge function). */
function processEnvDefines(): string[] {
  const keys = [
    "BRAVE_API_KEY",
    "GOOGLE_SERVICE_ACCOUNT",
    "GOOGLE_CX",
    "GROQ_API_KEY",
  ] as const;
  const out: string[] = [];
  for (const k of keys) {
    const v = process.env[k] ?? "";
    out.push("--define", `process.env.${k}=${JSON.stringify(v)}`);
  }
  return out;
}

async function build(): Promise<void> {
  const js = await Bun.spawn(
    [
      "bun",
      "build",
      "src/script.ts",
      ...processEnvDefines(),
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
