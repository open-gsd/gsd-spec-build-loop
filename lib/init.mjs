import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { inspectDoctor, LABELS, resolveRepository } from "./doctor.mjs";
import { BlockedError, UsageError } from "./errors.mjs";
import { install, parseInstallArguments, SKILLS } from "./install.mjs";
import { checked, parseJson, runProcess } from "./process.mjs";

const LABEL_DESCRIPTIONS = new Map([
  ["gsd:ready", "Approved for the gsd-loop build queue"],
  ["gsd:blocked", "Waiting for a human answer"],
  ["gsd:approved", "Automated review evidence is complete"],
  ["gsd:rework", "Automated review requires changes"],
  ["gsd:escalated", "Removed from automation pending human action"],
]);
const SCHEDULER_LOCK_EXCLUDE = ".gsd/scheduled_tasks.lock";

function valueAfter(argumentsList, index, option) {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${option} requires a value`);
  }
  return value;
}

export function parseInitArguments(argumentsList) {
  const installArguments = [];
  const options = {
    yes: false,
    dryRun: false,
    createRepo: false,
    repo: null,
    visibility: null,
    requiredCheck: null,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["--yes", "--dry-run", "--create-repo"].includes(argument)) {
      if (argument === "--yes") options.yes = true;
      if (argument === "--dry-run") options.dryRun = true;
      if (argument === "--create-repo") options.createRepo = true;
      if (argument === "--dry-run") installArguments.push(argument);
      continue;
    }
    if (["--repo", "--visibility", "--required-check"].includes(argument)) {
      const value = valueAfter(argumentsList, index, argument);
      index += 1;
      if (argument === "--repo") options.repo = value;
      if (argument === "--visibility") options.visibility = value;
      if (argument === "--required-check") options.requiredCheck = value;
      continue;
    }
    if (["--home", "--agents", "--adapter-mode"].includes(argument)) {
      const value = valueAfter(argumentsList, index, argument);
      installArguments.push(argument, value);
      index += 1;
      continue;
    }
    throw new UsageError(`unknown option: ${argument}`);
  }
  if (options.repo && !/^[^/]+\/[^/]+$/.test(options.repo)) {
    throw new UsageError("--repo must use OWNER/NAME form");
  }
  if (options.visibility && !["private", "public"].includes(options.visibility)) {
    throw new UsageError("--visibility must be private or public");
  }
  return { ...options, installOptions: parseInstallArguments(installArguments) };
}

function gitRoot(cwd, run) {
  const result = run("git", ["rev-parse", "--show-toplevel"], { cwd });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function choose(prompt, choices, io) {
  const answer = await io.question(`${prompt}\n${choices.map((choice, index) => `  ${index + 1}. ${choice}`).join("\n")}\nSelection: `);
  const index = Number.parseInt(answer, 10) - 1;
  if (!Number.isInteger(index) || !choices[index]) {
    throw new UsageError("invalid selection");
  }
  return choices[index];
}

function successfulChecks(cwd, repo, branch, run) {
  const references = [branch];
  const pullRequests = checked("gh", ["pr", "list", "--repo", repo, "--state", "open", "--limit", "1", "--json", "headRefOid,updatedAt"], { cwd, run });
  const [latest] = parseJson(pullRequests, "open GitHub pull requests");
  if (latest?.headRefOid) references.push(latest.headRefOid);
  const checkRuns = references.flatMap((reference) => {
    const response = checked("gh", ["api", `repos/${repo}/commits/${reference}/check-runs`], { cwd, run });
    return parseJson(response, `GitHub check runs for ${reference}`).check_runs ?? [];
  });
  const seen = new Set();
  return checkRuns
    .filter((check) => check.conclusion === "success")
    .map((check) => ({ name: check.name, integrationId: check.app?.id ?? null, app: check.app?.slug ?? "unknown" }))
    .filter((check) => {
      const key = `${check.name}:${check.integrationId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function selectCheck(options, checks, io) {
  if (options.requiredCheck) {
    const matches = checks.filter(({ name }) => name === options.requiredCheck);
    if (matches.length !== 1) {
      throw new UsageError(`--required-check ${options.requiredCheck} did not identify exactly one successful check`);
    }
    return matches[0];
  }
  if (!checks.length) return null;
  if (checks.length === 1) return checks[0];
  if (options.yes) {
    throw new UsageError("multiple successful checks exist; --yes requires --required-check NAME");
  }
  const labels = checks.map((check) => `${check.name} (${check.app})`);
  return checks[labels.indexOf(await choose("Choose the required CI check:", labels, io))];
}

function printPreview(lines) {
  console.log("\nPlanned changes:");
  for (const line of lines) console.log(`  - ${line}`);
}

async function confirm(options, io) {
  if (options.yes) return;
  const answer = (await io.question("Apply these changes? [y/N] ")).trim().toLowerCase();
  if (!["y", "yes"].includes(answer)) {
    throw new BlockedError("setup cancelled; no changes were applied");
  }
}

function createRuleset(cwd, repo, check, run) {
  const listed = run("gh", ["api", `repos/${repo}/rulesets`], { cwd });
  if (listed.status !== 0) {
    console.warn("warning: GitHub rulesets are unavailable for this repository; review remains blocked");
    return false;
  }
  const existing = parseJson(listed.stdout, "GitHub rulesets");
  const owned = existing.find(({ name }) => name === "gsd-loop required CI");
  const payload = {
    name: "gsd-loop required CI",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [{
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: check.name, integration_id: check.integrationId }],
      },
    }],
  };
  const method = owned ? "PUT" : "POST";
  const endpoint = owned ? `repos/${repo}/rulesets/${owned.id}` : `repos/${repo}/rulesets`;
  const result = run("gh", ["api", "--method", method, endpoint, "--input", "-"], {
    cwd,
    input: JSON.stringify(payload),
  });
  if (result.status !== 0) {
    console.warn("warning: GitHub could not create the required-check ruleset; review remains blocked");
    return false;
  }
  return true;
}

function createLabels(cwd, repo, missingLabels, run) {
  for (const label of missingLabels) {
    checked("gh", [
      "label", "create", label,
      "--repo", repo,
      "--color", "ededed",
      "--description", LABEL_DESCRIPTIONS.get(label),
    ], { cwd, run });
  }
}

function excludeSchedulerLock(cwd, run) {
  const gitPath = checked("git", ["rev-parse", "--git-path", "info/exclude"], { cwd, run });
  const excludePath = resolve(cwd, gitPath);
  const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  if (current.split(/\r?\n/).includes(SCHEDULER_LOCK_EXCLUDE)) {
    return;
  }
  mkdirSync(dirname(excludePath), { recursive: true });
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  appendFileSync(excludePath, `${separator}${SCHEDULER_LOCK_EXCLUDE}\n`);
}

function newRepositoryDetails(options, cwd, run) {
  if (readdirSync(cwd).length) {
    throw new UsageError("automatic repository creation is limited to an empty directory");
  }
  if (options.yes && (!options.createRepo || !options.repo || !options.visibility)) {
    throw new UsageError("outside a Git repository, --yes requires --create-repo, --repo OWNER/NAME, and --visibility private|public");
  }
  const owner = checked("gh", ["api", "user", "--jq", ".login"], { cwd, run });
  const repo = options.repo ?? `${owner}/${basename(cwd)}`;
  const visibility = options.visibility ?? "private";
  return { repo, visibility };
}

function createRepository(cwd, repo, visibility, run) {
  checked("git", ["config", "--get", "user.name"], { cwd: resolve(cwd, ".."), run });
  checked("git", ["config", "--get", "user.email"], { cwd: resolve(cwd, ".."), run });
  checked("git", ["init", "-b", "main"], { cwd, run });
  checked("git", ["commit", "--allow-empty", "-m", "Initial commit"], { cwd, run });
  checked("gh", ["repo", "create", repo, `--${visibility}`, "--source", cwd, "--remote", "origin", "--push"], { cwd, run });
}

export async function initialize({ sourceRoot, cwd, options, run = runProcess, io: suppliedIo }) {
  const ownsIo = !suppliedIo;
  const io = suppliedIo ?? createInterface({ input, output });
  try {
    checked("gh", ["--version"], { cwd, run });
    checked("gh", ["auth", "status"], { cwd, run });
    let root = gitRoot(cwd, run);
    let repo = options.repo;
    let visibility = options.visibility;
    let createRepo = false;
    if (!root) {
      const details = newRepositoryDetails(options, cwd, run);
      repo = details.repo;
      visibility = details.visibility;
      createRepo = true;
      root = cwd;
    } else {
      const checkoutRepo = resolveRepository({ cwd: root, run });
      if (repo && repo.toLowerCase() !== checkoutRepo.toLowerCase()) {
        throw new UsageError(`--repo ${repo} does not match the current checkout ${checkoutRepo}`);
      }
      repo = checkoutRepo;
    }
    install({ ...options.installOptions, sourceRoot, dryRun: true });
    let doctor = null;
    let check = null;
    if (!createRepo) {
      doctor = inspectDoctor({ cwd: root, repo, run });
      check = await selectCheck(options, successfulChecks(root, repo, doctor.defaultBranch, run), io);
    }
    const missingLabels = doctor?.missingLabels ?? LABELS;
    const preview = [
      `Install or update ${SKILLS.length} gsd-loop skills for ${[...options.installOptions.agents].sort().join(", ")}`,
    ];
    if (createRepo) {
      preview.push(`Initialize Git with an empty commit and create ${visibility} repository ${repo}`);
    }
    preview.push(`Create ${missingLabels.length} gsd labels`);
    preview.push(`Exclude ${SCHEDULER_LOCK_EXCLUDE} from the local Git worktree`);
    if (check) preview.push(`Require successful check: ${check.name}`);
    else preview.push("Leave review blocked until a successful CI check exists");
    printPreview(preview);
    if (options.dryRun) return 0;
    await confirm(options, io);
    if (createRepo) createRepository(root, repo, visibility, run);
    install({ ...options.installOptions, sourceRoot, dryRun: false });
    excludeSchedulerLock(root, run);
    createLabels(root, repo, missingLabels, run);
    const reviewReady = check ? createRuleset(root, repo, check, run) : doctor?.reviewReady ?? false;
    console.log("\ngsd-loop initialized");
    console.log("build: ready");
    console.log(`review: ${reviewReady ? "ready" : "blocked — rerun init after CI succeeds"}`);
    return reviewReady ? 0 : 3;
  } finally {
    if (ownsIo) io.close();
  }
}
