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
  else if (endpoint === "repos/octocat/project/labels?per_page=100") {
    const entries = existsSync(process.env.MOCK_GH_LOG)
      ? readFileSync(process.env.MOCK_GH_LOG, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse)
      : [];
    const labels = entries
      .filter((entry) => entry[0] === "label" && entry[1] === "create" && entry[entry.indexOf("--repo") + 1] === "octocat/project")
      .map((entry) => ({ name: entry[2] }));
    console.log(JSON.stringify([labels]));
  }
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
else process.exit(1);
`);

  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /gsd-loop init/);
  assert.doesNotMatch(help.stdout, /gsd-loop run build\|review/);
  assert.match(
    help.stdout,
    /Codex:.*\$gsd-loop-spec.*\$gsd-loop-build.*\$gsd-loop-review.*\$gsd-loop-schedule/,
  );
  assert.match(
    help.stdout,
    /Claude Code:.*\/gsd-loop-spec.*\/gsd-loop-build.*\/gsd-loop-review.*\/gsd-loop-schedule/,
  );
  assert.match(
    help.stdout,
    /Cursor:.*\/gsd-loop-spec.*\/gsd-loop-build.*\/gsd-loop-review.*\/gsd-loop-schedule/,
  );
  assert.match(
    help.stdout,
    /Gemini CLI:.*Use the gsd-loop-spec skill.*Use the gsd-loop-build skill.*Use the gsd-loop-review skill.*Use the gsd-loop-schedule skill/,
  );
  assert.match(
    help.stdout,
    /Kimi Code:.*\/skill:gsd-loop-spec.*\/skill:gsd-loop-build.*\/skill:gsd-loop-review.*\/skill:gsd-loop-schedule/,
  );
  assert.match(help.stdout, /native adapter behavior/);

  const removedRunner = runCli(["run", "build"]);
  assert.equal(removedRunner.status, 2);
  assert.match(removedRunner.stderr, /unknown command: run/);

  const removedRunnerOption = runCli(["init", "--runner", "codex"]);
  assert.equal(removedRunnerOption.status, 2);
  assert.match(removedRunnerOption.stderr, /unknown option: --runner/);

  const empty = join(testRoot, "empty");
  mkdirSync(empty);
  const unsafeCreate = runCli(["init", "--yes"], { cwd: empty });
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
    "--home", createdHome,
  ], { cwd: createdRepository });
  assert.equal(created.status, 3, created.stderr);
  assert.match(created.stdout, /review: blocked/);
  assert.equal(command("git", ["branch", "--show-current"], { cwd: createdRepository }).stdout.trim(), "main");
  assert.equal(command("git", ["rev-list", "--count", "HEAD"], { cwd: createdRepository }).stdout.trim(), "1");
  assert.match(command("git", ["remote", "get-url", "origin"], { cwd: createdRepository }).stdout, /octocat-created[.]git/);
  assert.equal(existsSync(join(createdRepository, ".git", "gsd-loop")), false);

  const noAgentProbeRepository = join(testRoot, "no-agent-probe");
  mkdirSync(noAgentProbeRepository);
  const noAgentProbe = runCli([
    "init",
    "--yes",
    "--create-repo",
    "--repo", "octocat/no-agent-probe",
    "--visibility", "private",
    "--home", join(testRoot, "no-agent-probe-home"),
  ], { cwd: noAgentProbeRepository, agentAuthFail: true });
  assert.equal(noAgentProbe.status, 3, noAgentProbe.stderr);
  assert.ok(existsSync(join(noAgentProbeRepository, ".git")));
  assert.ok(readLog().some((args) => args[0] === "repo" && args[1] === "create" && args[2] === "octocat/no-agent-probe"));

  const oneConfirmationRepository = join(testRoot, "one-confirmation");
  mkdirSync(oneConfirmationRepository);
  const oneConfirmation = runCli([
    "init",
    "--home", join(testRoot, "one-confirmation-home"),
  ], { cwd: oneConfirmationRepository, input: "y\n" });
  assert.equal(oneConfirmation.status, 3, oneConfirmation.stderr);
  assert.match(oneConfirmation.stdout, /Planned changes:/);
  assert.equal(existsSync(join(oneConfirmationRepository, ".git", "gsd-loop")), false);
  assert.equal(readLog().filter((args) => args[0] === "repo" && args[1] === "create" && args[2] === "octocat/one-confirmation").length, 1);

  const repository = join(testRoot, "project");
  const home = join(testRoot, "home");
  initializeRepository(repository);

  writeFileSync(ghLog, "");
  const mismatchedRepository = runCli([
    "init",
    "--dry-run",
    "--yes",
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
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", home,
  ], { cwd: repository });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Create 5 gsd labels/);
  assert.match(dryRun.stdout, /Require successful check: test/);
  assert.doesNotMatch(dryRun.stdout, /Autonomous runner command/);
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
    "init", "--dry-run", "--yes",
    "--repo", "octocat/project", "--required-check", "test",
    "--home", join(testRoot, "pr-inspection-failure-home"),
  ], { cwd: repository, prListFail: true });
  assert.equal(pullRequestInspectionFailure.status, 1);
  assert.match(pullRequestInspectionFailure.stderr, /gh pr list .* failed/);

  const checkInspectionFailure = runCli([
    "init", "--dry-run", "--yes",
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
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", rulesetFailureHome,
  ], { cwd: rulesetFailureRepository, rulesetFail: true });
  assert.equal(rulesetFailure.status, 3);
  assert.match(rulesetFailure.stdout, /build: ready/);
  assert.match(rulesetFailure.stdout, /review: blocked/);
  assert.equal(existsSync(join(rulesetFailureRepository, ".git", "gsd-loop")), false);

  const rulesetListFailureRepository = join(testRoot, "ruleset-list-failure");
  initializeRepository(rulesetListFailureRepository);
  writeFileSync(ghLog, "");
  const rulesetListFailure = runCli([
    "init",
    "--yes",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", join(testRoot, "ruleset-list-failure-home"),
  ], { cwd: rulesetListFailureRepository, rulesetListFail: true });
  assert.equal(rulesetListFailure.status, 3);
  assert.match(rulesetListFailure.stdout, /build: ready/);
  assert.equal(existsSync(join(rulesetListFailureRepository, ".git", "gsd-loop")), false);

  writeFileSync(ghLog, "");
  const initialized = runCli([
    "init",
    "--yes",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", home,
  ], { cwd: repository });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /build: ready/);
  assert.match(initialized.stdout, /review: ready/);
  assert.ok(existsSync(join(home, ".agents", "skills", "gsd-loop-build", "SKILL.md")));
  assert.ok(existsSync(join(home, ".cursor", "skills", "gsd-loop-build", "SKILL.md")));
  assert.ok(existsSync(join(home, ".gemini", "skills", "gsd-loop-build", "SKILL.md")));
  assert.equal(existsSync(join(repository, ".git", "gsd-loop")), false);
  const localExclude = join(repository, ".git", "info", "exclude");
  assert.match(readFileSync(localExclude, "utf8"), /^\.gsd\/scheduled_tasks\.lock$/m);
  assert.doesNotMatch(readFileSync(localExclude, "utf8"), /^\.claude\/scheduled_tasks\.lock$/m);
  mkdirSync(join(repository, ".gsd"), { recursive: true });
  mkdirSync(join(repository, ".claude"), { recursive: true });
  writeFileSync(join(repository, ".gsd", "scheduled_tasks.lock"), "gsd-loop scheduler state\n");
  writeFileSync(join(repository, ".claude", "scheduled_tasks.lock"), "legacy scheduler state\n");
  const schedulerStatus = command("git", ["status", "--short", "--untracked-files=all"], { cwd: repository });
  assert.equal(schedulerStatus.status, 0, schedulerStatus.stderr);
  assert.equal(schedulerStatus.stdout, "?? .claude/scheduled_tasks.lock\n");
  rmSync(join(repository, ".claude"), { recursive: true, force: true });
  const initializedAgain = runCli([
    "init", "--yes",
    "--repo", "octocat/project",
    "--required-check", "test",
    "--home", home,
  ], { cwd: repository });
  assert.equal(initializedAgain.status, 0, initializedAgain.stderr);
  assert.equal(
    readFileSync(localExclude, "utf8").split(/\r?\n/)
      .filter((line) => line === ".gsd/scheduled_tasks.lock").length,
    1,
  );
  assert.ok(readLog().some((args) => args[0] === "label" && args[1] === "create"));
  assert.ok(readLog().some((args) => args.includes("--method") && args.includes("POST")));

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

  console.log("native onboarding passed");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
