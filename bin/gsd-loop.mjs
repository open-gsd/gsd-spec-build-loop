#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { install, parseInstallArguments } from "../lib/install.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const metadata = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const argumentsList = process.argv.slice(2);

function usage() {
  return `Usage: gsd-loop [install] [options]

Install global, self-contained gsd-loop skills.

Options:
  --home PATH                       install beneath an alternate home directory
  --agents LIST                     codex,claude,cursor,gemini,kimi (default: all)
  --adapter-mode auto|symlink|copy  Claude adapter behavior (default: auto)
  --dry-run                         show destinations without writing
  -h, --help                        show help
  -v, --version                     show version`;
}

try {
  if (argumentsList.includes("--version") || argumentsList.includes("-v")) {
    console.log(metadata.version);
    process.exit(0);
  }
  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const command = argumentsList[0] && !argumentsList[0].startsWith("-")
    ? argumentsList.shift()
    : "install";
  if (command !== "install") {
    throw new Error(`unknown command: ${command}`);
  }

  const options = parseInstallArguments(argumentsList);
  install({ ...options, sourceRoot: packageRoot });
} catch (error) {
  console.error(`gsd-loop: ${error.message}`);
  process.exit(1);
}
