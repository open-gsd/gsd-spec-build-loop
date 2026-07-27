#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceModule = fileURLToPath(new URL("../../../../lib/audit-evidence.mjs", import.meta.url));
const bundledModule = fileURLToPath(new URL("./runtime/audit-evidence.mjs", import.meta.url));
const modulePath = existsSync(bundledModule) ? bundledModule : sourceModule;
const {
  parseAuditArguments,
  parseAuditEvidence,
  validateAuditProjection,
} = await import(pathToFileURL(modulePath));

try {
  const options = parseAuditArguments(process.argv.slice(2));
  const projection = parseAuditEvidence(readFileSync(0, "utf8"));
  const result = validateAuditProjection(projection, options);
  console.log(JSON.stringify(result));
  if (result.status === "blocking") process.exitCode = 3;
} catch (error) {
  console.error(`gsd-loop audit evidence: ${error.message}`);
  process.exit(error.exitCode ?? 1);
}
