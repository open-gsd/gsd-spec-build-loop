# gsd-loop: discover

Interactive only — this playbook charts or advances one discovery map with a
human present. It is the optional front door for an effort that is too large
and uncertain to turn into queue-ready issues yet. Clear the uncertainty and
divide the destination into delivery slices here; implementation still belongs
to `loop/spec.md`, `loop/build.md`, and `loop/review.md`.

One invocation does one bounded pass:

- **Chart** a new map and its initial decision frontier, then stop; or
- **Advance** an existing map by resolving exactly one frontier decision, then
  stop.

Never schedule this playbook. Never write product code or open a product PR,
and never apply `gsd:ready`.

## Setup

- Resolve the repository with `gh repo view --json nameWithOwner`.
- Make the map label available. Safe to repeat; preserve a human's existing
  color and description:

```bash
if ! gh label create gsd:map --color ededed \
  --description "Multi-session discovery map" 2>/dev/null; then
  gh label view gsd:map >/dev/null 2>&1 || {
    echo "could not create or read gsd:map" >&2
    exit 1
  }
fi
```

This suppresses only the expected "already exists" failure. Authentication,
permission, and network failures must stop the pass.

GitHub's native sub-issue and dependency endpoints are the source of truth for
map membership and blocking. Use API version `2026-03-10` for the commands in
this playbook.

## Choose the mode

If the user supplied a map issue number or URL, advance it. Otherwise chart a
new map. A valid map is an open issue in this repository carrying `gsd:map`.
Never infer a map from its title alone.

## Chart a map

### Learn before asking

Explore the codebase, repository guidance, relevant issues, and existing
architecture before the first question. Facts discoverable from those sources
are agent work. Questions are reserved for product choices and priorities.

### Name the destination and boundary

Interview in short rounds. Establish:

- **Destination** — the concrete planning state that makes ordinary gsd-loop
  specification possible.
- **Out of scope** — work beyond that destination.
- **Known decisions** — choices already settled and their rationale.
- **Decision frontier** — precise questions that can be resolved now.
- **Not yet specified** — in-scope uncertainty that cannot yet be phrased as a
  precise question because it depends on an earlier decision.

Separate facts from decisions. Look facts up; never answer a human-owned
decision on the user's behalf.

Use one test for whether this playbook is warranted:

> Is the effort too large for one agent session, with at least one in-scope
> question that must be resolved before a contract-grade issue can be written?

If not, create nothing. Recommend `gsd-loop-spec` and stop.

### Draft the map and frontier

The map body has exactly these sections:

```md
## Destination

<One or two sentences describing the state in which this effort is ready for
gsd-loop specification.>

## Decisions so far

<One low-resolution line per decision that was already settled before this map,
including its rationale, or exactly `None.`>

## Not yet specified

<One bullet per in-scope uncertainty that cannot yet be stated as a precise
question, or exactly `None.` with no list marker>

## Out of scope

<One bullet per explicit boundary, or exactly `None.` with no list marker>

## Delivery slices

None.

## Graduation

Not ready.

## Queue issues

None.
```

Known decisions have no child issue that owns their history, so record their
gist and rationale directly in `## Decisions so far`. Decisions resolved by a
later map pass use linked child issues instead.

`## Delivery slices` is the eventual filing plan, not another decision list.
Leave it as `None.` while the route is still too uncertain. As the map clears,
replace it with one or more slices in this exact shape:

```md
### S-1 — <queue issue title>

Delivers: <one independently observable result>

Needs: None.

### S-2 — <queue issue title>

Delivers: <one independently observable result>

Needs: S-1
```

IDs are sequential and permanent. `Needs` is `None.` or a comma-separated list
of earlier slice IDs. Each slice must fit roughly one agent-day and leave the
repository in a useful, verifiable state. Prefer independent slices; tell the
human when a chain is deeper than two. Together the slices must cover the
destination without gaps or assigning the same behavior twice. A small effort
may have one slice; never manufacture extra issues merely to create parallelism.

Each frontier decision is a child issue with this body:

```md
## Map

#MAP

## Type

<Exactly one of: Discussion, Research, Prototype, Prerequisite>

## Question

<One precise question whose resolution removes uncertainty from the route.>
```

Types describe how a later pass resolves the question:

- **Discussion** — a live product or domain decision with the human.
- **Research** — primary-source reading or codebase investigation that settles
  a fact.
- **Prototype** — a cheap, disposable artifact used to make a choice concrete;
  it must not become product implementation.
- **Prerequisite** — bounded work required to expose facts for a later
  decision, such as obtaining access or inspecting representative data.

A decision issue must fit in one fresh agent session. Record blocking edges
between decision issues, not a speculative execution plan. Leave an unknown in
`Not yet specified` until its question can be phrased precisely.

Show the complete map, decision issues, and dependency edges. Wait for explicit
approval before creating anything on GitHub.

### Create, relate, then stop

Create the map with `gh issue create --label gsd:map --body-file ...`. Create
the approved decision issues next. For each decision, fetch its numeric REST
`id`, then attach it to the map:

```bash
DECISION_ID=$(gh api "repos/OWNER/REPO/issues/DECISION" --jq .id)
gh api --method POST -H "X-GitHub-Api-Version: 2026-03-10" \
  "repos/OWNER/REPO/issues/MAP/sub_issues" -F sub_issue_id="$DECISION_ID"
```

After every child exists, wire each approved blocking edge. `BLOCKED` is the
decision that must wait; `BLOCKER_ID` is the REST `id` of its prerequisite:

```bash
gh api --method POST -H "X-GitHub-Api-Version: 2026-03-10" \
  "repos/OWNER/REPO/issues/BLOCKED/dependencies/blocked_by" \
  -F issue_id="$BLOCKER_ID"
```

Re-read the map's `sub_issues` and every decision's
`dependencies/blocked_by`. If any relationship is missing, report the exact
failure and stop; do not replace native relationships with prose. Relay every
created issue by title and URL, then stop without resolving a decision.

## Advance a map

### Claim the map

Only one discovery pass may advance a given map at a time because GitHub issue
body edits are not conditional. Read its assignees first. If it is assigned to
someone else, name the owner and stop. Otherwise claim it before deep reading:

```bash
gh issue edit MAP --add-assignee @me
```

Immediately re-fetch. If the map closed, lost `gsd:map`, or gained another
assignee, remove yourself and stop. Always remove yourself when the pass ends,
including on failure.

### Recover an interrupted pass

Before choosing new work, inspect the map's closed children and every open
child assigned to you for a resolution comment whose first line is exactly
`gsd-loop decision for map #MAP` and whose author is the authenticated user.
Repair one incomplete transition before doing anything new:

- resolution comment present, decision still open — synchronize its named gist
  into `## Decisions so far` if missing, apply any consequences recorded in the
  comment, then close it;
- decision closed, named gist missing — reconstruct the gist from its trusted
  resolution comment and append it; or
- map updated and decision closed, but either assignment remains — remove the
  stale assignments.

If exactly one open child is assigned to you without a trusted resolution
comment, resume it as this pass's chosen decision when all its blockers remain
closed. If its blockers changed, remove its assignment, report the changed
frontier, and stop. More than one unresolved self-assignment is inconsistent;
list them and stop without choosing between them.

Re-fetch after a state repair and stop. A resumed unresolved decision continues
to "Resolve exactly one decision" below. Never post a second resolution comment
for the same decision.

### Find the frontier

Load the map body and comments, but do not eagerly load every child body. List
all children:

```bash
gh api --paginate --slurp -H "X-GitHub-Api-Version: 2026-03-10" \
  "repos/OWNER/REPO/issues/MAP/sub_issues?per_page=100"
```

For each open child, inspect its blockers:

```bash
gh api --paginate --slurp -H "X-GitHub-Api-Version: 2026-03-10" \
  "repos/OWNER/REPO/issues/DECISION/dependencies/blocked_by?per_page=100"
```

The frontier is the open, unassigned children whose blockers are all closed.
Choose the first frontier issue in the sub-issue order. If open children exist
but the frontier is empty, report the dependency cycle, unresolved blocker, or
existing assignee and stop.

Claim the chosen decision with `gh issue edit DECISION --add-assignee @me`,
then re-fetch it. A decision assigned to someone else is not available.

### Resolve exactly one decision

Read the chosen issue and only the related decisions needed for context. Follow
its type:

- Discussion: work with the human; do not complete the pass without their
  answer.
- Research: use primary sources and record links with the conclusion.
- Prototype: create only the smallest disposable artifact needed for the
  decision. Do not commit it to the product branch or treat it as production
  code.
- Prerequisite: perform the bounded prerequisite or give the human an exact
  checklist when only they can do it.

Record the result on the decision issue:

```md
gsd-loop decision for map #MAP

## Resolution

<The settled answer.>

## Evidence

<Links, code pointers, measurements, prototype location, or `None.`>

## Consequences

<What this makes decidable next and any scope effect.>
```

If no resolution was reached, leave the issue open, remove both assignments,
and stop. Never manufacture an answer to make the map move.

### Re-chart what the answer exposed

Before changing the map, re-fetch its current body so human edits are retained.
Then, as one coherent update:

1. Append one named, linked gist under `## Decisions so far`.
2. Remove fog that is now resolved or can now be stated precisely.
3. Create newly precise decision issues and attach them as native sub-issues.
4. Wire native dependency edges after every new issue has an id.
5. Move anything revealed beyond the destination into `## Out of scope`.
6. Add, split, merge, or reorder delivery slices when the resolved decision
   changes the filing plan. Preserve an existing slice ID when its meaning did
   not change.
7. Close the resolved decision issue.

Never copy the full resolution into the map; the child issue owns its detail.
The map is the low-resolution index.

After writing, re-fetch the map, the resolved issue, new sub-issues, and their
dependency edges. A mismatch is a blocked pass: report it exactly and leave all
evidence in place for recovery.

### Graduate or stop

Graduation requires all five conditions:

1. every child decision issue is closed;
2. `## Not yet specified` contains only `None.`; and
3. the destination and out-of-scope boundary are still explicit;
4. every delivery slice follows the exact format above, is independently
   verifiable, and fits roughly one agent-day; and
5. the human confirms that the slices collectively cover the destination
   without gaps or overlap.

When all five hold, replace the `## Graduation` value with exactly:

```md
Ready for `gsd-loop-spec`.
```

Write the proposed body to a temporary file and run the deterministic map
validator before updating GitHub:

```bash
node MAP_VALIDATOR /path/to/map-body.md
```

Resolve `MAP_VALIDATOR` to `scripts/validate-discovery-map.mjs` beside the
active skill. While charting a not-ready map, use `--allow-not-ready`; the ready
form above rejects missing slices, malformed fields, and dependencies that do
not point backward. A validator failure blocks graduation.

Otherwise leave it as `Not ready.`. Remove both assignments and report the map
URL, the decision resolved, the remaining frontier, and any remaining fog.

## Handoff boundary

A ready map is planning provenance, not a build contract. It must never enter
the ready queue. The next human-invoked pass is `gsd-loop-spec MAP`, which
turns every delivery slice into a separate issue, translates its decisions
into observable `O-N` outcomes, carries its scope boundary into `X-N`
exclusions, and adds code pointers, testing notes, and a manual walkthrough.
The human still reviews each filed issue and applies `gsd:ready` individually.
