import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repositoryRoot, "bin", "gsd-loop.mjs");
const testRoot = mkdtempSync(join(tmpdir(), "gsd-loop-discovery-"));

function mapBody({
  frontier = `### D-1 — Choose recovery channel

Type: Discussion
Question: Which verified channel should carry recovery links?
Needs: None.
Issue: #12`,
  graduation = "Ready for `gsd-loop-spec`.",
  outOfScope = "- Recovery by SMS.",
  queue = "None.",
  slices,
} = {}) {
  return `## Destination

Ship a complete account recovery route.

## Decisions so far

Email is the recovery channel because it is already verified.

## Decision frontier

${frontier}

## Not yet specified

None.

## Out of scope

${outOfScope}

## Delivery slices

${slices ?? `### S-1 — Request a recovery link

Delivers: A verified user can request a time-limited recovery link.

Needs: None.

### S-2 — Reset the password

Delivers: A user with a valid recovery link can set a new password.

Needs: S-1`}

## Graduation

${graduation}

## Queue issues

${queue}
`;
}

function run(argumentsList) {
  return spawnSync(process.execPath, [cli, ...argumentsList], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

try {
  const validPath = join(testRoot, "valid.md");
  writeFileSync(validPath, mapBody());
  const valid = run(["discovery-map", validPath]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), {
    schema: "gsd-loop/discovery-slices-v1",
    decisions: [{
      id: "D-1",
      title: "Choose recovery channel",
      type: "Discussion",
      question: "Which verified channel should carry recovery links?",
      needs: [],
      issue: 12,
    }],
    slices: [
      {
        id: "S-1",
        title: "Request a recovery link",
        delivers: "A verified user can request a time-limited recovery link.",
        needs: [],
      },
      {
        id: "S-2",
        title: "Reset the password",
        delivers: "A user with a valid recovery link can set a new password.",
        needs: ["S-1"],
      },
    ],
    queueIssues: [],
  });

  const draftPath = join(testRoot, "draft.md");
  writeFileSync(draftPath, mapBody({ graduation: "Not ready.", slices: "None." }));
  const draft = run(["discovery-map", "--allow-not-ready", draftPath]);
  assert.equal(draft.status, 0, draft.stderr);
  assert.deepEqual(JSON.parse(draft.stdout).slices, []);

  const pendingPath = join(testRoot, "pending.md");
  writeFileSync(pendingPath, mapBody({
    frontier: `### D-1 — Choose recovery channel

Type: Discussion
Question: Which verified channel should carry recovery links?
Needs: None.
Issue: Pending.`,
  }));
  const pending = run(["discovery-map", pendingPath]);
  assert.equal(pending.status, 3);
  assert.match(pending.stderr, /unresolved frontier entry D-1/);

  const duplicateIssuePath = join(testRoot, "duplicate-issue.md");
  writeFileSync(duplicateIssuePath, mapBody({
    frontier: `### D-1 — Choose recovery channel

Type: Discussion
Question: Which verified channel should carry recovery links?
Needs: None.
Issue: #12

### D-2 — Choose reset lifetime

Type: Discussion
Question: How long should reset links remain valid?
Needs: None.
Issue: #12`,
  }));
  const duplicateIssue = run(["discovery-map", duplicateIssuePath]);
  assert.equal(duplicateIssue.status, 3);
  assert.match(duplicateIssue.stderr, /repeats decision issue #12/);

  const unready = run(["discovery-map", draftPath]);
  assert.equal(unready.status, 3);
  assert.match(unready.stderr, /not ready for gsd-loop-spec/);

  const forwardPath = join(testRoot, "forward.md");
  writeFileSync(forwardPath, mapBody({
    slices: `### S-1 — Request a recovery link

Delivers: A verified user can request a time-limited recovery link.

Needs: S-2

### S-2 — Reset the password

Delivers: A user with a valid recovery link can set a new password.

Needs: None.`,
  }));
  const forward = run(["discovery-map", forwardPath]);
  assert.equal(forward.status, 3);
  assert.match(forward.stderr, /may depend only on earlier slices/);

  const malformedPath = join(testRoot, "malformed.md");
  writeFileSync(malformedPath, mapBody({
    slices: `### S-1 — Request a recovery link

Needs: None.`,
  }));
  const malformed = run(["discovery-map", malformedPath]);
  assert.equal(malformed.status, 3);
  assert.match(malformed.stderr, /exactly one Delivers line and one Needs line/);

  const blankTitlePath = join(testRoot, "blank-title.md");
  writeFileSync(blankTitlePath, mapBody({
    slices: `### S-1 — ${"   "}

Delivers: A verified user can request a recovery link.
Needs: None.`,
  }));
  const blankTitle = run(["discovery-map", blankTitlePath]);
  assert.equal(blankTitle.status, 3);
  assert.match(blankTitle.stderr, /filing-compatible title/);

  const markdownTitlePath = join(testRoot, "markdown-title.md");
  writeFileSync(markdownTitlePath, mapBody({
    slices: `### S-1 — Support [legacy] recovery

Delivers: A verified user can request a recovery link.
Needs: None.`,
  }));
  const markdownTitle = run(["discovery-map", markdownTitlePath]);
  assert.equal(markdownTitle.status, 3);
  assert.match(markdownTitle.stderr, /filing-compatible title/);

  const emptyBoundaryPath = join(testRoot, "empty-boundary.md");
  writeFileSync(emptyBoundaryPath, mapBody({ outOfScope: "" }));
  const emptyBoundary = run(["discovery-map", emptyBoundaryPath]);
  assert.equal(emptyBoundary.status, 3);
  assert.match(emptyBoundary.stderr, /Out of scope/);

  const blankQueuePath = join(testRoot, "blank-queue.md");
  writeFileSync(blankQueuePath, mapBody({ queue: "   " }));
  const blankQueue = run(["discovery-map", blankQueuePath]);
  assert.equal(blankQueue.status, 3);
  assert.match(blankQueue.stderr, /Queue issues must be None/);

  console.log("discovery map validation passed");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
