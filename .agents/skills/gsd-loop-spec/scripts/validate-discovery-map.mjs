#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceModule = fileURLToPath(new URL("../../../../lib/discovery-map.mjs", import.meta.url));
const bundledModule = fileURLToPath(new URL("./runtime/discovery-map.mjs", import.meta.url));
const modulePath = existsSync(bundledModule) ? bundledModule : sourceModule;
const { parseDiscoveryArguments, validateDiscoveryMap } = await import(pathToFileURL(modulePath));

try {
  const options = parseDiscoveryArguments(process.argv.slice(2));
  const result = validateDiscoveryMap(readFileSync(options.path, "utf8"), options);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`gsd-loop discovery map: ${error.message}`);
  process.exit(error.exitCode ?? 1);
}
