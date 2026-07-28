import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const lanes = ["spec", "build", "review", "schedule"];

for (const lane of lanes) {
  const name = `gsd-loop-${lane}`;
  const entrypoint = join(repositoryRoot, ".claude", "skills", name, "SKILL.md");
  const source = readFileSync(entrypoint, "utf8");
  const link = source.match(/\[canonical skill\]\(([^)]+)\)/);

  assert.ok(link, `${name} must delegate to its canonical skill`);

  const canonicalPath = resolve(dirname(entrypoint), link[1]);
  const expectedPath = join(repositoryRoot, ".agents", "skills", name, "SKILL.md");
  assert.equal(canonicalPath, expectedPath, `${name} must use the maintained entry point`);

  const canonical = readFileSync(canonicalPath, "utf8");
  assert.match(canonical, new RegExp(`^name: ${name}$`, "m"));
}

for (const [lane, script, error] of [
  ["build", "ensure-linkage.mjs", /linkage requires a positive issue number/i],
  ["review", "sync-outcomes.mjs", /outcomes requires a positive issue number/i],
  ["review", "validate-audit-evidence.mjs", /audit evidence requires --baseline/i],
]) {
  const guard = join(
    repositoryRoot,
    ".agents",
    "skills",
    `gsd-loop-${lane}`,
    "scripts",
    script,
  );
  const result = spawnSync(process.execPath, [guard], { encoding: "utf8" });

  assert.equal(result.status, 2, `${script} must reject a missing invocation`);
  assert.match(result.stderr, error);
}

console.log("Claude skill entry points passed");
