import { CliError } from "./errors.mjs";
import { checked, parseJson, runProcess } from "./process.mjs";

export const LABELS = [
  "gsd:ready",
  "gsd:blocked",
  "gsd:approved",
  "gsd:rework",
  "gsd:escalated",
];

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
  const labelPages = parseJson(
    checked("gh", [
      "api",
      "--paginate",
      "--slurp",
      `repos/${resolvedRepo}/labels?per_page=100`,
    ], { cwd, run }),
    "GitHub labels",
  );
  if (!Array.isArray(labelPages) || labelPages.some((page) => !Array.isArray(page))) {
    throw new CliError("GitHub returned malformed label pages");
  }
  const presentLabels = new Set(labelPages.flatMap((page) => page.map(({ name }) => name)));
  const missingLabels = LABELS.filter((label) => !presentLabels.has(label));
  const rulesResult = run("gh", ["api", `repos/${resolvedRepo}/rules/branches/${defaultBranch}`], { cwd });
  if (rulesResult.status !== 0) {
    const detail = rulesResult.stderr.trim() || rulesResult.stdout.trim() || `exit ${rulesResult.status}`;
    if (!/HTTP (?:403|404)|not found/i.test(detail)) {
      throw new CliError(`gh api repos/${resolvedRepo}/rules/branches/${defaultBranch} failed: ${detail}`);
    }
  }
  const rules = rulesResult.status === 0 ? parseJson(rulesResult.stdout, "GitHub branch rules") : [];
  const reviewReady = rules.some(({ type }) => type === "required_status_checks");
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
