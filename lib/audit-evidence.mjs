import { BlockedError, UsageError } from "./errors.mjs";

const SCHEMA = "gsd-loop/dependency-audit-v1";
const SHA = /^[0-9a-f]{40}$/i;
const TOP_LEVEL_KEYS = ["audits", "baseline", "head", "schema"];
const AUDIT_KEYS = [
  "baselineAdvisories",
  "command",
  "directory",
  "headAdvisories",
  "manifests",
];
const ADVISORY_KEYS = ["id", "package", "severity"];

function assertExactKeys(value, expected, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BlockedError(`${name} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new BlockedError(`${name} has unexpected or missing fields`);
  }
}

function assertStringArray(value, name) {
  if (!Array.isArray(value) || !value.length || value.some((item) => (
    typeof item !== "string" || !item
  ))) {
    throw new BlockedError(`${name} must be a nonempty string array`);
  }
}

function assertSortedUnique(values, name) {
  const sorted = [...values].sort();
  if (new Set(values).size !== values.length || JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new BlockedError(`${name} must be sorted and unique`);
  }
}

function validateAdvisories(advisories, name) {
  if (!Array.isArray(advisories)) {
    throw new BlockedError(`${name} must be an array`);
  }
  const pairs = [];
  for (const advisory of advisories) {
    assertExactKeys(advisory, ADVISORY_KEYS, `${name} advisory`);
    for (const key of ADVISORY_KEYS) {
      if (typeof advisory[key] !== "string" || !advisory[key]) {
        throw new BlockedError(`${name} advisory ${key} must be a nonempty string`);
      }
    }
    if (advisory.severity !== advisory.severity.toLowerCase()) {
      throw new BlockedError(`${name} advisory severity must be lowercase`);
    }
    pairs.push(`${advisory.id}\0${advisory.package}`);
  }
  assertSortedUnique(pairs, name);
  return new Set(pairs);
}

export function parseAuditArguments(values) {
  const options = { baseline: null, head: null, manifests: [] };
  for (let index = 0; index < values.length; index += 2) {
    const option = values[index];
    const value = values[index + 1];
    if (!["--baseline", "--head", "--manifest"].includes(option) || !value) {
      throw new UsageError(`invalid audit evidence option: ${option ?? ""}`.trim());
    }
    if (option === "--manifest") options.manifests.push(value);
    else options[option.slice(2)] = value;
  }
  if (!SHA.test(options.baseline ?? "")) {
    throw new UsageError("audit evidence requires --baseline FULL_SHA");
  }
  if (!SHA.test(options.head ?? "")) {
    throw new UsageError("audit evidence requires --head FULL_SHA");
  }
  if (!options.manifests.length) {
    throw new UsageError("audit evidence requires at least one --manifest PATH");
  }
  return options;
}

export function parseAuditEvidence(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new BlockedError("audit evidence must be valid JSON");
  }
}

export function validateAuditEvidence(evidence, expected) {
  assertExactKeys(evidence, TOP_LEVEL_KEYS, "audit evidence");
  if (evidence.schema !== SCHEMA) {
    throw new BlockedError(`audit evidence schema must be ${SCHEMA}`);
  }
  if (evidence.baseline !== expected.baseline || evidence.head !== expected.head) {
    throw new BlockedError("audit evidence baseline or head is stale");
  }
  if (!Array.isArray(evidence.audits) || !evidence.audits.length) {
    throw new BlockedError("audit evidence audits must be a nonempty array");
  }

  const coveredManifests = [];
  const newHighCritical = [];
  for (const [index, audit] of evidence.audits.entries()) {
    const name = `audit ${index + 1}`;
    assertExactKeys(audit, AUDIT_KEYS, name);
    assertStringArray(audit.manifests, `${name} manifests`);
    assertSortedUnique(audit.manifests, `${name} manifests`);
    assertStringArray(audit.command, `${name} command`);
    if (typeof audit.directory !== "string" || !audit.directory) {
      throw new BlockedError(`${name} directory must be a nonempty string`);
    }
    const baselinePairs = validateAdvisories(audit.baselineAdvisories, `${name} baselineAdvisories`);
    validateAdvisories(audit.headAdvisories, `${name} headAdvisories`);
    for (const advisory of audit.headAdvisories) {
      const pair = `${advisory.id}\0${advisory.package}`;
      if (!baselinePairs.has(pair) && ["high", "critical"].includes(advisory.severity)) {
        newHighCritical.push(advisory);
      }
    }
    coveredManifests.push(...audit.manifests);
  }

  if (new Set(coveredManifests).size !== coveredManifests.length) {
    throw new BlockedError("covered manifests must be unique");
  }
  coveredManifests.sort();
  const expectedManifests = [...expected.manifests].sort();
  if (JSON.stringify(coveredManifests) !== JSON.stringify(expectedManifests)) {
    throw new BlockedError("audit evidence does not cover the changed dependency files exactly once");
  }
  return {
    status: newHighCritical.length ? "blocking" : "pass",
    newHighCritical,
  };
}
