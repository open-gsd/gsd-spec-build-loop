import assert from "node:assert/strict";
import {
  parseAuditArguments,
  parseAuditEvidence,
  validateAuditEvidence,
  validateAuditProjection,
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
const marker = `Dependency audit for ${head}: baseline compared`;

function evidenceBody(evidence) {
  return `${marker}\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\``;
}

function projectionPage({
  author = "builder",
  body = "",
  comments = [],
  hasNextPage = false,
  baseRefOid = baseline,
  headRefOid = head,
} = {}) {
  return {
    data: {
      repository: {
        pullRequest: {
          author: { login: author },
          body,
          baseRefOid,
          headRefOid,
          comments: {
            nodes: comments,
            pageInfo: { hasNextPage, endCursor: hasNextPage ? "cursor" : null },
          },
        },
      },
    },
  };
}

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
assert.deepEqual(validateAuditProjection([
  projectionPage({ body: evidenceBody(valid) }),
], expected), {
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

const paginated = [
  projectionPage({
    body: evidenceBody(valid),
    comments: [{
      author: { login: "stranger" },
      body: evidenceBody(high),
      isMinimized: false,
    }],
    hasNextPage: true,
  }),
  projectionPage({
    body: evidenceBody(valid),
    comments: [{
      author: { login: "builder" },
      body: evidenceBody(high),
      isMinimized: false,
    }],
  }),
];
assert.deepEqual(validateAuditProjection(paginated, expected), {
  status: "blocking",
  newHighCritical: [{
    id: "GHSA-2222",
    package: "new-package",
    severity: "high",
  }],
});

assert.throws(
  () => validateAuditProjection([
    projectionPage({
      comments: [{
        author: { login: "stranger" },
        body: evidenceBody(valid),
        isMinimized: false,
      }],
    }),
  ], expected),
  /no current-head marker/,
);
assert.throws(
  () => validateAuditProjection([
    projectionPage({
      comments: [{
        author: { login: "builder" },
        body: evidenceBody(valid),
        isMinimized: true,
      }],
    }),
  ], expected),
  /no current-head marker/,
);
assert.throws(
  () => validateAuditProjection([
    projectionPage({ body: evidenceBody(valid), hasNextPage: true }),
  ], expected),
  /missing comment pages/,
);

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
