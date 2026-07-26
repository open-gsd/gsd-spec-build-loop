import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repositoryRoot, "bin", "gsd-loop.mjs");
const testRoot = mkdtempSync(join(tmpdir(), "gsd-loop-cli-"));
const binRoot = join(testRoot, "bin");
const ghLog = join(testRoot, "gh.log");
const gitConfig = join(testRoot, "gitconfig");
const remoteRoot = join(testRoot, "remotes");

function command(program, argumentsList, options = {}) {
  return spawnSync(program, argumentsList, {
    encoding: "utf8",
    ...options,
  });
}

function runCli(argumentsList, options = {}) {
  return command(process.execPath, [cli, ...argumentsList], {
    cwd: options.cwd ?? repositoryRoot,
    input: options.input,
    env: {
      ...process.env,
      PATH: `${binRoot}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      MOCK_GH_LOG: ghLog,
      MOCK_AGENT_OUTPUT: options.agentOutput ?? "GSD_LOOP_AUTH_OK",
      MOCK_REQUIRED_CHECKS: options.requiredChecks ? "1" : "0",
      MOCK_RULESET_FAIL: options.rulesetFail ? "1" : "0",
      MOCK_RULESET_LIST_FAIL: options.rulesetListFail ? "1" : "0",
      MOCK_PR_LIST_FAIL: options.prListFail ? "1" : "0",
      MOCK_CHECK_QUERY_FAIL: options.checkQueryFail ? "1" : "0",
      MOCK_RULES_QUERY_FAIL: options.rulesQueryFail ? "1" : "0",
      MOCK_RULES_QUERY_FORBIDDEN: options.rulesQueryForbidden ? "1" : "0",
      MOCK_AGENT_AUTH_FAIL: options.agentAuthFail ? "1" : "0",
      MOCK_DEFAULT_CHECKS: JSON.stringify(options.defaultChecks ?? options.checks ?? [{ name: "test", conclusion: "success", app: { id: 15368, slug: "github-actions" } }]),
      MOCK_PR_CHECKS: JSON.stringify(options.prChecks ?? []),
      MOCK_REMOTE_ROOT: remoteRoot,
      GIT_CONFIG_GLOBAL: gitConfig,
    },
  });
}

function writeExecutable(name, source) {
  const script = join(binRoot, `${name}.mjs`);
  writeFileSync(script, source);
  if (process.platform === "win32") {
    writeFileSync(join(binRoot, `${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`);
    return;
  }
  const launcher = join(binRoot, name);
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(launcher, 0o755);
}

function initializeRepository(path) {
  mkdirSync(path, { recursive: true });
  assert.equal(command("git", ["init", "-b", "main"], { cwd: path }).status, 0);
  assert.equal(command("git", ["config", "user.name", "Test User"], { cwd: path }).status, 0);
  assert.equal(command("git", ["config", "user.email", "test@example.com"], { cwd: path }).status, 0);
  assert.equal(command("git", ["commit", "--allow-empty", "-m", "Initial commit"], { cwd: path }).status, 0);
}

function readLog() {
  if (!existsSync(ghLog)) {
    return [];
  }
  return readFileSync(ghLog, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

try {
  mkdirSync(binRoot, { recursive: true });
  mkdirSync(remoteRoot, { recursive: true });
  writeFileSync(gitConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
  writeExecutable("gh", `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const args = process.argv.slice(2);
appendFileSync(process.env.MOCK_GH_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") console.log("gh version 2.80.0");
else if (args[0] === "auth" && args[1] === "status") process.exit(0);
else if (args[0] === "repo" && args[1] === "view") console.log("octocat/project");
else if (args[0] === "pr" && args[1] === "list" && process.env.MOCK_PR_LIST_FAIL === "1") process.exit(1);
else if (args[0] === "pr" && args[1] === "list") console.log(JSON.stringify(
  JSON.parse(process.env.MOCK_PR_CHECKS).length ? [{ headRefOid: "pull-request-head", updatedAt: "2026-07-26T00:00:00Z" }] : []
));
else if (args[0] === "repo" && args[1] === "create") {
  const repository = args[2].replace("/", "-");
  const source = args[args.indexOf("--source") + 1];
  const remote = join(process.env.MOCK_REMOTE_ROOT, repository + ".git");
  if (spawnSync("git", ["init", "--bare", remote]).status !== 0) process.exit(1);
  if (spawnSync("git", ["-C", source, "remote", "add", "origin", remote]).status !== 0) process.exit(1);
  if (spawnSync("git", ["-C", source, "push", "-u", "origin", "main"]).status !== 0) process.exit(1);
}
else if (args[0] === "label" && args[1] === "list") {
  const targetRepo = args[args.indexOf("--repo") + 1];
  const entries = existsSync(process.env.MOCK_GH_LOG)
    ? readFileSync(process.env.MOCK_GH_LOG, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse)
    : [];
  const labels = entries
    .filter((entry) => entry[0] === "label" && entry[1] === "create" && entry[entry.indexOf("--repo") + 1] === targetRepo)
    .map((entry) => ({ name: entry[2] }));
  console.log(JSON.stringify(labels));
}
else if (args[0] === "label" && args[1] === "create") process.exit(0);
else if (args[0] === "api") {
  const endpoint = args.find((arg) => arg.startsWith("repos/") || arg === "user");
  if (endpoint === "user") console.log("octocat");
  else if (endpoint === "repos/octocat/project") {
    if (args.includes(".permissions.push")) console.log("true");
    else if (args.includes(".default_branch")) console.log("main");
    else console.log(JSON.stringify({ permissions: { push: true }, default_branch: "main" }));
  } else if (endpoint === "repos/octocat/project/commits/main/check-runs") {
    if (process.env.MOCK_CHECK_QUERY_FAIL === "1") process.exit(1);
    console.log(JSON.stringify({ check_runs: JSON.parse(process.env.MOCK_DEFAULT_CHECKS) }));
  } else if (endpoint === "repos/octocat/project/commits/pull-request-head/check-runs") {
    if (process.env.MOCK_CHECK_QUERY_FAIL === "1") process.exit(1);
    console.log(JSON.stringify({ check_runs: JSON.parse(process.env.MOCK_PR_CHECKS) }));
  } else if (endpoint === "repos/octocat/project/rules/branches/main") {
    if (process.env.MOCK_RULES_QUERY_FORBIDDEN === "1") {
      console.error("gh: Resource not accessible by personal access token (HTTP 403)");
      process.exit(1);
    }
    if (process.env.MOCK_RULES_QUERY_FAIL === "1") {
      console.error("network unavailable");
      process.exit(1);
    }
    console.log(process.env.MOCK_REQUIRED_CHECKS === "1" ? JSON.stringify([{ type: "required_status_checks" }]) : "[]");
  } else if (endpoint === "repos/octocat/project/rulesets" && !args.includes("POST") && process.env.MOCK_RULESET_LIST_FAIL === "1") {
    console.error("rulesets cannot be listed for this repository");
    process.exit(1);
  } else if (endpoint === "repos/octocat/project/rulesets" && args.includes("POST") && process.env.MOCK_RULESET_FAIL === "1") {
    console.error("rulesets are unavailable for this repository");
    process.exit(1);
  } else if (endpoint === "repos/octocat/project/rulesets") console.log("[]");
  else process.exit(1);
} else process.exit(1);
`);
  writeExecutable("codex", `
const args = process.argv.slice(2);
if (args.includes("--version")) console.log("codex-cli 1.0.0");
else if (args.join(" ").includes("GSD_LOOP_AUTH_OK") && process.env.MOCK_AGENT_AUTH_FAIL === "1") process.exit(1);
else if (args.join(" ").includes("GSD_LOOP_AUTH_OK")) console.log("GSD_LOOP_AUTH_OK");
else console.log(process.env.MOCK_AGENT_OUTPUT || "");
`);

  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /gsd-loop init/);
  assert.match(help.stdout, /gsd-loop run build\|review/);

  const empty = join(testRoot, "empty");
  mkdirSync(empty);
  const unsafeCreate = runCli(["init", "--yes", "--runner", "codex"], { cwd: empty });
  assert.equal(unsafeCreate.status, 2);
  assert.match(unsafeCreate.stderr, /--create-repo/);

  const createdRepository = join(testRoot, "created");
  const createdHome = join(testRoot, "created-home");
  mkdirSync(createdRepository);
  const created = runCli([
    "init",
    "--yes",
    "--create-repo",
    "--repo", "octocat/created",
    "--visibility", "private",
    "--runner", "codex",
    "--home", createdHome,
  ], { cwd: createdRepository });
  assert.equal(created.status, 3, created.stderr);
  assert.match(created.stdout, /review: blocked/);
  assert.equal(command("git", ["branch", "--show-current"], { cwd: createdRepository }).stdout.trim(), "main");
  assert.equal(command("git", ["rev-list", "--count", "HEAD"], { cwd: createdRepository }).stdout.trim(), "1");
  assert.match(command("git", ["remote", "get-url", "origin"], { cwd: createdRepository }).stdout, /octocat-created[.]git/);
  assert.ok(existsSync(join(createdRepository, ".git", "gsd-loop", "config.json")));

  const rejectedRepository = join(testRoot, "rejected-before-create");
  mkdirSync(rejectedRepository);
  const rejected = runCli([
    "init",
    "--yes",
    "--create-repo",
    "--repo", "octocat/rejected-before-create",
    "--visibility", "private",
    "--runner", "codex",
    "--home", join(testRoot, "rejected-home"),
  ], { cwd: rejectedRepository, agentAuthFail: true });
  assert.equal(rejected.status, 3);
  assert.equal(existsSync(join(rejectedRepository, ".git")), false);
  assert.equal(readLog().some((args) => args[0] === "repo" && args[1] === "create" && args[2] === "octocat/rejected-before-create"), false);

  const oneConfirmationRepository = join(testRoot, "one-confirmation");
  mkdirSync(oneConfirmationRepository);
  const oneConfirmation = runCli([
    "init",
    "--runner", "codex",
    "--home", join(testRoot, "one-confirmation-home"),
  ], { cwd: oneConfirmationRepository, input: "y\n" });
  assert.equal(oneConfirmation.status, 3, oneConfirmation.stderr);
  assert.match(oneConfirmation.stdout, /Planned changes:/);
  assert.ok(existsSync(join(oneConfirmationRepository, ".git", "gsd-loop", "config.json")));
  assert.equal(readLog().filter((args) => args[0] === "repo" && args[1] === "create" && args[2] === "octocat/one-confirmation").length, 1);

  const repository = join(testRoot, "project");
  const home = join(testRoot, "home");
  initializeRepository(repository);

  writeFileSync(ghLog, "");
  const mismatchedRepository = runCli([
    "init",
    "--dry-run",
    "--yes",
    "--runner", "codex",
    "--repo", "octocat/other",
    "--home", join(testRoot, "mismatched-home"),
  ], { cwd: repository });
  assert.equal(mismatchedRepository.status, 2);
  assert.match(mismatchedRepository.stderr, /does not match the current checkout octocat\/project/);
  assert.equal(readLog().some((args) => ["label", "api"].includes(args[0])), false);

  const dryRun = runCli([
    "init",
    "--dry-run",
    "--yes",
    "--runner", "codex",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", home,
  ], { cwd: repository });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Create 5 gsd labels/);
  assert.match(dryRun.stdout, /Require successful check: test/);
  assert.match(dryRun.stdout, /codex exec .*--dangerously-bypass-approvals-and-sandbox/);
  assert.equal(existsSync(home), false);
  assert.equal(readLog().some((args) => (
    args[0] === "label"
    && args[1] === "create"
    && args[args.indexOf("--repo") + 1] === "octocat/project"
  )), false);

  const privateRulesDryRun = runCli([
    "init",
    "--dry-run",
    "--yes",
    "--runner", "codex",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", join(testRoot, "private-rules-home"),
  ], { cwd: repository, rulesQueryForbidden: true });
  assert.equal(privateRulesDryRun.status, 0, privateRulesDryRun.stderr);
  assert.match(privateRulesDryRun.stdout, /Require successful check: test/);

  const ambiguous = runCli([
    "init",
    "--dry-run",
    "--yes",
    "--runner", "codex",
    "--repo", "octocat/project",
    "--home", join(testRoot, "ambiguous-home"),
  ], {
    cwd: repository,
    checks: [
      { name: "test", conclusion: "success", app: { id: 15368, slug: "github-actions" } },
      { name: "lint", conclusion: "success", app: { id: 15368, slug: "github-actions" } },
    ],
  });
  assert.equal(ambiguous.status, 2);
  assert.match(ambiguous.stderr, /--required-check/);

  const pullRequestCheck = runCli([
    "init",
    "--dry-run",
    "--yes",
    "--runner", "codex",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", join(testRoot, "pull-request-check-home"),
  ], {
    cwd: repository,
    defaultChecks: [],
    prChecks: [{ name: "test", conclusion: "success", app: { id: 15368, slug: "github-actions" } }],
  });
  assert.equal(pullRequestCheck.status, 0, pullRequestCheck.stderr);
  assert.match(pullRequestCheck.stdout, /Require successful check: test/);

  const pullRequestInspectionFailure = runCli([
    "init", "--dry-run", "--yes", "--runner", "codex",
    "--repo", "octocat/project", "--required-check", "test",
    "--home", join(testRoot, "pr-inspection-failure-home"),
  ], { cwd: repository, prListFail: true });
  assert.equal(pullRequestInspectionFailure.status, 1);
  assert.match(pullRequestInspectionFailure.stderr, /gh pr list .* failed/);

  const checkInspectionFailure = runCli([
    "init", "--dry-run", "--yes", "--runner", "codex",
    "--repo", "octocat/project", "--home", join(testRoot, "check-inspection-failure-home"),
  ], { cwd: repository, checkQueryFail: true });
  assert.equal(checkInspectionFailure.status, 1);
  assert.match(checkInspectionFailure.stderr, /check-runs failed/);

  const rulesetFailureRepository = join(testRoot, "ruleset-failure");
  const rulesetFailureHome = join(testRoot, "ruleset-failure-home");
  initializeRepository(rulesetFailureRepository);
  writeFileSync(ghLog, "");
  const rulesetFailure = runCli([
    "init",
    "--yes",
    "--runner", "codex",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", rulesetFailureHome,
  ], { cwd: rulesetFailureRepository, rulesetFail: true });
  assert.equal(rulesetFailure.status, 3);
  assert.match(rulesetFailure.stdout, /build: ready/);
  assert.match(rulesetFailure.stdout, /review: blocked/);
  assert.ok(existsSync(join(rulesetFailureRepository, ".git", "gsd-loop", "config.json")));

  const rulesetListFailureRepository = join(testRoot, "ruleset-list-failure");
  initializeRepository(rulesetListFailureRepository);
  writeFileSync(ghLog, "");
  const rulesetListFailure = runCli([
    "init",
    "--yes",
    "--runner", "codex",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", join(testRoot, "ruleset-list-failure-home"),
  ], { cwd: rulesetListFailureRepository, rulesetListFail: true });
  assert.equal(rulesetListFailure.status, 3);
  assert.match(rulesetListFailure.stdout, /build: ready/);
  assert.ok(existsSync(join(rulesetListFailureRepository, ".git", "gsd-loop", "config.json")));

  writeFileSync(ghLog, "");
  const initialized = runCli([
    "init",
    "--yes",
    "--runner", "codex",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", home,
  ], { cwd: repository });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /build: ready/);
  assert.match(initialized.stdout, /review: ready/);
  assert.ok(existsSync(join(home, ".agents", "skills", "gsd-loop-build", "SKILL.md")));
  assert.ok(existsSync(join(repository, ".git", "gsd-loop", "config.json")));
  assert.match(readFileSync(join(repository, ".git", "info", "exclude"), "utf8"), /\.claude\/scheduled_tasks\.lock/);
  assert.ok(readLog().some((args) => args[0] === "label" && args[1] === "create"));
  assert.ok(readLog().some((args) => args.includes("--method") && args.includes("POST")));

  const configPath = join(repository, ".git", "gsd-loop", "config.json");
  const configured = JSON.parse(readFileSync(configPath, "utf8"));
  writeFileSync(configPath, `${JSON.stringify({ ...configured, autonomousConsent: false }, null, 2)}\n`);
  const consentMissing = runCli(["run", "build", "--once"], { cwd: repository });
  assert.equal(consentMissing.status, 3);
  assert.match(consentMissing.stderr, /autonomous consent/);
  writeFileSync(configPath, `${JSON.stringify(configured, null, 2)}\n`);

  const switchedAgent = runCli(["run", "build", "--agent", "claude", "--once"], { cwd: repository });
  assert.equal(switchedAgent.status, 3);
  assert.match(switchedAgent.stderr, /rerun gsd-loop init --runner claude/);

  writeFileSync(configPath, `${JSON.stringify({ ...configured, intervals: { workMinutes: 0, idleMinutes: 60, idleLimit: 3 } }, null, 2)}\n`);
  const invalidIntervals = runCli(["run", "build", "--once"], { cwd: repository });
  assert.equal(invalidIntervals.status, 3);
  assert.match(invalidIntervals.stderr, /interval configuration is invalid/);
  writeFileSync(configPath, `${JSON.stringify(configured, null, 2)}\n`);

  const doctor = runCli(["doctor", "--json", "--repo", "octocat/project"], { cwd: repository });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.deepEqual(JSON.parse(doctor.stdout), {
    repo: "octocat/project",
    defaultBranch: "main",
    buildReady: true,
    reviewReady: false,
    missingLabels: [],
  });

  const strictDoctor = runCli(["doctor", "--review-ready", "--repo", "octocat/project"], { cwd: repository });
  assert.equal(strictDoctor.status, 3);
  assert.match(strictDoctor.stdout, /review: blocked/);

  const failedDoctor = runCli(["doctor", "--repo", "octocat/project"], { cwd: repository, rulesQueryFail: true });
  assert.equal(failedDoctor.status, 1);
  assert.match(failedDoctor.stderr, /network unavailable/);

  const workPass = runCli(["run", "build", "--once"], {
    cwd: repository,
    agentOutput: 'GSD_LOOP_RESULT={"lane":"build","status":"work","reason":"opened-pr"}',
  });
  assert.equal(workPass.status, 0, workPass.stderr);
  assert.match(workPass.stdout, /GSD_LOOP_RESULT=/);
  assert.match(workPass.stdout, /build pass: work \(opened-pr\)/);
  assert.equal(existsSync(join(repository, ".git", "gsd-loop", "build.lock")), false);

  const buildLog = join(repository, ".git", "gsd-loop", "build.jsonl");
  writeFileSync(buildLog, Array.from({ length: 205 }, (_, index) => JSON.stringify({ index })).join("\n") + "\n");
  const boundedLogPass = runCli(["run", "build", "--once"], {
    cwd: repository,
    agentOutput: 'GSD_LOOP_RESULT={"lane":"build","status":"idle","reason":"bounded-log"}',
  });
  assert.equal(boundedLogPass.status, 0, boundedLogPass.stderr);
  const retainedLogLines = readFileSync(buildLog, "utf8").trim().split("\n");
  assert.equal(retainedLogLines.length, 200);
  assert.equal(JSON.parse(retainedLogLines.at(-1)).reason, "bounded-log");

  const reviewPass = runCli(["run", "review", "--once"], {
    cwd: repository,
    requiredChecks: true,
    agentOutput: 'GSD_LOOP_RESULT={"lane":"review","status":"idle","reason":"no-pr"}',
  });
  assert.equal(reviewPass.status, 0, reviewPass.stderr);
  assert.match(reviewPass.stdout, /review pass: idle \(no-pr\)/);

  const lockPath = join(repository, ".git", "gsd-loop", "build.lock");
  writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, lane: "build" })}\n`);
  const duplicate = runCli(["run", "build", "--once"], { cwd: repository });
  assert.equal(duplicate.status, 3);
  assert.match(duplicate.stderr, /another build runner is active/);
  rmSync(lockPath);

  writeFileSync(lockPath, "not-json\n");
  const corruptPortableLock = runCli(["run", "build", "--once"], { cwd: repository });
  assert.equal(corruptPortableLock.status, 3);
  assert.match(corruptPortableLock.stderr, /cannot safely read the build lock/);
  rmSync(lockPath);

  writeFileSync(lockPath, "{}\n");
  const malformedPortableLock = runCli(["run", "build", "--once"], { cwd: repository });
  assert.equal(malformedPortableLock.status, 3);
  assert.match(malformedPortableLock.stderr, /cannot safely read the build lock/);
  rmSync(lockPath);

  const kimi = runCli(["run", "build", "--agent", "kimi", "--once"], { cwd: repository });
  assert.equal(kimi.status, 2);
  assert.match(kimi.stderr, /Kimi automation is disabled/);

  mkdirSync(join(repository, ".claude"), { recursive: true });
  writeFileSync(join(repository, ".claude", "scheduled_tasks.lock"), `${JSON.stringify({ pid: process.pid })}\n`);
  const claudeConflict = runCli(["run", "build", "--once"], { cwd: repository });
  assert.equal(claudeConflict.status, 3);
  assert.match(claudeConflict.stderr, /Claude scheduler is active/);
  rmSync(join(repository, ".claude", "scheduled_tasks.lock"));

  writeFileSync(join(repository, ".claude", "scheduled_tasks.lock"), "not-json\n");
  const corruptClaudeLock = runCli(["run", "build", "--once"], { cwd: repository });
  assert.equal(corruptClaudeLock.status, 3);
  assert.match(corruptClaudeLock.stderr, /cannot safely read the Claude scheduler lock/);
  rmSync(join(repository, ".claude", "scheduled_tasks.lock"));

  writeFileSync(join(repository, ".claude", "scheduled_tasks.lock"), "{}\n");
  const malformedClaudeLock = runCli(["run", "build", "--once"], { cwd: repository });
  assert.equal(malformedClaudeLock.status, 3);
  assert.match(malformedClaudeLock.stderr, /cannot safely read the Claude scheduler lock/);
  rmSync(join(repository, ".claude", "scheduled_tasks.lock"));

  const invalidPass = runCli(["run", "build", "--once"], {
    cwd: repository,
    agentOutput: "completed without a result marker",
  });
  assert.equal(invalidPass.status, 3);
  assert.match(invalidPass.stderr, /missing GSD_LOOP_RESULT/);

  const trailingOutput = runCli(["run", "build", "--once"], {
    cwd: repository,
    agentOutput: 'GSD_LOOP_RESULT={"lane":"build","status":"work","reason":"not-final"}\ntrailing output',
  });
  assert.equal(trailingOutput.status, 3);
  assert.match(trailingOutput.stderr, /final output line/);

  const extraResultField = runCli(["run", "build", "--once"], {
    cwd: repository,
    agentOutput: 'GSD_LOOP_RESULT={"lane":"build","status":"work","reason":"extra","unexpected":true}',
  });
  assert.equal(extraResultField.status, 3);
  assert.match(extraResultField.stderr, /invalid GSD_LOOP_RESULT/);

  console.log("native onboarding and runner passed");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
