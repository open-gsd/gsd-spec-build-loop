# gsd-loop: spec

Interactive only — this playbook interviews a human and must never run
unattended.

Goal: an issue so self-sufficient that a build agent can ship it without ever
asking a question. You supply everything the code can tell you; the user
supplies every product judgment. When those two sources disagree about who
owns a decision, it belongs to the user.

## Setup

- Verify which repository you're filing into: `gh repo view --json nameWithOwner`.
- Make sure the loop's label vocabulary exists. Safe to repeat; existing
  labels keep whatever color and description a human gave them:

```bash
for l in gsd:ready gsd:blocked gsd:approved gsd:rework gsd:escalated; do
  gh label create "$l" --color ededed 2>/dev/null || true
done
```

## Optional discovery-map input

When the user supplies a discovery map number or URL, treat it as planning
provenance, not as the queue contract. Verify before relying on it:

- it belongs to this repository, is open, and carries `gsd:map`;
- its `## Graduation` value is the single line
  **Ready for `gsd-loop-spec`.**;
- its `## Not yet specified` value is exactly `None.`;
- every native sub-issue is closed with exactly one trusted resolution event
  whose map-gist line appears verbatim under `## Decisions so far`.

Write the fetched map body to a temporary file and validate its delivery-slice
structure before reading it as a contract source:

```bash
node MAP_VALIDATOR /path/to/map-body.md
```

Resolve `MAP_VALIDATOR` to `scripts/validate-discovery-map.mjs` beside the
active skill. Its JSON output is the authoritative slice order and dependency
list. If validation fails, stop and direct the user back to
`gsd-loop-discover MAP`.

Run the shared remote protocol validator:

```bash
node DISCOVERY_PROTOCOL validate MAP --repo OWNER/REPO
```

It deterministically validates manifest membership, native attachments, closed
state, trusted author association, unique resolution markers, and exact map
gists. Trust belongs to each resolution event rather than the currently
authenticated account.

If any check fails, stop and direct the user back to `gsd-loop-discover MAP`.
Do not silently finish the map inside the spec pass.

Resolved map decisions are settled inputs. Do not re-ask them unless the
codebase now contradicts them or two resolutions conflict.
Draft one queue issue per unfiled delivery slice. Translate that slice and its
relevant map decisions into observable outcomes, and carry the map's
`## Out of scope` section plus the boundaries of the other slices into binding
exclusions. Each resulting issue still needs every section and proof surface
below; a map never substitutes for them.

## Learn the code first

Before the first question, explore the codebase: locate the files this idea
touches, the conventions already in play, and the constraints that will shape
the work. A question whose answer is greppable is a wasted question — spend
those on decisions only a human can make.

## Interview until the spec closes

Work in short rounds of 1–4 questions. Lead each question with your
recommended answer, then the alternatives. Stick to genuine product forks:

- What exactly happens, for whom, and where in the product it surfaces
- Where this issue stops — what's deliberately left out
- Edge conditions that alter the contract: empty data, denied access,
  failures mid-flow
- Consequences for stored data: migrations, backfills, legacy records

When the work exposes a command, API, or other machine-facing interface, also
settle its complete observable boundary: empty invocation, unknown commands,
extra operands and options, stdout versus stderr, exit statuses, and empty or
corrupt state. Do not let the builder invent any of these. For a greenfield
repository, include the minimum runnable scaffolding, test command, and CI
workflow in the first issue unless the user explicitly excludes them.

Between rounds, integrate the answers and test the spec:

> Would two engineers, working apart, ship indistinguishable behavior from
> this document?

Not yet? Another round. Round count is unbounded — two questions can settle a
typo fix while a real feature may take twenty. Don't quit early to be polite,
and don't pad with questions after the test passes.

Before showing the draft, list every remaining choice that could change
externally visible behavior. If the issue does not select exactly one answer
for each, continue the interview.

## Write the issue

The body always carries these six sections:

```md
## Why

The user or business problem, in a sentence or two.

Discovery map: #MAP (omit when this spec did not start from a map)
Discovery slice: S-N (omit when this spec did not start from a map)

Needs #ISSUE merged (include one line per declared slice dependency, after its
earlier issue number is known)

## Outcomes

- [ ] O-1 — First observable, checkable result
- [ ] O-2 — Second observable, checkable result

## Exclusions

- X-1 — Behavior that must survive this change untouched
- X-2 — Work deliberately deferred or ruled out

## Code pointers

- path/to/file.ts — its role in this change

## Testing notes

- What deserves automated or manual coverage

## Manual walkthrough

1. Step-by-step instructions a stranger could follow to confirm every
   outcome: where to click, what to type, what must appear.
```

Constraints on the content:

- Outcomes and exclusions carry permanent `O-N` / `X-N` ids. Downstream, the
  builder implements exactly the `O` list and the reviewer audits against it;
  the `X` list is the fence neither may cross.
- An outcome that can't be met without violating an exclusion is a
  contradiction — settle it with the user before filing, never after.
- Cap each issue at roughly one agent-day. Larger ideas become an ordered
  series of issues where each depends only on already-merged predecessors.
  Record the dependency as a `Needs #N merged` line in the body; the builder
  refuses to start until `#N`'s code has actually landed.
- Dependency chains drain slowly — one link per human merge — so an
  unattended overnight run advances a chain by at most one step. Prefer
  independent issues; flag any chain deeper than two to the user.

## File it

Without a discovery map, show the complete draft in chat and wait for explicit
approval. Then create the issue, passing the body as a file so shell quoting
can't mangle it:

```bash
gh issue create --title "TITLE" --body-file /path/to/draft.md
```

Relay the issue number and URL exactly as returned — downstream playbooks trust
that number, not a guess.

When the source was a discovery map:

1. Parse `## Queue issues` first. An entry has the exact form
   `- S-N — [TITLE](URL)`. Verify every existing link is an issue in this
   repository whose body names the same map and slice. A missing or mismatched
   issue is a conflict; stop instead of guessing or filing a duplicate.
2. Draft every unfiled slice as a separate complete issue. Preserve slice
   order, and replace each declared `Needs: S-N` edge with the corresponding
   `Needs #ISSUE merged` line. Because slices depend only on earlier slices,
   every required issue number is available when its dependent is filed.
3. Show the complete draft set and dependency mapping in chat. Wait for one
   explicit approval covering the whole set.
4. Before creating any queue issue, run
   `node DISCOVERY_PROTOCOL lock MAP --repo OWNER/REPO`. The helper atomically
   acquires `gsd-loop-spec-map-MAP`, a lock namespace outside the canonical
   `gsd:*` workflow states, distinguishes contention from API failure, and
   returns a unique ownership token. Retain that token for this pass.
5. With the reservation held, file each approved draft in slice order with
   `node DISCOVERY_PROTOCOL file-slice MAP --repo OWNER/REPO --token LOCK_TOKEN --slice S-N --title "TITLE" --body-file /path/to/draft.md`.
   The helper owns marker parsing, repository-wide reconciliation, uncertain
   create classification, map queue updates, conflict detection, and
   post-write verification. Its returned issue number is authoritative for
   later dependency lines.
6. Always release only this pass's reservation with
   `node DISCOVERY_PROTOCOL unlock MAP --repo OWNER/REPO --token LOCK_TOKEN`,
   including after a failure. The helper refuses a token belonging to another
   pass. An existing reservation blocks issue creation; a human may clear a
   stale one only after confirming no filing pass is active.
7. Comment on the map with the title and URL of every issue created in this
   pass. Close the map only after every slice has a verified queue-issue entry
   and the human explicitly confirms that the linked issues still cover the
   map's entire destination.

The new issues remain outside the build queue until the human applies
`gsd:ready` to each one; map graduation is not build authorization. The build
lane still claims one issue per pass. Multiple ready slices are processed over
multiple bounded passes, never by multiple simultaneous builders in one
repository.

Finish by spelling out the user's role in the loop (this is the one playbook a
human actually reads):

- Add `gsd:ready` once you're happy — nothing builds without it.
- When an issue gets `gsd:blocked`, answer the question, then take the label
  off.
- When something gets `gsd:escalated`, resolve it, then take that label off.
- Merging is exclusively yours. The loop never merges anything.

## The one prohibition

You never apply `gsd:ready` yourself. That label is the human approval gate,
and the human clicks it — after the interview, after the filing, after their
own final read.
