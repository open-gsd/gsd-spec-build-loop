import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { BlockedError, CliError, UsageError } from "./errors.mjs";
import { parseDiscoverySections, validateDiscoveryMap } from "./discovery-map.mjs";
import { checked, parseJson, runProcess } from "./process.mjs";

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function filingLockName(map) {
  return `gsd-loop-spec-map-${map}`;
}

function filingLockDescription(token) {
  return `Active gsd-loop spec filing reservation ${token}`;
}

function commandResult(run, argumentsList, options) {
  return run("gh", argumentsList, options);
}

function lockEvidence({ cwd, repo, map, run }) {
  const result = commandResult(run, [
    "label", "view", filingLockName(map), "--repo", repo, "--json", "description",
  ], { cwd });
  if (result.status !== 0) return null;
  return parseJson(result.stdout, "filing reservation").description;
}

function assertFilingLock(options) {
  if (lockEvidence(options) !== filingLockDescription(options.token)) {
    throw new BlockedError(`filing reservation ${filingLockName(options.map)} is not owned by this pass`);
  }
}

export function acquireFilingLock({ cwd, repo, map, token = randomUUID(), run = runProcess }) {
  const label = filingLockName(map);
  const created = commandResult(run, [
    "label", "create", label, "--repo", repo, "--color", "ededed",
    "--description", filingLockDescription(token),
  ], { cwd });
  if (created.status === 0) return { label, token };
  if (lockEvidence({ cwd, repo, map, run }) !== null) {
    throw new BlockedError(`filing reservation ${label} is already active`);
  }
  const detail = created.stderr.trim() || created.stdout.trim() || `exit ${created.status}`;
  throw new CliError(`could not acquire filing reservation: ${detail}`);
}

export function releaseFilingLock({ cwd, repo, map, token, run = runProcess }) {
  assertFilingLock({ cwd, repo, map, token, run });
  checked("gh", ["label", "delete", filingLockName(map), "--repo", repo, "--yes"], { cwd, run });
}

function flattenPages(output, description) {
  const pages = parseJson(output, description);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new CliError(`${description} must contain paginated JSON arrays`);
  }
  return pages.flat();
}

function repositoryIssues(options) {
  return flattenPages(checked("gh", [
    "api", "--paginate", "--slurp",
    "-H", "X-GitHub-Api-Version: 2026-03-10",
    `repos/${options.repo}/issues?state=all&per_page=100`,
  ], options), "repository issues").filter((issue) => !issue.pull_request);
}

function subIssues(options) {
  return flattenPages(checked("gh", [
    "api", "--paginate", "--slurp",
    "-H", "X-GitHub-Api-Version: 2026-03-10",
    `repos/${options.repo}/issues/${options.map}/sub_issues?per_page=100`,
  ], options), "map sub-issues");
}

function blockedBy(options, issue) {
  return flattenPages(checked("gh", [
    "api", "--paginate", "--slurp",
    "-H", "X-GitHub-Api-Version: 2026-03-10",
    `repos/${options.repo}/issues/${issue}/dependencies/blocked_by?per_page=100`,
  ], options), `decision #${issue} blockers`);
}

function mapIssue(options) {
  return parseJson(checked("gh", [
    "issue", "view", String(options.map), "--repo", options.repo,
    "--json", "body,state,labels",
  ], options), "map issue");
}

function parseDecisionIssue(body, map) {
  const match = body?.match(
    /^## Map\r?\n\r?\n#([1-9]\d*)\r?\n\r?\n## Decision ID\r?\n\r?\n(D-[1-9]\d*)\r?\n\r?\n## Type\r?\n\r?\n(Discussion|Research|Prototype|Prerequisite)\r?\n\r?\n## Question\r?\n\r?\n([^\r\n]+)\s*$/,
  );
  if (!match || Number(match[1]) !== map) return null;
  return { id: match[2], type: match[3], question: match[4] };
}

function manifestById(body) {
  return new Map(validateDiscoveryMap(body, { allowNotReady: true }).decisions.map((item) => [item.id, item]));
}

function replaceSection(body, name, value) {
  const expression = new RegExp(`((?:^|\\r?\\n)## ${name}\\r?\\n\\r?\\n)[\\s\\S]*?(?=\\r?\\n\\r?\\n## |$)`);
  return body.replace(expression, (_, heading) => `${heading}${value}`);
}

function renderDecisionFrontier(decisions) {
  if (!decisions.length) return "None.";
  return decisions.map((decision) => `### ${decision.id} — ${decision.title}

Type: ${decision.type}
Question: ${decision.question}
Needs: ${decision.needs.length ? decision.needs.join(", ") : "None."}
Issue: ${decision.issue ? `#${decision.issue}` : "Pending."}`).join("\n\n");
}

function updateMapBody(body, map, options) {
  checked("gh", ["issue", "edit", String(map), "--repo", options.repo, "--body-file", "-"], {
    ...options,
    input: body,
  });
}

export function reconcileDecisionIssues({ cwd, repo, map, run = runProcess }) {
  const options = { cwd, repo, map, run };
  const currentMap = mapIssue(options);
  const decisions = [...manifestById(currentMap.body).values()];
  const candidates = new Map();
  for (const issue of repositoryIssues(options)) {
    const parsed = parseDecisionIssue(issue.body, map);
    if (!parsed) continue;
    if (candidates.has(parsed.id)) throw new BlockedError(`multiple issues claim ${parsed.id}`);
    candidates.set(parsed.id, { issue, parsed });
  }
  for (const id of candidates.keys()) {
    if (!decisions.some((decision) => decision.id === id)) {
      throw new BlockedError(`${id} is absent from the frontier manifest`);
    }
  }
  const attached = new Set(subIssues(options).map((issue) => issue.number));
  const newlyAttached = [];
  for (const decision of decisions) {
    const candidate = candidates.get(decision.id);
    if (!candidate) {
      if (decision.issue) throw new BlockedError(`${decision.id} references missing issue #${decision.issue}`);
      continue;
    }
    if (
      candidate.parsed.type !== decision.type
      || candidate.parsed.question !== decision.question
      || (decision.issue && decision.issue !== candidate.issue.number)
    ) {
      throw new BlockedError(`${decision.id} conflicts with its frontier manifest`);
    }
    if (!attached.has(candidate.issue.number)) {
      checked("gh", [
        "api", "--method", "POST",
        `repos/${repo}/issues/${map}/sub_issues`,
        "-F", `sub_issue_id=${candidate.issue.id}`,
      ], options);
      newlyAttached.push(candidate.issue.number);
    }
    decision.issue = candidate.issue.number;
  }
  const dependencies = [];
  for (const decision of decisions.filter((item) => item.issue)) {
    const currentBlockers = new Set(blockedBy(options, decision.issue).map((issue) => issue.number));
    for (const neededId of decision.needs) {
      const blocker = candidates.get(neededId)?.issue;
      if (!blocker) continue;
      if (!currentBlockers.has(blocker.number)) {
        checked("gh", [
          "api", "--method", "POST",
          `repos/${repo}/issues/${decision.issue}/dependencies/blocked_by`,
          "-F", `issue_id=${blocker.id}`,
        ], options);
        dependencies.push({ blocked: decision.issue, blocker: blocker.number });
      }
    }
  }
  const updatedBody = replaceSection(currentMap.body, "Decision frontier", renderDecisionFrontier(decisions));
  if (updatedBody !== currentMap.body) updateMapBody(updatedBody, map, options);
  const verified = new Set(subIssues(options).map((issue) => issue.number));
  if (newlyAttached.some((number) => !verified.has(number))) {
    throw new BlockedError("decision reconciliation did not preserve native attachments");
  }
  for (const decision of decisions.filter((item) => item.issue)) {
    const expected = decision.needs.map((id) => candidates.get(id)?.issue.number);
    if (expected.some((number) => number === undefined)) continue;
    const actual = blockedBy(options, decision.issue).map((issue) => issue.number);
    expected.sort((a, b) => a - b);
    actual.sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new BlockedError(`${decision.id} native dependencies conflict with its frontier manifest`);
    }
  }
  const verifiedManifest = manifestById(mapIssue(options).body);
  if (decisions.some((decision) => verifiedManifest.get(decision.id)?.issue !== decision.issue)) {
    throw new BlockedError("decision reconciliation did not preserve the frontier manifest");
  }
  return {
    attached: newlyAttached,
    dependencies,
    missing: decisions.filter((decision) => !decision.issue).map((decision) => decision.id),
  };
}

function escapeExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapGist(comment, map, child) {
  if (comment.body?.split(/\r?\n/, 1)[0] !== `gsd-loop decision for map #${map}`) return null;
  if (!TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
    throw new BlockedError(`decision evidence by @${comment.user?.login ?? "unknown"} is not trusted`);
  }
  const matches = [...comment.body.matchAll(/^## Map gist\r?\n\r?\n([^\r\n]+)$/gm)];
  const expected = new RegExp(
    `^- \\[${escapeExpression(child.title)}\\]\\(https:\\/\\/[^)]+\\/issues\\/${child.number}\\) — .+`,
  );
  if (matches.length !== 1 || !expected.test(matches[0][1])) {
    throw new BlockedError("decision evidence has an invalid map gist");
  }
  return matches[0][1];
}

export function validateDecisionEvidence({ cwd, repo, map, run = runProcess }) {
  const options = { cwd, repo, map, run };
  const currentMap = mapIssue(options);
  const decisions = new Map(validateDiscoveryMap(currentMap.body).decisions.map((item) => [item.id, item]));
  const decisionsByIssue = new Map([...decisions.values()].map((decision) => [decision.issue, decision]));
  const children = subIssues(options);
  const referenced = repositoryIssues(options)
    .map((issue) => ({ issue, decision: parseDecisionIssue(issue.body, map) }))
    .filter(({ decision }) => decision);
  for (const reference of referenced) {
    const decision = decisions.get(reference.decision.id);
    if (
      !decision
      || decision.issue !== reference.issue.number
      || decision.type !== reference.decision.type
      || decision.question !== reference.decision.question
    ) {
      throw new BlockedError(`${reference.decision.id} conflicts with the frontier manifest`);
    }
  }
  if (referenced.some(({ issue }) => !children.some((child) => child.number === issue.number))) {
    throw new BlockedError("a referenced decision is not attached to the map");
  }
  for (const child of children) {
    if (!referenced.some(({ issue }) => issue.number === child.number)) {
      throw new BlockedError(`decision #${child.number} has no matching durable reference`);
    }
    if (child.state !== "closed") throw new BlockedError(`decision #${child.number} is still open`);
    const comments = flattenPages(checked("gh", [
      "api", "--paginate", "--slurp",
      "-H", "X-GitHub-Api-Version: 2026-03-10",
      `repos/${repo}/issues/${child.number}/comments?per_page=100`,
    ], options), `decision #${child.number} comments`);
    const evidence = comments.map((comment) => mapGist(comment, map, child)).filter(Boolean);
    if (evidence.length !== 1) throw new BlockedError(`decision #${child.number} needs exactly one trusted resolution`);
    if (!parseDiscoverySections(currentMap.body)["Decisions so far"].split(/\r?\n/).includes(evidence[0])) {
      throw new BlockedError(`decision #${child.number} map gist is missing`);
    }
    const decision = decisionsByIssue.get(child.number);
    if (!decision) {
      throw new BlockedError(`decision #${child.number} is absent from the frontier manifest`);
    }
    const expectedBlockers = decision.needs.map((id) => decisions.get(id).issue).sort((a, b) => a - b);
    const actualBlockers = blockedBy(options, child.number).map((issue) => issue.number).sort((a, b) => a - b);
    if (JSON.stringify(actualBlockers) !== JSON.stringify(expectedBlockers)) {
      throw new BlockedError(`decision #${child.number} blockers conflict with the frontier manifest`);
    }
  }
  if ([...decisionsByIssue.keys()].some((issue) => !children.some((child) => child.number === issue))) {
    throw new BlockedError("frontier manifest references a missing native decision");
  }
  return children.length;
}

function sliceMarkers(body) {
  const mapMatches = [...body.matchAll(/^Discovery map: #([1-9]\d*)$/gm)];
  const sliceMatches = [...body.matchAll(/^Discovery slice: (S-[1-9]\d*)$/gm)];
  if (mapMatches.length !== 1 || sliceMatches.length !== 1) return null;
  return { map: Number(mapMatches[0][1]), slice: sliceMatches[0][1] };
}

function appendQueueIssue(body, slice, issue) {
  const sections = parseDiscoverySections(body);
  const entry = `- ${slice} — [${issue.title}](${issue.html_url})`;
  const queue = sections["Queue issues"] === "None." ? entry : `${sections["Queue issues"]}\n${entry}`;
  return replaceSection(body, "Queue issues", queue);
}

export function fileDiscoverySlice({ cwd, repo, map, token, slice, title, bodyPath, run = runProcess }) {
  const options = { cwd, repo, map, token, run };
  assertFilingLock(options);
  const draft = readFileSync(bodyPath, "utf8");
  const markers = sliceMarkers(draft);
  if (!markers || markers.map !== map || markers.slice !== slice) {
    throw new UsageError("slice draft markers do not match MAP and S-N");
  }
  let currentMap = mapIssue(options);
  let parsed = validateDiscoveryMap(currentMap.body);
  const declared = parsed.slices.find((entry) => entry.id === slice);
  if (!declared || declared.title !== title) {
    throw new BlockedError(`${slice} does not match the discovery map`);
  }
  const sliceIndex = parsed.slices.findIndex((entry) => entry.id === slice);
  const earlierSlices = parsed.slices.slice(0, sliceIndex);
  if (earlierSlices.some((entry) => !parsed.queueIssues.some((filed) => filed.id === entry.id))) {
    throw new BlockedError(`${slice} cannot be filed before every earlier slice`);
  }
  const findMatches = () => repositoryIssues(options).filter((issue) => {
    const found = sliceMarkers(issue.body ?? "");
    return found?.map === map && found.slice === slice;
  });
  let matches = findMatches();
  if (matches.length > 1) throw new BlockedError(`multiple issues claim ${slice}`);
  if (!matches.length) {
    commandResult(run, [
      "issue", "create", "--repo", repo, "--title", title, "--body-file", bodyPath,
    ], { cwd });
    matches = findMatches();
  }
  if (matches.length !== 1) throw new BlockedError(`slice ${slice} creation could not be reconciled`);
  const issue = matches[0];
  if (issue.title !== title || issue.body !== draft) throw new BlockedError(`${slice} issue conflicts with its approved draft`);
  currentMap = mapIssue(options);
  parsed = validateDiscoveryMap(currentMap.body);
  const existing = parsed.queueIssues.find((entry) => entry.id === slice);
  if (existing && existing.issue !== issue.number) throw new BlockedError(`${slice} queue entry conflicts with issue #${issue.number}`);
  if (!existing) updateMapBody(appendQueueIssue(currentMap.body, slice, issue), map, options);
  const verified = validateDiscoveryMap(mapIssue(options).body, { allowNotReady: true });
  if (!verified.queueIssues.some((entry) => entry.id === slice && entry.issue === issue.number)) {
    throw new BlockedError(`${slice} queue entry was not preserved`);
  }
  return issue;
}

export function parseDiscoveryProtocolArguments(values) {
  const [command, mapValue, ...argumentsList] = values;
  const parsed = {
    command,
    map: Number(mapValue),
    repo: null,
    token: null,
    slice: null,
    title: null,
    bodyPath: null,
  };
  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!value) throw new UsageError(`${option ?? "option"} requires a value`);
    if (option === "--repo") parsed.repo = value;
    else if (option === "--token") parsed.token = value;
    else if (option === "--slice") parsed.slice = value;
    else if (option === "--title") parsed.title = value;
    else if (option === "--body-file") parsed.bodyPath = value;
    else throw new UsageError(`unknown option: ${option}`);
  }
  if (!Number.isInteger(parsed.map) || parsed.map < 1 || !/^[^/]+\/[^/]+$/.test(parsed.repo ?? "")) {
    throw new UsageError("usage: COMMAND MAP --repo OWNER/REPO");
  }
  return parsed;
}

export function runDiscoveryProtocol(parsed, { cwd = process.cwd(), run = runProcess } = {}) {
  const common = { cwd, repo: parsed.repo, map: parsed.map, run };
  if (parsed.command === "lock") return acquireFilingLock(common);
  if (parsed.command === "unlock") {
    if (!parsed.token) throw new UsageError("unlock requires --token");
    releaseFilingLock({ ...common, token: parsed.token });
    return { released: filingLockName(parsed.map) };
  }
  if (parsed.command === "reconcile") return reconcileDecisionIssues(common);
  if (parsed.command === "validate") return { decisions: validateDecisionEvidence(common) };
  if (parsed.command === "file-slice") {
    if (!parsed.token || !parsed.slice || !parsed.title || !parsed.bodyPath) {
      throw new UsageError("file-slice requires --token, --slice, --title, and --body-file");
    }
    const issue = fileDiscoverySlice({ ...common, ...parsed });
    return { number: issue.number, title: issue.title, url: issue.html_url };
  }
  throw new UsageError(`unknown command: ${parsed.command ?? ""}`);
}
