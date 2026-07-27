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

function pullRequestPages(projection, expected) {
  if (!Array.isArray(projection) || !projection.length) {
    throw new BlockedError("audit evidence projection must contain GraphQL pages");
  }
  const pages = projection.map((page) => page?.data?.repository?.pullRequest);
  if (pages.some((page) => !page)) {
    throw new BlockedError("audit evidence projection has a missing pull request page");
  }
  const first = pages[0];
  if (
    typeof first.author?.login !== "string"
    || typeof first.body !== "string"
    || first.baseRefOid !== expected.baseline
    || first.headRefOid !== expected.head
  ) {
    throw new BlockedError("audit evidence projection has stale or malformed PR provenance");
  }
  if (pages.at(-1).comments?.pageInfo?.hasNextPage) {
    throw new BlockedError("audit evidence projection is missing comment pages");
  }
  for (const [index, page] of pages.entries()) {
    const pageInfo = page.comments?.pageInfo;
    if (
      page.author?.login !== first.author.login
      || page.body !== first.body
      || page.baseRefOid !== first.baseRefOid
      || page.headRefOid !== first.headRefOid
      || !Array.isArray(page.comments?.nodes)
      || pageInfo?.hasNextPage !== (index < pages.length - 1)
      || (pageInfo.hasNextPage && typeof pageInfo.endCursor !== "string")
    ) {
      throw new BlockedError("audit evidence projection changed or is malformed across pages");
    }
  }
  return pages;
}

function extractAdjacentEvidence(body, marker) {
  const lines = body.split(/\r?\n/);
  const markers = lines
    .map((line, index) => (line === marker ? index : -1))
    .filter((index) => index !== -1);
  if (markers.length !== 1) {
    throw new BlockedError("trusted audit evidence must contain one current-head marker");
  }
  const markerIndex = markers[0];
  if (lines[markerIndex + 1] !== "```json") {
    throw new BlockedError("trusted audit evidence marker must be followed by fenced JSON");
  }
  const fenceEnd = lines.indexOf("```", markerIndex + 2);
  if (fenceEnd === -1) {
    throw new BlockedError("trusted audit evidence JSON fence is not closed");
  }
  return parseAuditEvidence(lines.slice(markerIndex + 2, fenceEnd).join("\n"));
}

export function validateAuditProjection(projection, expected) {
  const pages = pullRequestPages(projection, expected);
  const author = pages[0].author.login;
  const marker = `Dependency audit for ${expected.head}: baseline compared`;
  const sources = [pages[0].body];
  for (const page of pages) {
    for (const comment of page.comments.nodes) {
      if (
        comment?.author?.login === author
        && comment.isMinimized === false
        && typeof comment.body === "string"
      ) {
        sources.push(comment.body);
      }
    }
  }
  let source = null;
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    if (sources[index].split(/\r?\n/).includes(marker)) {
      source = sources[index];
      break;
    }
  }
  if (!source) {
    throw new BlockedError("trusted audit evidence has no current-head marker");
  }
  return validateAuditEvidence(extractAdjacentEvidence(source, marker), expected);
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
