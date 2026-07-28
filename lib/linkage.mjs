import { BlockedError, UsageError } from "./errors.mjs";
import { checked, parseJson, runProcess } from "./process.mjs";

export function parseLinkageArguments(values) {
  const [issueValue, ...options] = values;
  const parsed = {
    issue: Number(issueValue),
    repo: null,
    pullRequest: null,
    expectedHead: null,
  };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = options[index + 1];
    if (!["--repo", "--pr", "--head"].includes(option) || !value || value.startsWith("--")) {
      throw new UsageError(`invalid linkage option: ${option ?? ""}`.trim());
    }
    if (option === "--repo") parsed.repo = value;
    if (option === "--pr") parsed.pullRequest = Number(value);
    if (option === "--head") parsed.expectedHead = value;
    index += 1;
  }
  if (!Number.isInteger(parsed.issue) || parsed.issue < 1) {
    throw new UsageError("linkage requires a positive issue number");
  }
  if (!parsed.repo || !/^[^/]+\/[^/]+$/.test(parsed.repo)) {
    throw new UsageError("linkage requires --repo OWNER/NAME");
  }
  if (!Number.isInteger(parsed.pullRequest) || parsed.pullRequest < 1) {
    throw new UsageError("linkage requires --pr NUMBER");
  }
  if (!parsed.expectedHead || !/^[0-9a-f]{7,40}$/i.test(parsed.expectedHead)) {
    throw new UsageError("linkage requires --head COMMIT_SHA");
  }
  return parsed;
}

function pullRequestEvidence({ cwd, repo, pullRequest, run }) {
  const output = checked("gh", [
    "pr", "view", String(pullRequest),
    "--repo", repo,
    "--json", "headRefOid,body",
  ], { cwd, run });
  const pullRequestData = parseJson(output, `PR #${pullRequest}`);
  if (typeof pullRequestData.body !== "string") {
    throw new BlockedError(`PR #${pullRequest} has no readable body`);
  }
  return pullRequestData;
}

function assertExpectedHead(pullRequestData, { pullRequest, expectedHead }) {
  if (pullRequestData.headRefOid !== expectedHead) {
    throw new BlockedError(`PR #${pullRequest} head changed; linkage evidence is stale`);
  }
}

function hasClosingMarker(body, issue) {
  return new RegExp(`^\\s*Closes\\s+#${issue}\\b`, "im").test(body);
}

function appendClosingMarker(body, issue) {
  if (!body) return `Closes #${issue}\n`;
  const separator = body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${separator}Closes #${issue}\n`;
}

export function ensurePullRequestLinkage({
  cwd,
  repo,
  issue,
  pullRequest,
  expectedHead,
  run = runProcess,
}) {
  const options = { cwd, repo, issue, pullRequest, expectedHead, run };
  const original = pullRequestEvidence(options);
  assertExpectedHead(original, options);
  if (hasClosingMarker(original.body, issue)) {
    return false;
  }

  const confirmed = pullRequestEvidence(options);
  assertExpectedHead(confirmed, options);
  if (confirmed.body !== original.body) {
    throw new BlockedError(`PR #${pullRequest} body changed while linkage was being verified`);
  }
  const updatedBody = appendClosingMarker(original.body, issue);
  checked("gh", [
    "pr", "edit", String(pullRequest),
    "--repo", repo,
    "--body-file", "-",
  ], { cwd, run, input: updatedBody });

  const updated = pullRequestEvidence(options);
  assertExpectedHead(updated, options);
  if (updated.body !== updatedBody || !hasClosingMarker(updated.body, issue)) {
    throw new BlockedError(`PR #${pullRequest} linkage was not preserved after update`);
  }
  return true;
}
