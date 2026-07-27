import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = mkdtempSync(join(tmpdir(), "gsd-loop-npm-"));

function command(program, args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options;
  const result = spawnSync(program, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...spawnOptions,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${program} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function npmCommand(args, options = {}) {
  const { platform = process.platform, ...commandOptions } = options;
  if (platform !== "win32") {
    return command("npm", args, commandOptions);
  }

  const commandInterpreter = commandOptions.env?.ComSpec || process.env.ComSpec || "cmd.exe";
  return command(
    commandInterpreter,
    ["/d", "/s", "/c", "npm.cmd", ...args],
    commandOptions,
  );
}

try {
  if (process.platform !== "win32") {
    const commandInterpreter = join(testRoot, "cmd.exe");
    writeFileSync(commandInterpreter, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
    chmodSync(commandInterpreter, 0o755);
    const probe = npmCommand(["probe", "argument with spaces"], {
      platform: "win32",
      env: { ...process.env, ComSpec: commandInterpreter, PATH: testRoot },
    });
    assert.deepEqual(probe.stdout.trimEnd().split("\n"), [
      "/d",
      "/s",
      "/c",
      "npm.cmd",
      "probe",
      "argument with spaces",
    ]);
  }

  const npmEnvironment = { ...process.env, npm_config_dry_run: "false" };
  const packResult = npmCommand(["pack", "--json", "--pack-destination", testRoot], {
    env: npmEnvironment,
  });
  const [packMetadata] = JSON.parse(packResult.stdout);
  const { filename } = packMetadata;
  const tarball = join(testRoot, filename);
  const consumer = join(testRoot, "consumer");
  mkdirSync(consumer);
  npmCommand(
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", consumer, tarball],
    { env: npmEnvironment },
  );

  const packageRoot = join(consumer, "node_modules", "@opengsd", "gsd-loop");
  assert.ok(existsSync(packageRoot), "packed artifact must install as @opengsd/gsd-loop");
  const cli = join(packageRoot, "bin", "gsd-loop.mjs");
  const metadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  assert.equal(metadata.name, "@opengsd/gsd-loop");
  assert.equal(metadata.version, "0.2.3");
  const run = (args, options = {}) => command(process.execPath, [cli, ...args], options);

  assert.equal(run(["--version"]).stdout.trim(), metadata.version);
  const help = run(["--help"]).stdout;
  assert.match(help, /gsd-loop init/);
  assert.match(help, /gsd-loop doctor/);
  assert.doesNotMatch(help, /gsd-loop run build\|review/);
  assert.match(
    help,
    /Codex:.*\$gsd-loop-spec.*\$gsd-loop-build.*\$gsd-loop-review.*\$gsd-loop-schedule/,
  );
  assert.match(
    help,
    /Claude Code:.*\/gsd-loop-spec.*\/gsd-loop-build.*\/gsd-loop-review.*\/gsd-loop-schedule/,
  );
  assert.match(
    help,
    /Cursor:.*\/gsd-loop-spec.*\/gsd-loop-build.*\/gsd-loop-review.*\/gsd-loop-schedule/,
  );
  assert.match(
    help,
    /Gemini CLI:.*Use the gsd-loop-spec skill.*Use the gsd-loop-build skill.*Use the gsd-loop-review skill.*Use the gsd-loop-schedule skill/,
  );
  assert.match(
    help,
    /Kimi Code:.*\/skill:gsd-loop-spec.*\/skill:gsd-loop-build.*\/skill:gsd-loop-review.*\/skill:gsd-loop-schedule/,
  );
  assert.match(help, /native adapter behavior/);
  assert.match(help, /gsd-loop policy/);
  const removedRunner = run(["run", "build"], { allowFailure: true });
  assert.equal(removedRunner.status, 2);
  assert.match(removedRunner.stderr, /unknown command: run/);
  assert.equal(run(["policy", "work", "2"]).stdout.trim(), "action=continue interval_minutes=15 idle_count=0");
  assert.equal(run(["policy", "idle", "2"]).stdout.trim(), "action=pause interval_minutes=0 idle_count=3");
  const invalidPolicy = run(["policy", "idle", "invalid"], { allowFailure: true });
  assert.equal(invalidPolicy.status, 2);

  const home = join(testRoot, "home");
  run(["install", "--home", home]);
  run(["install", "--home", home]);
  for (const lane of ["spec", "build", "review", "schedule"]) {
    const skill = join(home, ".agents", "skills", `gsd-loop-${lane}`);
    assert.ok(existsSync(join(skill, "SKILL.md")));
    assert.ok(existsSync(join(skill, ".gsd-loop-install.json")));
    for (const directory of [".claude", ".cursor", ".gemini"]) {
      const adapterRoot = join(home, directory, "skills");
      const adapter = join(adapterRoot, `gsd-loop-${lane}`);
      const marker = join(adapterRoot, `.gsd-loop-${lane}.gsd-loop-adapter.json`);
      assert.ok(existsSync(adapter));
      assert.ok(existsSync(marker));
    }
  }
  assert.ok(existsSync(join(home, ".agents", "skills", "gsd-loop-build", "playbook.md")));
  const outcomeSync = join(home, ".agents", "skills", "gsd-loop-review", "scripts", "sync-outcomes.mjs");
  const auditValidator = join(home, ".agents", "skills", "gsd-loop-review", "scripts", "validate-audit-evidence.mjs");
  assert.ok(existsSync(outcomeSync));
  assert.ok(existsSync(auditValidator));
  mkdirSync(join(home, "lib"));
  writeFileSync(join(home, "lib", "outcomes.mjs"), "throw new Error('wrong runtime');\n");
  const invalidOutcomeSync = command(process.execPath, [outcomeSync], { allowFailure: true });
  assert.equal(invalidOutcomeSync.status, 2);
  assert.match(invalidOutcomeSync.stderr, /requires a positive issue number/);
  const invalidAuditValidator = command(process.execPath, [auditValidator], { allowFailure: true });
  assert.equal(invalidAuditValidator.status, 2);
  assert.match(invalidAuditValidator.stderr, /requires --baseline FULL_SHA/);
  const invalidProjection = command(process.execPath, [
    auditValidator,
    "--baseline", "a".repeat(40),
    "--head", "b".repeat(40),
    "--manifest", "package-lock.json",
  ], { allowFailure: true, input: "[]" });
  assert.equal(invalidProjection.status, 3);
  assert.match(invalidProjection.stderr, /must contain GraphQL pages/);
  assert.equal(existsSync(join(home, ".agents", "skills", "gsd-loop-schedule", "scripts")), false);
  const scheduleSkill = readFileSync(join(home, ".agents", "skills", "gsd-loop-schedule", "SKILL.md"), "utf8");
  assert.match(scheduleSkill, /Codex: `\$gsd-loop-build` or `\$gsd-loop-review`/);
  assert.match(scheduleSkill, /Claude Code: `\/gsd-loop-build` or `\/gsd-loop-review`/);
  assert.match(scheduleSkill, /Cursor: `\/gsd-loop-build` or `\/gsd-loop-review`/);
  assert.match(scheduleSkill, /Gemini CLI: `Use the gsd-loop-build skill` or `Use the gsd-loop-review skill`/);
  assert.match(scheduleSkill, /Kimi Code: `\/skill:gsd-loop-build` or `\/skill:gsd-loop-review`/);
  assert.match(scheduleSkill, /npx @opengsd\/gsd-loop@latest policy EVENT IDLE_COUNT/);
  assert.doesNotMatch(scheduleSkill, /npx @opengsd\/gsd-loop@latest run/);
  const scheduleMetadata = readFileSync(join(home, ".agents", "skills", "gsd-loop-schedule", "agents", "openai.yaml"), "utf8");
  assert.match(scheduleMetadata, /schedule one GSD build or review lane/);
  assert.doesNotMatch(scheduleMetadata, /build and review loops/);

  const damagedSkill = join(home, ".agents", "skills", "gsd-loop-build");
  const danglingAdapter = join(home, ".claude", "skills", "gsd-loop-build");
  rmSync(damagedSkill, { recursive: true });
  assert.equal(existsSync(danglingAdapter), false);
  assert.equal(lstatSync(danglingAdapter).isSymbolicLink(), true);
  run(["install", "--home", home]);
  assert.ok(existsSync(join(damagedSkill, "playbook.md")));
  assert.equal(lstatSync(danglingAdapter).isSymbolicLink(), true);

  const dryHome = join(testRoot, "dry-home");
  run(["install", "--home", dryHome, "--dry-run"]);
  assert.equal(existsSync(dryHome), false);

  const geminiHome = join(testRoot, "gemini-home");
  run(["install", "--home", geminiHome, "--agents", "gemini"]);
  assert.ok(existsSync(join(geminiHome, ".agents", "skills", "gsd-loop-spec")));
  assert.ok(existsSync(join(geminiHome, ".gemini", "skills", "gsd-loop-spec")));
  assert.equal(existsSync(join(geminiHome, ".claude")), false);
  assert.equal(existsSync(join(geminiHome, ".cursor")), false);

  const cursorRootConflictHome = join(testRoot, "cursor-root-conflict-home");
  run(["install", "--home", cursorRootConflictHome, "--agents", "codex"]);
  const cursorCanonicalBuild = join(
    cursorRootConflictHome,
    ".agents",
    "skills",
    "gsd-loop-build",
    "SKILL.md",
  );
  const cursorCanonicalSpec = join(cursorRootConflictHome, ".agents", "skills", "gsd-loop-spec");
  writeFileSync(cursorCanonicalBuild, "old canonical\n");
  rmSync(cursorCanonicalSpec, { recursive: true });
  mkdirSync(join(cursorRootConflictHome, ".cursor"), { recursive: true });
  const cursorRootConflict = join(cursorRootConflictHome, ".cursor", "skills");
  writeFileSync(cursorRootConflict, "preserve root\n");
  const cursorRootFailed = run(
    ["install", "--home", cursorRootConflictHome, "--agents", "cursor"],
    { allowFailure: true },
  );
  assert.notEqual(cursorRootFailed.status, 0);
  assert.match(cursorRootFailed.stderr, /refusing to overwrite unowned path/);
  assert.equal(readFileSync(cursorRootConflict, "utf8"), "preserve root\n");
  assert.equal(readFileSync(cursorCanonicalBuild, "utf8"), "old canonical\n");
  assert.equal(existsSync(cursorCanonicalSpec), false);

  const geminiParentConflictHome = join(testRoot, "gemini-parent-conflict-home");
  run(["install", "--home", geminiParentConflictHome, "--agents", "codex"]);
  const geminiCanonicalBuild = join(
    geminiParentConflictHome,
    ".agents",
    "skills",
    "gsd-loop-build",
    "SKILL.md",
  );
  const geminiCanonicalSpec = join(geminiParentConflictHome, ".agents", "skills", "gsd-loop-spec");
  writeFileSync(geminiCanonicalBuild, "old canonical\n");
  rmSync(geminiCanonicalSpec, { recursive: true });
  const geminiParentConflict = join(geminiParentConflictHome, ".gemini");
  writeFileSync(geminiParentConflict, "preserve parent\n");
  const geminiParentFailed = run(
    ["install", "--home", geminiParentConflictHome, "--agents", "gemini"],
    { allowFailure: true },
  );
  assert.notEqual(geminiParentFailed.status, 0);
  assert.match(geminiParentFailed.stderr, /refusing to overwrite unowned path/);
  assert.equal(readFileSync(geminiParentConflict, "utf8"), "preserve parent\n");
  assert.equal(readFileSync(geminiCanonicalBuild, "utf8"), "old canonical\n");
  assert.equal(existsSync(geminiCanonicalSpec), false);

  const cursorConflictHome = join(testRoot, "cursor-conflict-home");
  const cursorConflict = join(cursorConflictHome, ".cursor", "skills", "gsd-loop-review");
  mkdirSync(cursorConflict, { recursive: true });
  writeFileSync(join(cursorConflict, "user-file"), "preserve me\n");
  const cursorFailed = run(["install", "--home", cursorConflictHome], { allowFailure: true });
  assert.notEqual(cursorFailed.status, 0);
  assert.match(cursorFailed.stderr, /refusing to overwrite unowned path/);
  assert.equal(readFileSync(join(cursorConflict, "user-file"), "utf8"), "preserve me\n");
  assert.equal(existsSync(join(cursorConflictHome, ".agents")), false);

  if (process.platform !== "win32") {
    const migrationHome = join(testRoot, "migration-home");
    command("python3", [join(repositoryRoot, "scripts", "install-global.py"), "--home", migrationHome]);
    run(["install", "--home", migrationHome]);
    assert.ok(existsSync(join(migrationHome, ".agents", "skills", "gsd-loop-review", "playbook.md")));
  }

  const conflictHome = join(testRoot, "conflict-home");
  const conflict = join(conflictHome, ".agents", "skills", "gsd-loop-build");
  mkdirSync(conflict, { recursive: true });
  writeFileSync(join(conflict, "user-file"), "preserve me\n");
  const failed = run(["install", "--home", conflictHome], { allowFailure: true });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /refusing to overwrite unowned path/);
  assert.equal(readFileSync(join(conflict, "user-file"), "utf8"), "preserve me\n");
  assert.equal(existsSync(join(conflictHome, ".agents", "skills", "gsd-loop-spec")), false);

  const packageFiles = packMetadata.files.map(({ path }) => path);
  assert.ok(packageFiles.includes("bin/gsd-loop.mjs"));
  assert.ok(packageFiles.includes("docs/install.md"));
  assert.ok(packageFiles.includes("lib/install.mjs"));
  assert.ok(packageFiles.includes("lib/init.mjs"));
  assert.equal(packageFiles.includes("lib/runner.mjs"), false);
  assert.ok(packageFiles.includes(".agents/skills/gsd-loop-build/SKILL.md"));
  assert.ok(packageFiles.includes("loop/build.md"));
  assert.equal(packageFiles.some((path) => path.startsWith("tests/")), false);

  console.log("npm package installation passed");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
