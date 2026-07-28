import { BlockedError, UsageError } from "./errors.mjs";

const REQUIRED_SECTIONS = [
  "Destination",
  "Decisions so far",
  "Decision frontier",
  "Not yet specified",
  "Out of scope",
  "Delivery slices",
  "Graduation",
  "Queue issues",
];

export function parseDiscoverySections(body) {
  const headings = [...body.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  if (!headings.length || body.slice(0, headings[0].index).trim()) {
    throw new BlockedError("discovery map must start with its Destination section");
  }
  const names = headings.map((match) => match[1]);
  if (JSON.stringify(names) !== JSON.stringify(REQUIRED_SECTIONS)) {
    throw new BlockedError(`discovery map sections must be exactly: ${REQUIRED_SECTIONS.join(", ")}`);
  }
  return Object.fromEntries(headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    return [heading[1], body.slice(start, end).trim()];
  }));
}

function parseReferences(value, prefix, currentNumber) {
  if (value === "None.") return [];
  const references = value.split(",").map((item) => item.trim());
  if (
    references.some((item) => !new RegExp(`^${prefix}-[1-9]\\d*$`).test(item))
    || new Set(references).size !== references.length
    || references.some((item) => Number(item.slice(2)) >= currentNumber)
  ) {
    throw new BlockedError(`${prefix}-${currentNumber} Needs must reference unique earlier ${prefix}-N ids`);
  }
  return references;
}

function parseDecisionFrontier(value, allowNotReady) {
  if (value === "None.") return [];
  const headings = [...value.matchAll(/^### (D-(\d+)) — ([^\r\n]+)\r?$/gm)];
  if (!headings.length || value.slice(0, headings[0].index).trim()) {
    throw new BlockedError("Decision frontier must start with a D-N heading");
  }
  const titles = new Set();
  return headings.map((heading, index) => {
    const number = Number(heading[2]);
    if (number !== index + 1) {
      throw new BlockedError("Decision ids must be sequential from D-1");
    }
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? value.length;
    const lines = value.slice(start, end).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (
      lines.length !== 4
      || !lines[0].startsWith("Type: ")
      || !lines[1].startsWith("Question: ")
      || !lines[2].startsWith("Needs: ")
      || !lines[3].startsWith("Issue: ")
    ) {
      throw new BlockedError(`${heading[1]} must contain Type, Question, Needs, and Issue lines`);
    }
    const type = lines[0].slice(6).trim();
    const question = lines[1].slice(10).trim();
    const issue = lines[3].slice(7).trim();
    const title = heading[3].trim();
    if (
      !title
      || titles.has(title)
      || !["Discussion", "Research", "Prototype", "Prerequisite"].includes(type)
      || !question
    ) {
      throw new BlockedError(`${heading[1]} has an invalid title, type, or question`);
    }
    titles.add(title);
    if (issue !== "Pending." && !/^#[1-9]\d*$/.test(issue)) {
      throw new BlockedError(`${heading[1]} Issue must be Pending. or #N`);
    }
    if (!allowNotReady && issue === "Pending.") {
      throw new BlockedError(`ready discovery map has unresolved frontier entry ${heading[1]}`);
    }
    return {
      id: heading[1],
      title,
      type,
      question,
      needs: parseReferences(lines[2].slice(7).trim(), "D", number),
      issue: issue === "Pending." ? null : Number(issue.slice(1)),
    };
  });
}

function parseQueueIssues(value) {
  if (value === "None.") return [];
  const lines = value.split(/\r?\n/).filter(Boolean);
  const ids = new Set();
  return lines.map((line) => {
    const approved = line.match(/^- (S-[1-9]\d*) — Approved sha256:([0-9a-f]{64})$/);
    const linked = line.match(/^- (S-[1-9]\d*) — \[([^\]]+)\]\((https:\/\/[^)]+\/issues\/([1-9]\d*))\)$/);
    if (!approved && !linked) {
      throw new BlockedError("Queue issues entries must use the exact approved or linked form");
    }
    const id = (approved ?? linked)[1];
    if (ids.has(id)) throw new BlockedError(`Queue issues repeats ${id}`);
    ids.add(id);
    if (approved) return { id, status: "approved", hash: approved[2] };
    return {
      id,
      status: "linked",
      title: linked[2],
      url: linked[3],
      issue: Number(linked[4]),
    };
  });
}

function parseNeeds(value, sliceNumber) {
  if (value === "None.") return [];
  const needs = value.split(",").map((item) => item.trim());
  if (!needs.length || needs.some((item) => !/^S-[1-9]\d*$/.test(item))) {
    throw new BlockedError(`S-${sliceNumber} Needs must be None. or comma-separated S-N ids`);
  }
  if (new Set(needs).size !== needs.length) {
    throw new BlockedError(`S-${sliceNumber} Needs must not repeat a slice`);
  }
  if (needs.some((item) => Number(item.slice(2)) >= sliceNumber)) {
    throw new BlockedError(`S-${sliceNumber} may depend only on earlier slices`);
  }
  return needs;
}

function parseSlices(value, allowNotReady) {
  if (value === "None.") {
    if (allowNotReady) return [];
    throw new BlockedError("a ready discovery map must contain at least one delivery slice");
  }

  const headings = [...value.matchAll(/^### (S-(\d+)) — ([^\r\n]+)\r?$/gm)];
  if (!headings.length || value.slice(0, headings[0].index).trim()) {
    throw new BlockedError("Delivery slices must start with an S-N heading");
  }

  const titles = new Set();
  return headings.map((heading, index) => {
    const number = Number(heading[2]);
    if (number !== index + 1) {
      throw new BlockedError("Delivery slice ids must be sequential from S-1");
    }
    const title = heading[3].trim();
    if (titles.has(title)) {
      throw new BlockedError("Delivery slice titles must be unique");
    }
    titles.add(title);

    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? value.length;
    const lines = value.slice(start, end).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (
      lines.length !== 2
      || !lines[0].startsWith("Delivers: ")
      || !lines[1].startsWith("Needs: ")
    ) {
      throw new BlockedError(`${heading[1]} must contain exactly one Delivers line and one Needs line`);
    }
    const delivers = lines[0].slice("Delivers: ".length).trim();
    if (!delivers) {
      throw new BlockedError(`${heading[1]} Delivers must name an observable result`);
    }
    return {
      id: heading[1],
      title,
      delivers,
      needs: parseNeeds(lines[1].slice("Needs: ".length).trim(), number),
    };
  });
}

export function parseDiscoveryArguments(values) {
  let allowNotReady = false;
  let path = null;
  for (const value of values) {
    if (value === "--allow-not-ready") {
      if (allowNotReady) throw new UsageError("--allow-not-ready may be supplied only once");
      allowNotReady = true;
    } else if (value.startsWith("--")) {
      throw new UsageError(`unknown discovery-map option: ${value}`);
    } else if (path) {
      throw new UsageError("discovery-map accepts exactly one map body file");
    } else {
      path = value;
    }
  }
  if (!path) throw new UsageError("discovery-map requires a map body file");
  return { allowNotReady, path };
}

export function validateDiscoveryMap(body, { allowNotReady = false } = {}) {
  const sections = parseDiscoverySections(body);
  if (!sections.Destination) {
    throw new BlockedError("Destination must not be empty");
  }
  if (!allowNotReady) {
    if (sections["Not yet specified"] !== "None.") {
      throw new BlockedError("a ready discovery map must have no unspecified work");
    }
    if (sections.Graduation !== "Ready for `gsd-loop-spec`.") {
      throw new BlockedError("discovery map is not ready for gsd-loop-spec");
    }
  } else if (!["Not ready.", "Ready for `gsd-loop-spec`."].includes(sections.Graduation)) {
    throw new BlockedError("Graduation must be Not ready. or Ready for `gsd-loop-spec`.");
  }
  const decisions = parseDecisionFrontier(sections["Decision frontier"], allowNotReady);
  const slices = parseSlices(sections["Delivery slices"], allowNotReady);
  const queueIssues = parseQueueIssues(sections["Queue issues"]);
  if (queueIssues.some((entry) => !slices.some((slice) => slice.id === entry.id))) {
    throw new BlockedError("Queue issues references an unknown delivery slice");
  }
  if (queueIssues.some((entry, index) => entry.id !== slices[index]?.id)) {
    throw new BlockedError("Queue issues must form a prefix in delivery-slice order");
  }
  const pendingIndexes = queueIssues
    .map((entry, index) => entry.status === "approved" ? index : -1)
    .filter((index) => index >= 0);
  if (pendingIndexes.length > 1 || pendingIndexes.some((index) => index !== queueIssues.length - 1)) {
    throw new BlockedError("Queue issues may contain only one final approved draft");
  }
  return {
    schema: "gsd-loop/discovery-slices-v1",
    decisions,
    slices,
    queueIssues,
  };
}
