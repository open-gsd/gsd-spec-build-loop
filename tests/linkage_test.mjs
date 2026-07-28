import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const linkageGuard = join(
  repositoryRoot,
  ".agents",
  "skills",
  "gsd-loop-build",
  "scripts",
  "ensure-linkage.mjs",
);
const testRoot = mkdtempSync(join(tmpdir(), "gsd-loop-linkage-"));
const statePath = join(testRoot, "state.json");
const ghPath = join(testRoot, process.platform === "win32" ? "gh.cmd" : "gh");
const head = "1d52788c49a31993e32246c7745918485078df14";

function runGuard(expectedHead = head) {
  return spawnSync(process.execPath, [
    linkageGuard,
    "3",
    "--repo", "octocat/project",
    "--pr", "4",
    "--head", expectedHead,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${testRoot}${delimiter}${process.env.PATH}`,
      MOCK_LINKAGE_STATE: statePath,
    },
  });
}

try {
  const ghScript = join(testRoot, "gh.mjs");
  writeFileSync(ghScript, `
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const statePath = process.env.MOCK_LINKAGE_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
function field(name) {
  const prefix = name + "=";
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
function pullRequest() {
  return {
    id: "PR_mock",
    headRefOid: state.headRefOid,
    body: state.body,
    userContentEdits: { totalCount: state.edits },
  };
}
if (args[0] === "api" && args[1] === "graphql" && field("query")?.includes("mutation")) {
  if (state.raceBeforeUpdate) {
    state.body = "Concurrent evidence\\n";
    state.edits += 1;
    state.raceBeforeUpdate = false;
  }
  state.body = field("body");
  state.edits += 1;
  writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write(JSON.stringify({
    data: { updatePullRequest: { pullRequest: pullRequest() } },
  }));
} else if (args[0] === "api" && args[1] === "graphql") {
  process.stdout.write(JSON.stringify({
    data: { repository: { pullRequest: pullRequest() } },
  }));
} else {
  process.stderr.write("unexpected gh invocation");
  process.exit(1);
}
`);
  if (process.platform === "win32") {
    writeFileSync(ghPath, `@"${process.execPath}" "${ghScript}" %*\r\n`);
  } else {
    writeFileSync(ghPath, `#!/bin/sh\nexec "${process.execPath}" "${ghScript}" "$@"\n`);
    chmodSync(ghPath, 0o755);
  }

  writeFileSync(statePath, JSON.stringify({ headRefOid: head, body: "Summary\n", edits: 0 }));
  const restored = runGuard();
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /PR #4 linkage: restored/);
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), {
    headRefOid: head,
    body: "Summary\n\nCloses #3\n",
    edits: 1,
  });

  const repeated = runGuard();
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /PR #4 linkage: already present/);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).edits, 1);

  const stale = runGuard("a".repeat(40));
  assert.equal(stale.status, 3, stale.stderr);
  assert.match(stale.stderr, /head changed; linkage evidence is stale/);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).edits, 1);

  writeFileSync(statePath, JSON.stringify({
    headRefOid: head,
    body: "Summary\n",
    edits: 0,
    raceBeforeUpdate: true,
  }));
  const concurrent = runGuard();
  assert.equal(concurrent.status, 3, concurrent.stderr);
  assert.match(concurrent.stderr, /body changed during linkage update/);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).edits, 2);

  console.log("pull request linkage guard passed");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
