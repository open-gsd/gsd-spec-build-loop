#!/usr/bin/env node

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceModule = fileURLToPath(new URL("../../../../lib/linkage.mjs", import.meta.url));
const bundledModule = fileURLToPath(new URL("./runtime/linkage.mjs", import.meta.url));
const modulePath = existsSync(bundledModule) ? bundledModule : sourceModule;
const { ensurePullRequestLinkage, parseLinkageArguments } = await import(pathToFileURL(modulePath));

try {
  const options = parseLinkageArguments(process.argv.slice(2));
  const changed = ensurePullRequestLinkage({ cwd: process.cwd(), ...options });
  console.log(`PR #${options.pullRequest} linkage: ${changed ? "restored" : "already present"}`);
} catch (error) {
  console.error(`gsd-loop linkage: ${error.message}`);
  process.exit(error.exitCode ?? 1);
}
