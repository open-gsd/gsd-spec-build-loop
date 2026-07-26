import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

try {
  const npmEnvironment = { ...process.env, npm_config_dry_run: "false" };
  const packResult = command("npm", ["pack", "--json", "--pack-destination", testRoot], {
    env: npmEnvironment,
  });
  const [packMetadata] = JSON.parse(packResult.stdout);
  const { filename } = packMetadata;
  const tarball = join(testRoot, filename);
  const consumer = join(testRoot, "consumer");
  mkdirSync(consumer);
  command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", consumer, tarball], {
    env: npmEnvironment,
  });

  const packageRoot = join(consumer, "node_modules", "@open-gsd", "gsd-loop");
  const cli = join(packageRoot, "bin", "gsd-loop.mjs");
  const metadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const run = (args, options = {}) => command(process.execPath, [cli, ...args], options);

  assert.equal(run(["--version"]).stdout.trim(), metadata.version);

  const home = join(testRoot, "home");
  run(["install", "--home", home]);
  run(["install", "--home", home]);
  for (const lane of ["spec", "build", "review", "schedule"]) {
    const skill = join(home, ".agents", "skills", `gsd-loop-${lane}`);
    const claude = join(home, ".claude", "skills", `gsd-loop-${lane}`);
    assert.ok(existsSync(join(skill, "SKILL.md")));
    assert.ok(existsSync(join(skill, ".gsd-loop-install.json")));
    assert.ok(existsSync(claude));
  }
  assert.ok(existsSync(join(home, ".agents", "skills", "gsd-loop-build", "playbook.md")));
  assert.ok(existsSync(join(home, ".agents", "skills", "gsd-loop-schedule", "scripts", "doctor.sh")));
  assert.ok(existsSync(join(home, ".agents", "skills", "gsd-loop-schedule", "scripts", "scheduler-policy.sh")));

  const dryHome = join(testRoot, "dry-home");
  run(["install", "--home", dryHome, "--dry-run"]);
  assert.equal(existsSync(dryHome), false);

  const geminiHome = join(testRoot, "gemini-home");
  run(["install", "--home", geminiHome, "--agents", "gemini"]);
  assert.ok(existsSync(join(geminiHome, ".agents", "skills", "gsd-loop-spec")));
  assert.equal(existsSync(join(geminiHome, ".claude")), false);

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
  assert.ok(packageFiles.includes("lib/install.mjs"));
  assert.ok(packageFiles.includes(".agents/skills/gsd-loop-build/SKILL.md"));
  assert.ok(packageFiles.includes("loop/build.md"));
  assert.equal(packageFiles.some((path) => path.startsWith("tests/")), false);

  console.log("npm package installation passed");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
