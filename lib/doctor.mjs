import { CliError } from "./errors.mjs";
import { runProcess } from "./process.mjs";

export const LABELS = [
  "gsd:ready",
  "gsd:blocked",
  "gsd:approved",
  "gsd:rework",
  "gsd:escalated",
];

function checked(program, argumentsList, options = {}) {
  const result = (options.run ?? runProcess)(program, argumentsList, options);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new CliError(`${program} ${argumentsList.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function parseJson(value, description) {
  try {
    return JSON.parse(value);
  } catch {
    throw new CliError(`could not parse ${description}`);
  }
}

export function resolveRepository({ cwd, repo, run = runProcess }) {
  if (repo) {
    return repo;
  }
  return checked("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd, run });
}

export function inspectDoctor({ cwd, repo, run = runProcess }) {
  checked("gh", ["--version"], { cwd, run });
  checked("gh", ["auth", "status"], { cwd, run });
  const resolvedRepo = resolveRepository({ cwd, repo, run });
  const repository = parseJson(
    checked("gh", ["api", `repos/${resolvedRepo}`], { cwd, run }),
    `GitHub repository ${resolvedRepo}`,
  );
  if (repository.permissions?.push !== true) {
    throw new CliError(`no push access to ${resolvedRepo}`);
  }
  const defaultBranch = repository.default_branch;
  if (!defaultBranch) {
    throw new CliError(`GitHub did not report a default branch for ${resolvedRepo}`);
  }
  const labels = parseJson(
    checked("gh", ["label", "list", "--repo", resolvedRepo, "--limit", "100", "--json", "name"], { cwd, run }),
    "GitHub labels",
  );
  const presentLabels = new Set(labels.map(({ name }) => name));
  const missingLabels = LABELS.filter((label) => !presentLabels.has(label));
  const rulesResult = run("gh", ["api", `repos/${resolvedRepo}/rules/branches/${defaultBranch}`], { cwd });
  let reviewReady = false;
  if (rulesResult.status === 0) {
    const rules = parseJson(rulesResult.stdout, "GitHub branch rules");
    reviewReady = rules.some(({ type }) => type === "required_status_checks");
  }
  return {
    repo: resolvedRepo,
    defaultBranch,
    buildReady: true,
    reviewReady,
    missingLabels,
  };
}

export function formatDoctor(report) {
  const lines = [
    `repo: ${report.repo}`,
    `default branch: ${report.defaultBranch}`,
    "build: ready",
    `review: ${report.reviewReady ? "ready" : "blocked — required CI checks are not configured"}`,
  ];
  if (report.missingLabels.length) {
    lines.push(`labels missing: ${report.missingLabels.join(", ")}`);
  }
  return lines.join("\n");
}
