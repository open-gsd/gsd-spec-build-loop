import assert from "node:assert/strict";
import {
  parseOutcomeArguments,
  syncIssueOutcomes,
  transformOutcomeChecklist,
} from "../lib/outcomes.mjs";

const issueBody = `## Why

Ship the walking skeleton.

## Outcomes

- [ ] O-1 — tests pass
- [x] O-2 — command works

## Exclusions

- X-1 — no delete command
`;

const parsed = parseOutcomeArguments([
  "1", "complete",
  "--repo", "octocat/project",
  "--pr", "2",
  "--head", "abc1234",
]);
assert.deepEqual(parsed, {
  issue: 1,
  state: "complete",
  repo: "octocat/project",
  pullRequest: 2,
  expectedHead: "abc1234",
});
assert.throws(
  () => parseOutcomeArguments(["1", "complete", "--repo", "octocat/project", "--pr", "2"]),
  /--head COMMIT_SHA/,
);

assert.equal(transformOutcomeChecklist(issueBody, "complete"), issueBody
  .replace("- [ ] O-1", "- [x] O-1"));
assert.equal(transformOutcomeChecklist(issueBody, "pending"), issueBody
  .replace("- [x] O-2", "- [ ] O-2"));
assert.throws(
  () => transformOutcomeChecklist("## Why\n\nNo contract.\n", "complete"),
  /Outcomes section/,
);
assert.throws(
  () => transformOutcomeChecklist("## Outcomes\n\n- [ ] O-1 — first\n- [ ] O-1 — duplicate\n", "complete"),
  /duplicate outcome O-1/,
);
assert.throws(
  () => transformOutcomeChecklist("## Outcomes\n\n- [ ] O-1 — first\n- O-2 — missing checkbox\n", "complete"),
  /malformed outcome O-2/,
);
assert.throws(
  () => transformOutcomeChecklist("## Outcomes\n\n- [ ] O-1 — first\nO-2 — missing checkbox\n", "complete"),
  /malformed outcome O-2/,
);
assert.throws(
  () => transformOutcomeChecklist("## Outcomes\n\n- [ ] O-1 — first\n- [y] O-2 — bad marker\n", "complete"),
  /malformed outcome O-2/,
);
assert.throws(
  () => transformOutcomeChecklist("## Outcomes\n\n- [ ] O-1 — first\n- [] O-2 — empty marker\n", "complete"),
  /malformed outcome O-2/,
);
assert.throws(
  () => transformOutcomeChecklist("## Outcomes\n\n- [ ] O-1 — first\n\n## Outcomes\n\n- [ ] O-2 — second\n", "complete"),
  /multiple Outcomes sections/,
);

const calls = [];
const completedBody = transformOutcomeChecklist(issueBody, "complete");
const bodies = [issueBody, issueBody, completedBody];
function run(program, argumentsList, options = {}) {
  calls.push({ program, argumentsList, input: options.input });
  if (argumentsList[0] === "pr") {
    return {
      status: 0,
      stdout: JSON.stringify({
        headRefOid: "abc123",
        body: "Closes #1",
        closingIssuesReferences: [{ number: 1 }],
      }),
      stderr: "",
    };
  }
  if (argumentsList[0] === "issue" && argumentsList[1] === "view") {
    return { status: 0, stdout: JSON.stringify({ body: bodies.shift() }), stderr: "" };
  }
  if (argumentsList[0] === "issue" && argumentsList[1] === "edit") {
    return { status: 0, stdout: "", stderr: "" };
  }
  return { status: 1, stdout: "", stderr: "unexpected command" };
}

const changed = syncIssueOutcomes({
  cwd: "/tmp/project",
  repo: "octocat/project",
  issue: 1,
  pullRequest: 2,
  expectedHead: "abc123",
  state: "complete",
  run,
});
assert.equal(changed, true);
assert.deepEqual(calls.map(({ argumentsList }) => argumentsList.slice(0, 3)), [
  ["pr", "view", "2"],
  ["issue", "view", "1"],
  ["pr", "view", "2"],
  ["issue", "view", "1"],
  ["issue", "edit", "1"],
  ["issue", "view", "1"],
  ["pr", "view", "2"],
]);
const edit = calls.find(({ argumentsList }) => (
  argumentsList[0] === "issue" && argumentsList[1] === "edit"
));
assert.equal(edit.input, issueBody.replace("- [ ] O-1", "- [x] O-1"));
assert.ok(edit.argumentsList.includes("--body-file"));
assert.ok(edit.argumentsList.includes("-"));

const noOpCalls = [];
function noOpRun(program, argumentsList) {
  noOpCalls.push(argumentsList);
  if (argumentsList[0] === "pr") {
    return {
      status: 0,
      stdout: JSON.stringify({
        headRefOid: "abc123",
        body: "Closes #1",
        closingIssuesReferences: [{ number: 1 }],
      }),
      stderr: "",
    };
  }
  if (argumentsList[0] === "issue" && argumentsList[1] === "view") {
    return {
      status: 0,
      stdout: JSON.stringify({
        body: transformOutcomeChecklist(issueBody, "complete"),
      }),
      stderr: "",
    };
  }
  return { status: 1, stdout: "", stderr: "unexpected command" };
}

assert.equal(syncIssueOutcomes({
  cwd: "/tmp/project",
  repo: "octocat/project",
  issue: 1,
  pullRequest: 2,
  expectedHead: "abc123",
  state: "complete",
  run: noOpRun,
}), false);
assert.equal(noOpCalls.filter(([commandName]) => commandName === "pr").length, 2);
assert.equal(noOpCalls.filter(([commandName]) => commandName === "issue").length, 2);

assert.throws(
  () => syncIssueOutcomes({
    cwd: "/tmp/project",
    repo: "octocat/project",
    issue: 1,
    pullRequest: 2,
    expectedHead: "stale",
    state: "complete",
    run,
  }),
  /head changed/,
);

function unlinkedRun(program, argumentsList) {
  if (argumentsList[0] === "pr") {
    return {
      status: 0,
      stdout: JSON.stringify({
        headRefOid: "abc123",
        body: "Closes #1",
        closingIssuesReferences: [{ number: 1 }],
      }),
      stderr: "",
    };
  }
  return { status: 1, stdout: "", stderr: "issue access must not occur" };
}

assert.throws(
  () => syncIssueOutcomes({
    cwd: "/tmp/project",
    repo: "octocat/project",
    issue: 99,
    pullRequest: 2,
    expectedHead: "abc123",
    state: "complete",
    run: unlinkedRun,
  }),
  /issue #99 is not linked to PR #2/,
);

function negatedFallbackRun(program, argumentsList) {
  if (argumentsList[0] === "pr") {
    return {
      status: 0,
      stdout: JSON.stringify({
        headRefOid: "abc123",
        body: "This does not close #99.",
        closingIssuesReferences: [],
      }),
      stderr: "",
    };
  }
  return { status: 1, stdout: "", stderr: "issue access must not occur" };
}

assert.throws(
  () => syncIssueOutcomes({
    cwd: "/tmp/project",
    repo: "octocat/project",
    issue: 99,
    pullRequest: 2,
    expectedHead: "abc123",
    state: "complete",
    run: negatedFallbackRun,
  }),
  /issue #99 is not linked to PR #2/,
);

console.log("outcome checklist synchronization passed");
