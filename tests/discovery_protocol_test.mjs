import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireFilingLock,
  fileDiscoverySlice,
  filingLockName,
  parseDiscoveryProtocolArguments,
  reconcileDecisionIssues,
  releaseFilingLock,
  validateDecisionEvidence,
} from "../lib/discovery-protocol.mjs";

const map = 10;
const repo = "octocat/project";
const token = "test-token";
const gist = "- [Choose channel](https://github.com/octocat/project/issues/7) — Use verified email.";

function mapBody({ issue = "#7", queue = "None." } = {}) {
  return `## Destination

Ship account recovery.

## Decisions so far

${gist}

## Decision frontier

### D-1 — Choose channel

Type: Discussion
Question: Which channel carries recovery links?
Needs: None.
Issue: ${issue}

## Not yet specified

None.

## Out of scope

None.

## Delivery slices

### S-1 — Request recovery

Delivers: A user can request recovery.
Needs: None.

## Graduation

Ready for \`gsd-loop-spec\`.

## Queue issues

${queue}
`;
}

function decisionBody() {
  return `## Map

#10

## Decision ID

D-1

## Type

Discussion

## Question

Which channel carries recovery links?`;
}

function pages(items) {
  return JSON.stringify([items]);
}

assert.equal(filingLockName(10), "gsd-loop-spec-map-10");
assert.equal(filingLockName(10).startsWith("gsd:"), false);
assert.deepEqual(
  parseDiscoveryProtocolArguments(["lock", "10", "--repo", repo]),
  {
    command: "lock",
    map: 10,
    repo,
    token: null,
    slice: null,
    title: null,
    bodyPath: null,
  },
);

const lockCalls = [];
function lockRun(program, argumentsList) {
  lockCalls.push(argumentsList);
  if (argumentsList[1] === "view") {
    return {
      status: 0,
      stdout: JSON.stringify({ description: `Active gsd-loop spec filing reservation ${token}` }),
      stderr: "",
    };
  }
  return { status: 0, stdout: "", stderr: "" };
}
assert.deepEqual(acquireFilingLock({ repo, map, token, run: lockRun }), {
  label: "gsd-loop-spec-map-10",
  token,
});
releaseFilingLock({ repo, map, token, run: lockRun });
assert.deepEqual(lockCalls.map((call) => call.slice(0, 3)), [
  ["label", "create", "gsd-loop-spec-map-10"],
  ["label", "view", "gsd-loop-spec-map-10"],
  ["label", "delete", "gsd-loop-spec-map-10"],
]);

assert.throws(
  () => acquireFilingLock({
    repo,
    map,
    run(program, argumentsList) {
      return argumentsList[1] === "view"
        ? { status: 0, stdout: JSON.stringify({ description: "another token" }), stderr: "" }
        : { status: 1, stdout: "", stderr: "already exists" };
    },
  }),
  /already active/,
);
assert.throws(
  () => acquireFilingLock({
    repo,
    map,
    run() {
      return { status: 1, stdout: "", stderr: "network unavailable" };
    },
  }),
  /network unavailable/,
);

const reconcileState = {
  mapBody: mapBody({ issue: "Pending." }),
  attached: [],
};
function reconcileRun(program, argumentsList, options = {}) {
  const joined = argumentsList.join(" ");
  if (joined.includes("issue view 10")) {
    return {
      status: 0,
      stdout: JSON.stringify({ body: reconcileState.mapBody, state: "open", labels: [] }),
      stderr: "",
    };
  }
  if (joined.includes("issues?state=all")) {
    return {
      status: 0,
      stdout: pages([{
        id: 501,
        number: 7,
        title: "Choose channel",
        body: decisionBody(),
        html_url: "https://github.com/octocat/project/issues/7",
      }]),
      stderr: "",
    };
  }
  if (joined.includes("sub_issues?")) {
    return {
      status: 0,
      stdout: pages(reconcileState.attached.map((number) => ({ number }))),
      stderr: "",
    };
  }
  if (joined.includes("dependencies/blocked_by?")) {
    return { status: 0, stdout: pages([]), stderr: "" };
  }
  if (joined.includes("--method POST")) {
    assert.ok(joined.includes("sub_issue_id=501"));
    reconcileState.attached.push(7);
    return { status: 0, stdout: "{}", stderr: "" };
  }
  if (joined.includes("issue edit 10")) {
    reconcileState.mapBody = options.input;
    return { status: 0, stdout: "", stderr: "" };
  }
  return { status: 1, stdout: "", stderr: `unexpected: ${joined}` };
}
assert.deepEqual(reconcileDecisionIssues({ repo, map, run: reconcileRun }), {
  attached: [7],
  dependencies: [],
  missing: [],
});
assert.match(reconcileState.mapBody, /Issue: #7/);

function evidenceRunFactory({ association = "MEMBER", duplicate = false } = {}) {
  return function evidenceRun(program, argumentsList) {
    const joined = argumentsList.join(" ");
    if (joined.includes("issue view 10")) {
      return {
        status: 0,
        stdout: JSON.stringify({ body: mapBody(), state: "open", labels: [] }),
        stderr: "",
      };
    }
    if (joined.includes("issues?state=all")) {
      return {
        status: 0,
        stdout: pages([{ number: 7, body: decisionBody() }]),
        stderr: "",
      };
    }
    if (joined.includes("sub_issues?")) {
      return {
        status: 0,
        stdout: pages([{ number: 7, title: "Choose channel", state: "closed" }]),
        stderr: "",
      };
    }
    if (joined.includes("/comments?")) {
      const comment = {
        author_association: association,
        user: { login: "resolver" },
        body: `gsd-loop decision for map #10

## Resolution

Use email.

## Evidence

None.

## Consequences

Recovery can be specified.

## Map gist

${gist}`,
      };
      return { status: 0, stdout: pages(duplicate ? [comment, comment] : [comment]), stderr: "" };
    }
    if (joined.includes("dependencies/blocked_by?")) {
      return { status: 0, stdout: pages([]), stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected: ${joined}` };
  };
}
assert.equal(validateDecisionEvidence({ repo, map, run: evidenceRunFactory() }), 1);
assert.throws(
  () => validateDecisionEvidence({ repo, map, run: evidenceRunFactory({ association: "NONE" }) }),
  /not trusted/,
);
assert.throws(
  () => validateDecisionEvidence({ repo, map, run: evidenceRunFactory({ duplicate: true }) }),
  /exactly one trusted resolution/,
);

const testRoot = mkdtempSync(join(tmpdir(), "gsd-loop-protocol-"));
try {
  const draftPath = join(testRoot, "slice.md");
  const draft = `## Why

Discovery map: #10
Discovery slice: S-1

## Outcomes

- [ ] O-1 — A user can request recovery.
`;
  writeFileSync(draftPath, draft);
  const filingState = { issues: [], mapBody: mapBody(), createAttempts: 0 };
  function filingRun(program, argumentsList, options = {}) {
    const joined = argumentsList.join(" ");
    if (joined.includes("label view")) {
      return {
        status: 0,
        stdout: JSON.stringify({ description: `Active gsd-loop spec filing reservation ${token}` }),
        stderr: "",
      };
    }
    if (joined.includes("issues?state=all")) {
      return { status: 0, stdout: pages(filingState.issues), stderr: "" };
    }
    if (joined.includes("issue create")) {
      filingState.createAttempts += 1;
      filingState.issues.push({
        id: 601,
        number: 20,
        title: "Request recovery",
        body: draft,
        html_url: "https://github.com/octocat/project/issues/20",
      });
      return { status: 1, stdout: "", stderr: "response lost" };
    }
    if (joined.includes("issue view 10")) {
      return {
        status: 0,
        stdout: JSON.stringify({ body: filingState.mapBody, state: "open", labels: [] }),
        stderr: "",
      };
    }
    if (joined.includes("issue edit 10")) {
      filingState.mapBody = options.input;
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected: ${joined}` };
  }
  const filed = fileDiscoverySlice({
    repo,
    map,
    token,
    slice: "S-1",
    title: "Request recovery",
    bodyPath: draftPath,
    run: filingRun,
  });
  assert.equal(filed.number, 20);
  assert.equal(filingState.createAttempts, 1);
  assert.match(filingState.mapBody, /- S-1 — \[Request recovery\].*issues\/20/);
  fileDiscoverySlice({
    repo,
    map,
    token,
    slice: "S-1",
    title: "Request recovery",
    bodyPath: draftPath,
    run: filingRun,
  });
  assert.equal(filingState.createAttempts, 1);
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

console.log("discovery protocol passed");
