import assert from "node:assert/strict";
import {
  parseAuditArguments,
  parseAuditEvidence,
  validateAuditEvidence,
} from "../lib/audit-evidence.mjs";

const baseline = "a".repeat(40);
const head = "b".repeat(40);
const expected = {
  baseline,
  head,
  manifests: ["package-lock.json"],
};
const valid = {
  schema: "gsd-loop/dependency-audit-v1",
  baseline,
  head,
  audits: [{
    manifests: ["package-lock.json"],
    directory: ".",
    command: ["npm", "audit", "--json"],
    baselineAdvisories: [{
      id: "GHSA-1111",
      package: "example",
      severity: "moderate",
    }],
    headAdvisories: [{
      id: "GHSA-1111",
      package: "example",
      severity: "moderate",
    }],
  }],
};

assert.deepEqual(parseAuditArguments([
  "--baseline", baseline,
  "--head", head,
  "--manifest", "package-lock.json",
]), expected);
assert.throws(() => parseAuditEvidence("{"), /valid JSON/);
assert.deepEqual(validateAuditEvidence(valid, expected), {
  status: "pass",
  newHighCritical: [],
});

const high = structuredClone(valid);
high.audits[0].headAdvisories.push({
  id: "GHSA-2222",
  package: "new-package",
  severity: "high",
});
assert.deepEqual(validateAuditEvidence(high, expected), {
  status: "blocking",
  newHighCritical: [{
    id: "GHSA-2222",
    package: "new-package",
    severity: "high",
  }],
});

const stale = structuredClone(valid);
stale.head = "c".repeat(40);
assert.throws(() => validateAuditEvidence(stale, expected), /stale/);

const uncovered = structuredClone(valid);
uncovered.audits[0].manifests = ["other-lock.json"];
assert.throws(() => validateAuditEvidence(uncovered, expected), /cover/);

const unsorted = structuredClone(high);
unsorted.audits[0].headAdvisories.reverse();
assert.throws(() => validateAuditEvidence(unsorted, expected), /sorted and unique/);

const extraField = structuredClone(valid);
extraField.audits[0].headAdvisories[0].url = "https://example.invalid";
assert.throws(() => validateAuditEvidence(extraField, expected), /unexpected or missing/);

console.log("dependency audit evidence validation passed");
