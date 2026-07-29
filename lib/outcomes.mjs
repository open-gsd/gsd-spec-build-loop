import { BlockedError, UsageError } from "./errors.mjs";
import { checked, parseJson, runProcess } from "./process.mjs";

const OUTCOME_LINE = /^(\s*-\s+\[)([ xX])(\]\s+)(O-\d+)\b(.*)$/;
const BARE_OUTCOME_ENTRY = /^(O-[^\s—:]+)/;
const LIST_OUTCOME_ENTRY =
  /^\s*(?:[-+*]|\d{1,9}[.)])\s+(?:\[[^\]]*\]\s+)?(O-[^\s—:]+)/;
const INDENTED_OUTCOME_ENTRY = /^\s+(O-[^\s—:]+)\s*(?:—|:)/;
const INDENTED_OUTCOME_REFERENCE = /^\s+(O-[^\s—:]+)/;

function markdownColumns(value) {
  let column = 0;
  for (const character of value) {
    if (character === "\t") {
      column += 4 - (column % 4);
    } else {
      column += 1;
    }
  }
  return column;
}

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
  const sections = lines
    .map((line, index) => (/^## Outcomes\s*$/.test(line) ? index : -1))
    .filter((index) => index !== -1);
  if (!sections.length) {
    throw new BlockedError("issue contract has no Outcomes section");
  }
  if (sections.length > 1) {
    throw new BlockedError("issue contract has multiple Outcomes sections");
  }
  const [sectionStart] = sections;
  const nextSection = lines.findIndex((line, index) => index > sectionStart && /^##\s+/.test(line));
  const sectionEnd = nextSection === -1 ? lines.length : nextSection;
  const seen = new Set();
  let count = 0;
  let outcomeContinuationColumn = null;
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    const line = lines[index];
    const match = line.match(OUTCOME_LINE);
    if (!match) {
      const indentation = line.match(/^\s*/)[0];
      const isOutcomeContinuation =
        outcomeContinuationColumn !== null &&
        markdownColumns(indentation) >= outcomeContinuationColumn;
      const malformed =
        line.match(BARE_OUTCOME_ENTRY) ??
        line.match(LIST_OUTCOME_ENTRY) ??
        line.match(INDENTED_OUTCOME_ENTRY) ??
        (!isOutcomeContinuation ? line.match(INDENTED_OUTCOME_REFERENCE) : null);
      const checklist = /^\s*(?:[-+*]|\d{1,9}[.)])\s+\[[^\]]*\]/.test(line);
      if (malformed || checklist) {
        const detail = malformed ? ` ${malformed[1]}` : " checklist entry";
        throw new BlockedError(`issue contract has malformed outcome${detail}`);
      }
      if (line.trim() && !isOutcomeContinuation) {
        outcomeContinuationColumn = null;
      }
      continue;
    }
    const [, prefix, , suffix, outcome, description] = match;
    if (!/^\s+—\s+\S/.test(description)) {
      throw new BlockedError(`issue contract outcome ${outcome} has no description`);
    }
    if (seen.has(outcome)) {
      throw new BlockedError(`issue contract has duplicate outcome ${outcome}`);
    }
    seen.add(outcome);
    count += 1;
    outcomeContinuationColumn = markdownColumns(prefix.slice(0, -1));
    const marker = state === "complete" ? "x" : " ";
    lines[index] = `${prefix}${marker}${suffix}${outcome}${description}`;
  }
  if (!count) {
    throw new BlockedError("issue contract Outcomes section has no O-N checkboxes");
  }
  return lines.join("\n");
}

function pullRequestEvidence({ cwd, repo, pullRequest, run }) {
  const output = checked("gh", [
    "pr", "view", String(pullRequest),
    "--repo", repo,
    "--json", "headRefOid,body,closingIssuesReferences",
  ], { cwd, run });
  return parseJson(output, `PR #${pullRequest}`);
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

function fallbackClosingIssues(body) {
  const matches = body.matchAll(/^\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gim);
  return new Set([...matches].map((match) => Number(match[1])));
}

function repositoryNameWithOwner(repository) {
  if (typeof repository?.nameWithOwner === "string") {
    return repository.nameWithOwner;
  }
  if (typeof repository?.name !== "string" || typeof repository.owner?.login !== "string") {
    return null;
  }
  return `${repository.owner.login}/${repository.name}`;
}

function assertExpectedPullRequest(options) {
  const pullRequest = pullRequestEvidence(options);
  if (pullRequest.headRefOid !== options.expectedHead) {
    throw new BlockedError(`PR #${options.pullRequest} head changed; outcome evidence is stale`);
  }
  const references = pullRequest.closingIssuesReferences ?? [];
  const linkedIssues = new Set(references
    .filter(({ repository }) => (
      repositoryNameWithOwner(repository)?.toLowerCase() === options.repo.toLowerCase()
    ))
    .map(({ number }) => number));
  if (!references.length) {
    for (const issue of fallbackClosingIssues(pullRequest.body ?? "")) {
      linkedIssues.add(issue);
    }
  }
  if (!linkedIssues.has(options.issue)) {
    throw new BlockedError(`issue #${options.issue} is not linked to PR #${options.pullRequest}`);
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
  assertExpectedPullRequest(options);
  const original = issueBody(options);
  const updated = transformOutcomeChecklist(original, state);
  if (updated === original) {
    assertExpectedPullRequest(options);
    if (issueBody(options) !== original) {
      throw new BlockedError(`issue #${issue} changed while outcomes were being verified`);
    }
    return false;
  }

  assertExpectedPullRequest(options);
  if (issueBody(options) !== original) {
    throw new BlockedError(`issue #${issue} changed while outcomes were being synchronized`);
  }
  checked("gh", [
    "issue", "edit", String(issue),
    "--repo", repo,
    "--body-file", "-",
  ], { cwd, run, input: updated });
  if (issueBody(options) !== updated) {
    throw new BlockedError(`issue #${issue} changed immediately after outcome synchronization`);
  }
  assertExpectedPullRequest(options);
  return true;
}
