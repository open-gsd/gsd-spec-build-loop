import { BlockedError, UsageError } from "./errors.mjs";
import { checked, parseJson, runProcess } from "./process.mjs";

const PULL_REQUEST_QUERY = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        headRefOid
        body
        userContentEdits(last: 2) {
          totalCount
          nodes {
            diff
          }
        }
      }
    }
  }
`;

const UPDATE_PULL_REQUEST_MUTATION = `
  mutation($pullRequestId: ID!, $body: String!) {
    updatePullRequest(input: {pullRequestId: $pullRequestId, body: $body}) {
      pullRequest {
        id
        headRefOid
        body
        userContentEdits(last: 2) {
          totalCount
          nodes {
            diff
          }
        }
      }
    }
  }
`;

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

function parsePullRequestData(output, description, select) {
  const pullRequestData = select(parseJson(output, description));
  if (
    typeof pullRequestData?.id !== "string"
    || typeof pullRequestData.headRefOid !== "string"
    || typeof pullRequestData.body !== "string"
    || !Number.isInteger(pullRequestData.userContentEdits?.totalCount)
    || !Array.isArray(pullRequestData.userContentEdits.nodes)
    || pullRequestData.userContentEdits.nodes.some((edit) => typeof edit?.diff !== "string")
  ) {
    throw new BlockedError(`${description} has no readable linkage evidence`);
  }
  return {
    id: pullRequestData.id,
    headRefOid: pullRequestData.headRefOid,
    body: pullRequestData.body,
    editCount: pullRequestData.userContentEdits.totalCount,
    editBodies: pullRequestData.userContentEdits.nodes.map((edit) => edit.diff),
  };
}

function pullRequestEvidence({ cwd, repo, pullRequest, run }) {
  const [owner, name] = repo.split("/");
  const output = checked("gh", [
    "api", "graphql",
    "-f", `query=${PULL_REQUEST_QUERY}`,
    "-f", `owner=${owner}`,
    "-f", `name=${name}`,
    "-F", `number=${pullRequest}`,
  ], { cwd, run });
  return parsePullRequestData(
    output,
    `PR #${pullRequest}`,
    (response) => response.data?.repository?.pullRequest,
  );
}

function updatePullRequestBody(body, original, { cwd, pullRequest, run }) {
  const output = checked("gh", [
    "api", "graphql",
    "-f", `query=${UPDATE_PULL_REQUEST_MUTATION}`,
    "-f", `pullRequestId=${original.id}`,
    "-f", `body=${body}`,
  ], { cwd, run });
  return parsePullRequestData(
    output,
    `PR #${pullRequest} update`,
    (response) => response.data?.updatePullRequest?.pullRequest,
  );
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

function restoreConcurrentBody(written, updatedBody, confirmed, options) {
  const concurrentBody = written.editBodies.find(
    (body) => body !== updatedBody && body !== confirmed.body,
  );
  if (concurrentBody === undefined) {
    throw new BlockedError(`PR #${options.pullRequest} body changed during linkage update`);
  }

  const restoredBody = appendClosingMarker(concurrentBody, options.issue);
  const restored = updatePullRequestBody(restoredBody, written, options);
  assertExpectedHead(restored, options);
  if (
    restored.editCount !== written.editCount + 1
    || restored.body !== restoredBody
    || !hasClosingMarker(restored.body, options.issue)
  ) {
    throw new BlockedError(`PR #${options.pullRequest} concurrent body could not be preserved`);
  }

  const preserved = pullRequestEvidence(options);
  assertExpectedHead(preserved, options);
  if (
    preserved.editCount !== restored.editCount
    || preserved.body !== restoredBody
    || !hasClosingMarker(preserved.body, options.issue)
  ) {
    throw new BlockedError(`PR #${options.pullRequest} concurrent body could not be preserved`);
  }
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
  if (
    confirmed.body !== original.body
    || confirmed.editCount !== original.editCount
  ) {
    throw new BlockedError(`PR #${pullRequest} body changed while linkage was being verified`);
  }
  const updatedBody = appendClosingMarker(confirmed.body, issue);
  const written = updatePullRequestBody(updatedBody, confirmed, options);
  assertExpectedHead(written, options);
  if (written.editCount !== confirmed.editCount + 1) {
    restoreConcurrentBody(written, updatedBody, confirmed, options);
    throw new BlockedError(`PR #${pullRequest} body changed during linkage update`);
  }
  if (written.body !== updatedBody || !hasClosingMarker(written.body, issue)) {
    throw new BlockedError(`PR #${pullRequest} linkage update returned unexpected evidence`);
  }

  const updated = pullRequestEvidence(options);
  assertExpectedHead(updated, options);
  if (
    updated.editCount !== written.editCount
    || updated.body !== updatedBody
    || !hasClosingMarker(updated.body, issue)
  ) {
    throw new BlockedError(`PR #${pullRequest} linkage was not preserved after update`);
  }
  return true;
}
