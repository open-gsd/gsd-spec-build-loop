import { BlockedError, UsageError } from "./errors.mjs";
import { checked, parseJson, runProcess } from "./process.mjs";

const OUTCOME_LINE = /^(\s*-\s+\[)([ xX])(\]\s+)(O-\d+)\b(.*)$/;

export function parseOutcomeArguments(values) {
  const [issueValue, state, ...options] = values;
  const parsed = {
    issue: Number(issueValue),
    state,
    repo: null,
    pullRequest: null,
    expectedHead: null,
  };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = options[index + 1];
    if (!["--repo", "--pr", "--head"].includes(option) || !value || value.startsWith("--")) {
      throw new UsageError(`invalid outcomes option: ${option ?? ""}`.trim());
    }
    if (option === "--repo") parsed.repo = value;
    if (option === "--pr") parsed.pullRequest = Number(value);
    if (option === "--head") parsed.expectedHead = value;
    index += 1;
  }
  if (!Number.isInteger(parsed.issue) || parsed.issue < 1) {
    throw new UsageError("outcomes requires a positive issue number");
  }
  if (!["complete", "pending"].includes(parsed.state)) {
    throw new UsageError("outcomes state must be complete or pending");
  }
  if (!parsed.repo || !/^[^/]+\/[^/]+$/.test(parsed.repo)) {
    throw new UsageError("outcomes requires --repo OWNER/NAME");
  }
  if (!Number.isInteger(parsed.pullRequest) || parsed.pullRequest < 1) {
    throw new UsageError("outcomes requires --pr NUMBER");
  }
  if (!parsed.expectedHead || !/^[0-9a-f]{7,40}$/i.test(parsed.expectedHead)) {
    throw new UsageError("outcomes requires --head COMMIT_SHA");
  }
  return parsed;
}

export function transformOutcomeChecklist(body, state) {
  if (!["complete", "pending"].includes(state)) {
    throw new UsageError("outcome state must be complete or pending");
  }
  const lines = body.split("\n");
  const sectionStart = lines.findIndex((line) => /^## Outcomes\s*$/.test(line));
  if (sectionStart === -1) {
    throw new BlockedError("issue contract has no Outcomes section");
  }
  const nextSection = lines.findIndex((line, index) => index > sectionStart && /^##\s+/.test(line));
  const sectionEnd = nextSection === -1 ? lines.length : nextSection;
  const seen = new Set();
  let count = 0;
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    const match = lines[index].match(OUTCOME_LINE);
    if (!match) {
      const malformed = lines[index].match(/^\s*-\s+.*\b(O-\d+)\b/);
      if (malformed) {
        throw new BlockedError(`issue contract has malformed outcome ${malformed[1]}`);
      }
      continue;
    }
    const [, prefix, , suffix, outcome, description] = match;
    if (seen.has(outcome)) {
      throw new BlockedError(`issue contract has duplicate outcome ${outcome}`);
    }
    seen.add(outcome);
    count += 1;
    const marker = state === "complete" ? "x" : " ";
    lines[index] = `${prefix}${marker}${suffix}${outcome}${description}`;
  }
  if (!count) {
    throw new BlockedError("issue contract Outcomes section has no O-N checkboxes");
  }
  return lines.join("\n");
}

function pullRequestHead({ cwd, repo, pullRequest, run }) {
  return checked("gh", [
    "pr", "view", String(pullRequest),
    "--repo", repo,
    "--json", "headRefOid",
    "--jq", ".headRefOid",
  ], { cwd, run });
}

function issueBody({ cwd, repo, issue, run }) {
  const output = checked("gh", [
    "issue", "view", String(issue),
    "--repo", repo,
    "--json", "body",
  ], { cwd, run });
  const result = parseJson(output, `issue #${issue}`);
  if (typeof result.body !== "string") {
    throw new BlockedError(`issue #${issue} has no readable body`);
  }
  return result.body;
}

function assertExpectedHead(options) {
  if (pullRequestHead(options) !== options.expectedHead) {
    throw new BlockedError(`PR #${options.pullRequest} head changed; outcome evidence is stale`);
  }
}

export function syncIssueOutcomes({
  cwd,
  repo,
  issue,
  pullRequest,
  expectedHead,
  state,
  run = runProcess,
}) {
  const options = { cwd, repo, issue, pullRequest, expectedHead, run };
  assertExpectedHead(options);
  const original = issueBody(options);
  const updated = transformOutcomeChecklist(original, state);
  if (updated === original) return false;

  assertExpectedHead(options);
  if (issueBody(options) !== original) {
    throw new BlockedError(`issue #${issue} changed while outcomes were being synchronized`);
  }
  checked("gh", [
    "issue", "edit", String(issue),
    "--repo", repo,
    "--body-file", "-",
  ], { cwd, run, input: updated });
  return true;
}
