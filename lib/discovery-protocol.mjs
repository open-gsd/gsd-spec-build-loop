import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BlockedError, CliError, UsageError } from "./errors.mjs";
import { parseDiscoverySections, validateDiscoveryMap } from "./discovery-map.mjs";
import { checked, parseJson, runProcess } from "./process.mjs";

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function commandResult(run, argumentsList, options) {
  return run("gh", argumentsList, options);
}

function labelNames(labels) {
  return (labels ?? []).map((label) => typeof label === "string" ? label : label.name);
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

function issueComments(options, issue, description) {
  return flattenPages(checked("gh", [
    "api", "--paginate", "--slurp",
    "-H", "X-GitHub-Api-Version: 2026-03-10",
    `repos/${options.repo}/issues/${issue}/comments?per_page=100`,
  ], options), description);
}

function mapIssue(options, { allowClosed = false } = {}) {
  const issue = parseJson(checked("gh", [
    "issue", "view", String(options.map), "--repo", options.repo,
    "--json", "body,state,labels",
  ], options), "map issue");
  const state = String(issue.state).toLowerCase();
  if (state !== "open" && !(allowClosed && state === "closed")) {
    throw new BlockedError(`discovery map #${options.map} must be open`);
  }
  if (!labelNames(issue.labels).includes("gsd:map")) {
    throw new BlockedError(`discovery map #${options.map} must carry gsd:map`);
  }
  return issue;
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
      candidate.issue.title !== decision.title
      || candidate.parsed.type !== decision.type
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

function resolutionEvent(comment, map, child) {
  const marker = `gsd-loop decision for map #${map}`;
  if (comment.body?.split(/\r?\n/, 1)[0] !== marker) return null;
  if (!TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
    throw new BlockedError(`decision evidence by @${comment.user?.login ?? "unknown"} is not trusted`);
  }
  const headings = [...comment.body.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  const names = headings.map((heading) => heading[1]);
  if (
    comment.body.slice(0, headings[0]?.index).trim() !== marker
    || JSON.stringify(names) !== JSON.stringify(["Resolution", "Evidence", "Consequences", "Map gist"])
  ) {
    throw new BlockedError("decision evidence must contain Resolution, Evidence, Consequences, and Map gist");
  }
  const sections = headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? comment.body.length;
    return comment.body.slice(start, end).trim();
  });
  if (sections.some((section) => !section)) {
    throw new BlockedError("decision evidence sections must not be empty");
  }
  const gist = sections[3];
  const expected = new RegExp(
    `^- \\[${escapeExpression(child.title)}\\]\\(${escapeExpression(child.html_url)}\\) — .+$`,
  );
  if (gist.includes("\n") || !expected.test(gist)) {
    throw new BlockedError("decision evidence has an invalid map gist");
  }
  return { body: comment.body, gist };
}

function decisionEvidence(options, mapBody, currentMap = mapIssue(options)) {
  const { map } = options;
  const validatedBody = mapBody ?? currentMap.body;
  const decisions = new Map(validateDiscoveryMap(validatedBody).decisions.map((item) => [item.id, item]));
  const decisionsByIssue = new Map([...decisions.values()].map((decision) => [decision.issue, decision]));
  const resolved = [];
  const children = subIssues(options);
  const referenced = repositoryIssues(options)
    .map((issue) => ({ issue, decision: parseDecisionIssue(issue.body, map) }))
    .filter(({ decision }) => decision);
  for (const reference of referenced) {
    const decision = decisions.get(reference.decision.id);
    if (
      !decision
      || decision.issue !== reference.issue.number
      || decision.title !== reference.issue.title
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
    const comments = issueComments(options, child.number, `decision #${child.number} comments`);
    const evidence = comments.map((comment) => resolutionEvent(comment, map, child)).filter(Boolean);
    if (evidence.length !== 1) throw new BlockedError(`decision #${child.number} needs exactly one trusted resolution`);
    if (!parseDiscoverySections(validatedBody)["Decisions so far"].split(/\r?\n/).includes(evidence[0].gist)) {
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
    resolved.push({ body: evidence[0].body, id: decision.id, issue: child.number });
  }
  if ([...decisionsByIssue.keys()].some((issue) => !children.some((child) => child.number === issue))) {
    throw new BlockedError("frontier manifest references a missing native decision");
  }
  resolved.sort((first, second) => first.id.localeCompare(second.id));
  return { count: children.length, resolved };
}

export function validateDecisionEvidence({ cwd, repo, map, mapBody, run = runProcess }) {
  const options = { cwd, repo, map, run };
  return decisionEvidence(options, mapBody).count;
}

export function graduateDiscoveryMap({ cwd, repo, map, mapBody, run = runProcess }) {
  const options = { cwd, repo, map, run };
  const currentMap = mapIssue(options);
  const current = validateDiscoveryMap(currentMap.body, { allowNotReady: true });
  const proposed = validateDiscoveryMap(mapBody);
  const issues = repositoryIssues(options);
  const currentGraduation = parseDiscoverySections(currentMap.body).Graduation;
  if (currentGraduation === "Ready for `gsd-loop-spec`.") {
    const evidence = decisionEvidence(options, undefined, currentMap);
    const filingMap = withPlanIdentity(current, currentMap.body, evidence.resolved);
    assertGraduationIdentity(options, filingMap.planIdentity);
    assertFrozenPlanIdentity(filingMap, issues, map);
    if (currentMap.body !== mapBody) {
      throw new BlockedError(
        "ready discovery map is frozen; graduate accepts only the exact current body",
      );
    }
    return { decisions: evidence.count, slices: current.slices.length };
  }
  if (
    currentGraduation === "Not ready."
    && (current.queueIssues.length || hasFiledSliceIssue(issues, map))
  ) {
    throw new BlockedError(
      "slice filing has started; this map's delivery plan, slice IDs and order, destination, decisions, and scope are immutable. Create a new discovery map for later scope or route changes; do not mutate or cancel filed contracts",
    );
  }
  if (
    currentGraduation === "Not ready."
    && proposed.queueIssues.length
  ) {
    throw new BlockedError("Queue issues must be None. when the map graduates");
  }
  const evidence = decisionEvidence(options, mapBody, currentMap);
  const proposedIdentity = discoveryPlanIdentity(mapBody, evidence.resolved);
  recordGraduationIdentity(options, proposedIdentity);
  if (currentMap.body !== mapBody) updateMapBody(mapBody, map, options);
  const verifiedMap = mapIssue(options);
  if (verifiedMap.body !== mapBody) {
    throw new BlockedError("graduation did not preserve the approved map body");
  }
  const verifiedEvidence = decisionEvidence(options, undefined, verifiedMap);
  const verifiedIdentity = discoveryPlanIdentity(verifiedMap.body, verifiedEvidence.resolved);
  if (verifiedIdentity !== proposedIdentity) {
    throw new BlockedError("graduation did not preserve the approved discovery evidence");
  }
  assertGraduationIdentity(options, verifiedIdentity);
  return { decisions: evidence.count, slices: proposed.slices.length };
}

function sliceMarkers(body) {
  const mapMatches = [...body.matchAll(/^Discovery map: #([1-9]\d*)\r?$/gm)];
  const sliceMatches = [...body.matchAll(/^Discovery slice: (S-[1-9]\d*)\r?$/gm)];
  if (mapMatches.length !== 1 || sliceMatches.length !== 1) return null;
  return { map: Number(mapMatches[0][1]), slice: sliceMatches[0][1] };
}

function hasFiledSliceIssue(issues, map) {
  return issues.some((issue) => sliceMarkers(issue.body ?? "")?.map === map);
}

function sliceDependencies(body) {
  const dependencyValues = [...body.matchAll(/^Needs ([^\r\n]+)\r?$/gm)].map((match) => match[1]);
  if (dependencyValues.some((value) => !/^#[1-9]\d* merged$/.test(value))) {
    throw new BlockedError("slice draft contains a malformed Needs dependency");
  }
  const matches = dependencyValues.map((value) => Number(value.match(/^#([1-9]\d*) merged$/)[1]));
  if (new Set(matches).size !== matches.length) {
    throw new BlockedError("slice draft repeats a Needs dependency");
  }
  return matches.sort((first, second) => first - second);
}

function issueUrlIdentity(url, repo, issue) {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    return segments.slice(-4).join("/") === `${repo}/issues/${issue}`;
  } catch {
    return false;
  }
}

function renderQueue(entries) {
  if (!entries.length) return "None.";
  return entries.map((entry) => `- ${entry.id} — [${entry.title}](${entry.url})`).join("\n");
}

function updateQueue(body, entries) {
  return replaceSection(body, "Queue issues", renderQueue(entries));
}

function discoveryPlanIdentity(body, resolved) {
  const normalized = updateQueue(body, []);
  return `sha256:${createHash("sha256")
    .update(normalized)
    .update("\0")
    .update(JSON.stringify(resolved))
    .digest("hex")}`;
}

function withPlanIdentity(parsed, body, resolved) {
  return {
    ...parsed,
    planIdentity: discoveryPlanIdentity(body, resolved),
  };
}

function validateFilingMap(body, protocolOptions, currentMap, validationOptions) {
  const parsed = validateDiscoveryMap(body, validationOptions);
  const evidence = decisionEvidence(protocolOptions, body, currentMap);
  const filingMap = withPlanIdentity(parsed, body, evidence.resolved);
  assertGraduationIdentity(protocolOptions, filingMap.planIdentity);
  return filingMap;
}

function graduationEvent(comment, map) {
  const marker = `gsd-loop graduation for map #${map}`;
  if (comment.body?.split(/\r?\n/, 1)[0] !== marker) return null;
  if (!TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
    throw new BlockedError(`graduation evidence by @${comment.user?.login ?? "unknown"} is not trusted`);
  }
  const match = comment.body.match(
    new RegExp(`^${escapeExpression(marker)}\\r?\\n\\r?\\nDiscovery plan: (sha256:[a-f0-9]{64})\\s*$`),
  );
  if (!match) throw new BlockedError("graduation evidence has a malformed Discovery plan marker");
  return match[1];
}

function graduationIdentities(options) {
  return issueComments(options, options.map, "discovery map graduation comments")
    .map((comment) => graduationEvent(comment, options.map))
    .filter(Boolean);
}

function activeGraduationIdentity(options) {
  return graduationIdentities(options).at(-1) ?? null;
}

function assertGraduationIdentity(options, identity) {
  if (activeGraduationIdentity(options) !== identity) {
    throw new BlockedError(
      "discovery map differs from its approved graduation evidence; return it to Not ready and re-graduate before filing",
    );
  }
}

function recordGraduationIdentity(options, identity) {
  if (activeGraduationIdentity(options) === identity) return;
  const body = `gsd-loop graduation for map #${options.map}\n\nDiscovery plan: ${identity}`;
  const result = commandResult(
    options.run,
    ["issue", "comment", String(options.map), "--repo", options.repo, "--body", body],
    options,
  );
  if (activeGraduationIdentity(options) === identity) return;
  const failure = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
  if (result.status !== 0) {
    throw new CliError(`could not persist graduation evidence: ${failure}`);
  }
  throw new BlockedError("graduation evidence was not preserved");
}

function slicePlanIdentity(body) {
  const declarations = [...body.matchAll(/^[ \t]*Discovery plan:([^\r\n]*)\r?$/gm)];
  const identities = declarations.map((declaration) => {
    const match = declaration[0].match(/^Discovery plan: (sha256:[a-f0-9]{64})\r?$/);
    if (!match) throw new BlockedError("slice has a malformed Discovery plan marker");
    return match[1];
  });
  if (identities.length > 1) {
    throw new BlockedError("slice repeats the Discovery plan marker");
  }
  return identities[0] ?? null;
}

function assertFrozenPlanIdentity(parsed, issues, map) {
  const firstSlices = matchingSliceIssues(issues, map, "S-1");
  if (firstSlices.length > 1) throw new BlockedError("multiple issues claim S-1");
  if (
    firstSlices.length === 1
    && slicePlanIdentity(firstSlices[0].body ?? "") !== parsed.planIdentity
  ) {
    throw new BlockedError(
      "discovery map differs from its frozen discovery plan identity; restore the graduated plan or create a new discovery map",
    );
  }
}

function validateSliceContract({
  draft,
  map,
  slice,
  expectedDependencies,
  expectedPlanIdentity,
}) {
  const markers = sliceMarkers(draft);
  if (!markers || markers.map !== map || markers.slice !== slice) {
    throw new BlockedError(`${slice} issue markers do not match the discovery map`);
  }
  if (slice === "S-1" && slicePlanIdentity(draft) !== expectedPlanIdentity) {
    throw new BlockedError(
      `S-1 must carry Discovery plan: ${expectedPlanIdentity}`,
    );
  }
  if (slice !== "S-1" && slicePlanIdentity(draft) !== null) {
    throw new BlockedError(`${slice} must omit the Discovery plan marker`);
  }
  const actualDependencies = sliceDependencies(draft);
  if (JSON.stringify(actualDependencies) !== JSON.stringify(expectedDependencies)) {
    throw new BlockedError(`${slice} Needs dependencies do not match its declared slices`);
  }
}

function matchingSliceIssues(issues, map, slice) {
  return issues.filter((issue) => {
    const markers = sliceMarkers(issue.body ?? "");
    return markers?.map === map && markers.slice === slice;
  });
}

function assertQueueIssueOpen(issue, { allowReady = false } = {}) {
  const state = String(issue.state).toLowerCase();
  if (state !== "open") {
    throw new BlockedError(
      `queue issue #${issue.number} must remain open until discovery map completion; stop for human intervention`,
    );
  }
  if (!allowReady && labelNames(issue.labels).includes("gsd:ready")) {
    throw new BlockedError(
      `queue issue #${issue.number} must not carry gsd:ready before discovery map completion`,
    );
  }
}

function validateLinkedQueue(parsed, issues, repo, map, options, { allowReady = false } = {}) {
  assertFrozenPlanIdentity(parsed, issues, map);
  const linked = new Map();
  for (const entry of parsed.queueIssues) {
    const declared = parsed.slices.find((slice) => slice.id === entry.id);
    const matches = matchingSliceIssues(issues, map, entry.id);
    if (matches.length > 1) throw new BlockedError(`multiple issues claim ${entry.id}`);
    const issue = matches[0];
    if (
      !declared
      || !issue
      || issue.number !== entry.issue
      || entry.title !== declared.title
      || issue.title !== declared.title
      || issue.html_url !== entry.url
      || !issueUrlIdentity(entry.url, repo, entry.issue)
    ) {
      throw new BlockedError(`${entry.id} queue entry does not match its repository issue`);
    }
    assertQueueIssueOpen(issue, { allowReady });
    const expectedDependencies = declared.needs.map((id) => linked.get(id)?.number);
    if (expectedDependencies.some((number) => number === undefined)) {
      throw new BlockedError(`${entry.id} queue dependencies are not filed`);
    }
    validateSliceContract({
      draft: issue.body,
      map,
      slice: entry.id,
      expectedDependencies: expectedDependencies.sort((first, second) => first - second),
      expectedPlanIdentity: parsed.planIdentity,
    });
    linked.set(entry.id, issue);
  }
  return linked;
}

export function reconcileDiscoverySlices({ cwd, repo, map, run = runProcess }) {
  const options = { cwd, repo, map, run };
  const currentMap = mapIssue(options);
  const parsed = validateFilingMap(currentMap.body, options, currentMap);
  const issues = repositoryIssues(options);
  const linked = validateLinkedQueue(parsed, issues, repo, map, options);
  const entries = [...parsed.queueIssues];
  const unlinked = parsed.slices.slice(entries.length);
  const candidates = unlinked.map((declared) => {
    const matches = matchingSliceIssues(issues, map, declared.id);
    if (matches.length > 1) throw new BlockedError(`multiple issues claim ${declared.id}`);
    return { declared, issue: matches[0] };
  });
  const firstExisting = candidates.findIndex(({ issue }) => issue);
  if (firstExisting > 0) {
    throw new BlockedError(`${candidates[firstExisting].declared.id} exists before an earlier delivery slice`);
  }
  const candidate = candidates[0];
  if (!candidate?.issue) {
    return {
      approvalRequired: null,
      planIdentity: parsed.planIdentity,
      recovered: [],
      missing: unlinked.map((slice) => slice.id),
    };
  }
  const { declared, issue } = candidate;
  if (issue.title !== declared.title) {
    throw new BlockedError(`${declared.id} issue title conflicts with the discovery map`);
  }
  assertQueueIssueOpen(issue);
  const expectedDependencies = declared.needs.map((id) => linked.get(id)?.number);
  if (expectedDependencies.some((number) => number === undefined)) {
    throw new BlockedError(`${declared.id} queue dependencies are not filed`);
  }
  validateSliceContract({
    draft: issue.body,
    map,
    slice: declared.id,
    expectedDependencies: expectedDependencies.sort((first, second) => first - second),
    expectedPlanIdentity: parsed.planIdentity,
  });
  return {
    approvalRequired: {
      body: issue.body,
      number: issue.number,
      slice: declared.id,
      title: issue.title,
      url: issue.html_url,
    },
    planIdentity: parsed.planIdentity,
    recovered: [],
    missing: unlinked.map((slice) => slice.id),
  };
}

export function fileDiscoverySlice({ cwd, repo, map, slice, title, bodyPath, run = runProcess }) {
  const options = { cwd, repo, map, run };
  const recovery = reconcileDiscoverySlices(options);
  if (recovery.approvalRequired) {
    const approvedBody = readFileSync(bodyPath, "utf8");
    if (
      recovery.approvalRequired.slice !== slice
      || recovery.approvalRequired.title !== title
      || recovery.approvalRequired.body !== approvedBody
    ) {
      throw new BlockedError(`${recovery.approvalRequired.slice} recovered issue differs from the approved title or body`);
    }
    const currentMap = mapIssue(options);
    const parsed = validateFilingMap(currentMap.body, options, currentMap);
    assertFrozenPlanIdentity(parsed, repositoryIssues(options), map);
    const entries = [
      ...parsed.queueIssues,
      {
        id: slice,
        title,
        url: recovery.approvalRequired.url,
        issue: recovery.approvalRequired.number,
      },
    ];
    updateMapBody(updateQueue(currentMap.body, entries), map, options);
  }
  let currentMap = mapIssue(options);
  let parsed = validateFilingMap(currentMap.body, options, currentMap);
  const issues = repositoryIssues(options);
  const linked = validateLinkedQueue(parsed, issues, repo, map, options);
  if (linked.has(slice)) return linked.get(slice);
  const declared = parsed.slices.find((entry) => entry.id === slice);
  if (!declared || declared.title !== title) throw new BlockedError(`${slice} does not match the discovery map`);
  if (parsed.slices.indexOf(declared) !== parsed.queueIssues.length) {
    throw new BlockedError(`${slice} is not the next unfiled slice`);
  }
  const draft = readFileSync(bodyPath, "utf8");
  const expectedDependencies = declared.needs.map((id) => linked.get(id)?.number);
  if (expectedDependencies.some((number) => number === undefined)) {
    throw new BlockedError(`${slice} queue dependencies are not filed`);
  }
  validateSliceContract({
    draft,
    map,
    slice,
    expectedDependencies: expectedDependencies.sort((first, second) => first - second),
    expectedPlanIdentity: parsed.planIdentity,
  });
  let matches = matchingSliceIssues(issues, map, slice);
  let createFailure = null;
  if (matches.length > 1) throw new BlockedError(`multiple issues claim ${slice}`);
  if (!matches.length) {
    const result = commandResult(
      run,
      ["issue", "create", "--repo", repo, "--title", title, "--body-file", bodyPath],
      { cwd },
    );
    if (result.status !== 0) {
      createFailure = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    }
    matches = matchingSliceIssues(repositoryIssues(options), map, slice);
  }
  if (matches.length !== 1) {
    if (createFailure) throw new CliError(`could not create ${slice}: ${createFailure}`);
    throw new BlockedError(`slice ${slice} creation could not be reconciled`);
  }
  const issue = matches[0];
  if (issue.title !== title || issue.body !== draft) {
    throw new BlockedError(`${slice} issue differs from the approved title or body`);
  }
  assertQueueIssueOpen(issue);
  currentMap = mapIssue(options);
  parsed = validateFilingMap(currentMap.body, options, currentMap);
  assertFrozenPlanIdentity(parsed, repositoryIssues(options), map);
  const entries = [
    ...parsed.queueIssues,
    { id: slice, title, url: issue.html_url, issue: issue.number },
  ];
  updateMapBody(updateQueue(currentMap.body, entries), map, options);
  const verifiedMap = mapIssue(options);
  const verified = validateFilingMap(verifiedMap.body, options, verifiedMap);
  const verifiedLinked = validateLinkedQueue(verified, repositoryIssues(options), repo, map, options);
  if (verifiedLinked.get(slice)?.number !== issue.number) {
    throw new BlockedError(`${slice} queue entry was not preserved`);
  }
  return issue;
}

export function completeDiscoveryMap({ cwd, repo, map, run = runProcess }) {
  const options = { cwd, repo, map, run };
  const currentMap = mapIssue(options, { allowClosed: true });
  const parsed = validateFilingMap(currentMap.body, options, currentMap);
  const closed = String(currentMap.state).toLowerCase() === "closed";
  const linked = validateLinkedQueue(
    parsed,
    repositoryIssues(options),
    repo,
    map,
    options,
    { allowReady: closed },
  );
  if (linked.size !== parsed.slices.length) {
    throw new BlockedError("every delivery slice must have a verified queue issue before the map closes");
  }
  if (!closed) checked("gh", ["issue", "close", String(map), "--repo", repo], options);
  const closedMap = parseJson(checked("gh", [
    "issue", "view", String(map), "--repo", repo, "--json", "state",
  ], options), "closed discovery map");
  if (String(closedMap.state).toLowerCase() !== "closed") {
    throw new BlockedError(`discovery map #${map} did not close`);
  }
  return { closed: true, slices: parsed.slices.length };
}

export function parseDiscoveryProtocolArguments(values) {
  const [command, mapValue, ...argumentsList] = values;
  const parsed = {
    command,
    map: Number(mapValue),
    repo: null,
    slice: null,
    title: null,
    bodyPath: null,
  };
  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!value) throw new UsageError(`${option ?? "option"} requires a value`);
    if (option === "--repo") parsed.repo = value;
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
  if (parsed.command === "reconcile") return reconcileDecisionIssues(common);
  if (parsed.command === "validate") {
    const mapBody = parsed.bodyPath ? readFileSync(parsed.bodyPath, "utf8") : undefined;
    return { decisions: validateDecisionEvidence({ ...common, mapBody }) };
  }
  if (parsed.command === "graduate") {
    if (!parsed.bodyPath) throw new UsageError("graduate requires --body-file");
    return graduateDiscoveryMap({
      ...common,
      mapBody: readFileSync(parsed.bodyPath, "utf8"),
    });
  }
  if (parsed.command === "recover-slices") {
    return reconcileDiscoverySlices(common);
  }
  if (parsed.command === "file-slice") {
    if (!parsed.slice || !parsed.title || !parsed.bodyPath) {
      throw new UsageError("file-slice requires --slice, --title, and --body-file");
    }
    const issue = fileDiscoverySlice({ ...common, ...parsed });
    return { number: issue.number, title: issue.title, url: issue.html_url };
  }
  if (parsed.command === "complete-map") return completeDiscoveryMap(common);
  throw new UsageError(`unknown command: ${parsed.command ?? ""}`);
}
