import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileDiscoverySlice,
  parseDiscoveryProtocolArguments,
  reconcileDecisionIssues,
  reconcileDiscoverySlices,
  runDiscoveryProtocol,
  validateDecisionEvidence,
} from "../lib/discovery-protocol.mjs";

const map = 10;
const repo = "octocat/project";
const issueUrl = "https://github.com/octocat/project/issues/7";
const gist = `- [Choose channel](${issueUrl}) — Use verified email.`;

function mapBody({
  graduation = "Ready for `gsd-loop-spec`.",
  issue = "#7",
  queue = "None.",
  slices = `### S-1 — Request recovery

Delivers: A user can request recovery.
Needs: None.`,
} = {}) {
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

${slices}

## Graduation

${graduation}

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

function mapIssue(body, { state = "OPEN", labels = [{ name: "gsd:map" }] } = {}) {
  return JSON.stringify({ body, state, labels });
}

function pages(items) {
  return JSON.stringify([items]);
}

assert.deepEqual(
  parseDiscoveryProtocolArguments(["recover-slices", "10", "--repo", repo]),
  {
    command: "recover-slices",
    map: 10,
    repo,
    slice: null,
    title: null,
    bodyPath: null,
  },
);

const reconcileState = {
  mapBody: mapBody({ issue: "Pending." }),
  attached: [],
  issueTitle: "Choose channel",
};
function reconcileRun(program, argumentsList, options = {}) {
  const joined = argumentsList.join(" ");
  if (joined.includes("issue view 10")) {
    return { status: 0, stdout: mapIssue(reconcileState.mapBody), stderr: "" };
  }
  if (joined.includes("issues?state=all")) {
    return {
      status: 0,
      stdout: pages([{
        id: 501,
        number: 7,
        title: reconcileState.issueTitle,
        body: decisionBody(),
        html_url: issueUrl,
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
reconcileState.issueTitle = "Conflicting title";
assert.throws(
  () => reconcileDecisionIssues({ repo, map, run: reconcileRun }),
  /conflicts with its frontier manifest/,
);
reconcileState.issueTitle = "Choose channel";

function evidenceRunFactory({
  association = "MEMBER",
  childUrl = issueUrl,
  duplicate = false,
  labels = [{ name: "gsd:map" }],
  mapState,
  referenceTitle = "Choose channel",
  resolutionBody,
  remoteMapBody = mapBody(),
  state = "OPEN",
} = {}) {
  return function evidenceRun(program, argumentsList, options = {}) {
    const joined = argumentsList.join(" ");
    if (joined.includes("issue view 10")) {
      return {
        status: 0,
        stdout: mapIssue(mapState?.body ?? remoteMapBody, { state, labels }),
        stderr: "",
      };
    }
    if (joined.includes("issue edit 10") && mapState) {
      mapState.body = options.input;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (joined.includes("issues?state=all")) {
      return {
        status: 0,
        stdout: pages([{
          number: 7,
          title: referenceTitle,
          body: decisionBody(),
          html_url: issueUrl,
        }]),
        stderr: "",
      };
    }
    if (joined.includes("sub_issues?")) {
      return {
        status: 0,
        stdout: pages([{
          number: 7,
          title: "Choose channel",
          html_url: childUrl,
          state: "closed",
        }]),
        stderr: "",
      };
    }
    if (joined.includes("/comments?")) {
      const comment = {
        author_association: association,
        user: { login: "resolver" },
        body: resolutionBody ?? `gsd-loop decision for map #10

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
assert.throws(
  () => validateDecisionEvidence({
    repo,
    map,
    run: evidenceRunFactory({
      resolutionBody: `gsd-loop decision for map #10

## Map gist

${gist}`,
    }),
  }),
  /Resolution, Evidence, Consequences, and Map gist/,
);
assert.throws(
  () => validateDecisionEvidence({
    repo,
    map,
    run: evidenceRunFactory({
      resolutionBody: `gsd-loop decision for map #10

## Resolution

Use email.

## Evidence

None.

## Consequences

Recovery can be specified.

## Map gist

- [Choose channel](https://example.com/octocat/project/issues/7) — Use verified email.`,
    }),
  }),
  /invalid map gist/,
);
assert.throws(
  () => validateDecisionEvidence({
    repo,
    map,
    run: evidenceRunFactory({ referenceTitle: "Conflicting title" }),
  }),
  /conflicts with the frontier manifest/,
);
assert.throws(
  () => validateDecisionEvidence({
    repo,
    map,
    run: evidenceRunFactory({ state: "CLOSED" }),
  }),
  /must be open/,
);
assert.throws(
  () => validateDecisionEvidence({
    repo,
    map,
    run: evidenceRunFactory({ labels: [] }),
  }),
  /must carry gsd:map/,
);
assert.equal(
  validateDecisionEvidence({
    repo,
    map,
    mapBody: mapBody(),
    run: evidenceRunFactory({
      remoteMapBody: mapBody().replace(
        "Ready for `gsd-loop-spec`.",
        "Not ready.",
      ),
    }),
  }),
  1,
);

const originalSlices = `### S-1 — Request recovery

Delivers: A user can request recovery.
Needs: None.

### S-2 — Complete recovery

Delivers: A user can complete recovery.
Needs: None.`;
const reorderedSlices = `### S-1 — Complete recovery

Delivers: A user can complete recovery.
Needs: None.

### S-2 — Request recovery

Delivers: A user can request recovery.
Needs: None.`;
const originalPlanBody = mapBody({ slices: originalSlices });
const reorderedPlanBody = mapBody({ slices: reorderedSlices });

const testRoot = mkdtempSync(join(tmpdir(), "gsd-loop-protocol-"));
try {
  const planPath = join(testRoot, "plan.md");
  writeFileSync(planPath, reorderedPlanBody);
  const graduationState = {
    body: mapBody({ graduation: "Not ready.", slices: originalSlices }),
  };
  assert.deepEqual(
    runDiscoveryProtocol({
      bodyPath: planPath,
      command: "graduate",
      map,
      repo,
    }, {
      run: evidenceRunFactory({
        mapState: graduationState,
      }),
    }),
    { decisions: 1, slices: 2 },
  );
  assert.equal(graduationState.body, reorderedPlanBody);

  writeFileSync(planPath, originalPlanBody);
  assert.throws(
    () => runDiscoveryProtocol({
      bodyPath: planPath,
      command: "graduate",
      map,
      repo,
    }, {
      run: evidenceRunFactory({ mapState: graduationState }),
    }),
    /ready delivery slices are immutable/,
  );

  const draftPath = join(testRoot, "slice.md");
  const draft = `## Why

Discovery map: #10
Discovery slice: S-1

## Outcomes

- [ ] O-1 — A user can request recovery.
`;
  writeFileSync(draftPath, draft);
  const filingState = {
    issues: [],
    mapBody: mapBody(),
    closingPullRequests: [],
    mergedHead: "abc123",
    reviewEvidenceQueries: 0,
    reviewerLogin: "reviewer",
    verdictComments: [],
    createAttempts: 0,
    createFailure: null,
    createdBody: draft,
    failMapUpdate: true,
    mapState: "OPEN",
    mapLabels: [{ name: "gsd:map" }],
  };
  function filingRun(program, argumentsList, options = {}) {
    const joined = argumentsList.join(" ");
    if (joined.includes("issues?state=all")) {
      return { status: 0, stdout: pages(filingState.issues), stderr: "" };
    }
    if (joined.includes("issue create")) {
      filingState.createAttempts += 1;
      if (filingState.createFailure) {
        return { status: 1, stdout: "", stderr: filingState.createFailure };
      }
      filingState.issues.push({
        id: 601,
        number: 20,
        title: "Request recovery",
        body: filingState.createdBody,
        html_url: "https://github.com/octocat/project/issues/20",
        state: "open",
      });
      return { status: 1, stdout: "", stderr: "response lost" };
    }
    if (joined.includes("issue view 20")) {
      filingState.reviewEvidenceQueries += 1;
      return {
        status: 0,
        stdout: JSON.stringify({
          state: "CLOSED",
          closedByPullRequestsReferences: filingState.closingPullRequests,
        }),
        stderr: "",
      };
    }
    if (joined.includes("pr view 30")) {
      filingState.reviewEvidenceQueries += 1;
      return {
        status: 0,
        stdout: JSON.stringify({
          state: "MERGED",
          mergedAt: "2026-07-28T12:00:00Z",
          headRefOid: filingState.mergedHead,
        }),
        stderr: "",
      };
    }
    if (joined.includes("api user --jq .login")) {
      filingState.reviewEvidenceQueries += 1;
      return { status: 0, stdout: `${filingState.reviewerLogin}\n`, stderr: "" };
    }
    if (joined.includes("issues/30/comments?")) {
      filingState.reviewEvidenceQueries += 1;
      return { status: 0, stdout: pages(filingState.verdictComments), stderr: "" };
    }
    if (joined.includes("issue view 10")) {
      return {
        status: 0,
        stdout: mapIssue(filingState.mapBody, {
          state: filingState.mapState,
          labels: filingState.mapLabels,
        }),
        stderr: "",
      };
    }
    if (joined.includes("issue edit 10")) {
      if (filingState.failMapUpdate && filingState.issues.length) {
        filingState.failMapUpdate = false;
        return { status: 1, stdout: "", stderr: "map update failed" };
      }
      filingState.mapBody = options.input;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (joined.includes("issue close 10")) {
      filingState.mapState = "CLOSED";
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected: ${joined}` };
  }

  assert.throws(
    () => fileDiscoverySlice({
      repo,
      map,
      slice: "S-1",
      title: "Request recovery",
      bodyPath: draftPath,
      run: filingRun,
    }),
    /map update failed/,
  );
  assert.equal(filingState.createAttempts, 1);
  assert.equal(filingState.mapBody.includes("issues/20"), false);
  assert.deepEqual(reconcileDiscoverySlices({
    repo,
    map,
    run: filingRun,
  }), {
    approvalRequired: {
      body: draft,
      number: 20,
      slice: "S-1",
      title: "Request recovery",
      url: "https://github.com/octocat/project/issues/20",
    },
    recovered: [],
    missing: ["S-1"],
  });
  assert.equal(filingState.mapBody.includes("issues/20"), false);

  const changedRecoveryBody = `${draft}\nChanged after creation.\n`;
  filingState.issues[0].body = changedRecoveryBody;
  assert.throws(
    () => fileDiscoverySlice({
      repo,
      map,
      slice: "S-1",
      title: "Request recovery",
      bodyPath: draftPath,
      run: filingRun,
    }),
    /recovered issue differs from the approved title or body/,
  );
  writeFileSync(draftPath, changedRecoveryBody);
  const recovered = fileDiscoverySlice({
    repo,
    map,
    slice: "S-1",
    title: "Request recovery",
    bodyPath: draftPath,
    run: filingRun,
  });
  assert.equal(recovered.number, 20);
  assert.match(filingState.mapBody, /- S-1 — \[Request recovery\].*issues\/20/);

  writeFileSync(draftPath, `${changedRecoveryBody}\nHarmless redraft difference.\n`);
  const filed = fileDiscoverySlice({
    repo,
    map,
    slice: "S-1",
    title: "Request recovery",
    bodyPath: draftPath,
    run: filingRun,
  });
  assert.equal(filed.number, 20);
  assert.equal(filingState.createAttempts, 1);

  filingState.issues[0].state = "closed";
  filingState.closingPullRequests = [{ number: 30 }];
  filingState.verdictComments = [{
    user: { login: filingState.reviewerLogin },
    body: `gsd-loop verdict for ${filingState.mergedHead} issue #20`,
  }];
  assert.throws(
    () => reconcileDiscoverySlices({ repo, map, run: filingRun }),
    /must remain open until discovery map completion/,
  );
  assert.equal(filingState.reviewEvidenceQueries, 0);
  filingState.issues[0].state = "open";

  filingState.issues.push({
    id: 602,
    number: 21,
    title: "Request recovery",
    body: draft,
    html_url: "https://github.com/octocat/project/issues/21",
    state: "open",
  });
  assert.throws(
    () => reconcileDiscoverySlices({ repo, map, run: filingRun }),
    /multiple issues claim S-1/,
  );
  filingState.issues.pop();

  filingState.mapBody = filingState.mapBody.replace(
    "https://github.com/octocat/project/issues/20",
    "https://github.com/other/project/issues/20",
  );
  assert.throws(
    () => reconcileDiscoverySlices({ repo, map, run: filingRun }),
    /queue entry does not match its repository issue/,
  );
  filingState.mapBody = filingState.mapBody.replace(
    "https://github.com/other/project/issues/20",
    "https://github.com/octocat/project/issues/20",
  );

  filingState.mapState = "CLOSED";
  assert.throws(
    () => reconcileDiscoverySlices({ repo, map, run: filingRun }),
    /must be open/,
  );
  filingState.mapState = "OPEN";
  filingState.mapLabels = [];
  assert.throws(
    () => reconcileDiscoverySlices({ repo, map, run: filingRun }),
    /must carry gsd:map/,
  );
  filingState.mapLabels = [{ name: "gsd:map" }];

  const firstIssue = filingState.issues[0];
  filingState.mapBody = mapBody({
    queue: "- S-1 — [Request recovery](https://github.com/octocat/project/issues/20)",
    slices: `### S-1 — Request recovery

Delivers: A user can request recovery.
Needs: None.

### S-2 — Complete recovery

Delivers: A user can complete recovery.
Needs: S-1`,
  });
  filingState.issues = [firstIssue];
  writeFileSync(draftPath, `## Why

Discovery map: #10
Discovery slice: S-2
Needs #999 merged
`);
  assert.throws(
    () => fileDiscoverySlice({
      repo,
      map,
      slice: "S-2",
      title: "Complete recovery",
      bodyPath: draftPath,
      run: filingRun,
    }),
    /Needs dependencies do not match/,
  );

  writeFileSync(draftPath, `## Why

Discovery map: #10
Discovery slice: S-2
Needs #ISSUE merged
`);
  assert.throws(
    () => fileDiscoverySlice({
      repo,
      map,
      slice: "S-2",
      title: "Complete recovery",
      bodyPath: draftPath,
      run: filingRun,
    }),
    /malformed Needs dependency/,
  );

  filingState.mapBody = mapBody();
  filingState.issues = [];
  filingState.createdBody = `${draft}\nUnexpected mutation.\n`;
  writeFileSync(draftPath, draft);
  assert.throws(
    () => fileDiscoverySlice({
      repo,
      map,
      slice: "S-1",
      title: "Request recovery",
      bodyPath: draftPath,
      run: filingRun,
    }),
    /differs from the approved title or body/,
  );

  filingState.mapBody = mapBody();
  filingState.issues = [];
  filingState.createFailure = "GitHub rejected the issue";
  filingState.createdBody = draft;
  assert.throws(
    () => fileDiscoverySlice({
      repo,
      map,
      slice: "S-1",
      title: "Request recovery",
      bodyPath: draftPath,
      run: filingRun,
    }),
    /GitHub rejected the issue/,
  );

  const crlfDraft = `## Why\r
\r
Discovery map: #10\r
Discovery slice: S-2\r
Needs #20 merged\r
`;
  filingState.mapBody = mapBody({
    queue: "- S-1 — [Request recovery](https://github.com/octocat/project/issues/20)",
    slices: `### S-1 — Request recovery

Delivers: A user can request recovery.
Needs: None.

### S-2 — Complete recovery

Delivers: A user can complete recovery.
Needs: S-1`,
  });
  filingState.issues = [
    { ...firstIssue, state: "open" },
    {
      id: 603,
      number: 22,
      title: "Complete recovery",
      body: crlfDraft,
      html_url: "https://github.com/octocat/project/issues/22",
      state: "open",
    },
  ];
  filingState.createFailure = null;
  writeFileSync(draftPath, crlfDraft);
  assert.equal(
    fileDiscoverySlice({
      repo,
      map,
      slice: "S-2",
      title: "Complete recovery",
      bodyPath: draftPath,
      run: filingRun,
    }).number,
    22,
  );
  assert.deepEqual(
    runDiscoveryProtocol({
      command: "complete-map",
      map,
      repo,
    }, {
      run: filingRun,
    }),
    { closed: true, slices: 2 },
  );
  assert.equal(filingState.mapState, "CLOSED");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

console.log("discovery protocol passed");
