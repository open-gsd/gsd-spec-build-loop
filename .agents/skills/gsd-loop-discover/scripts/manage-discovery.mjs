#!/usr/bin/env node

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceModule = fileURLToPath(new URL("../../../../lib/discovery-protocol.mjs", import.meta.url));
const bundledModule = fileURLToPath(new URL("./runtime/discovery-protocol.mjs", import.meta.url));
const modulePath = existsSync(bundledModule) ? bundledModule : sourceModule;
const {
  parseDiscoveryProtocolArguments,
  runDiscoveryProtocol,
} = await import(pathToFileURL(modulePath));

try {
  const options = parseDiscoveryProtocolArguments(process.argv.slice(2));
  console.log(JSON.stringify(runDiscoveryProtocol(options)));
} catch (error) {
  console.error(`gsd-loop discovery protocol: ${error.message}`);
  process.exit(error.exitCode ?? 1);
}
