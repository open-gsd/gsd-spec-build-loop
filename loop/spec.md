# gsd-loop: spec

Interactive only — this playbook interviews a human and must never run
unattended.

Goal: an issue so self-sufficient that a build agent can ship it without ever
asking a question. You supply everything the code can tell you; the user
supplies every product judgment. When those two sources disagree about who
owns a decision, it belongs to the user.

## Setup

- Verify which repository you're filing into: `gh repo view --json nameWithOwner`.
- Make sure the queue/review label vocabulary exists. Safe to repeat; existing
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
Discovery plan: PLAN_IDENTITY (include only for S-1 from `recover-slices`)

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

Once the first slice issue is filed, including an issue awaiting marker-based
recovery, the map's delivery plan, slice IDs and order, destination, decisions,
and scope are immutable.
A later route or scope change requires a new discovery map. Never mutate or
cancel an already-filed contract.

1. Confirm no other discovery or spec pass is operating on this map, including
   one authenticated as the same GitHub login. Concurrent same-map passes are
   unsupported; this is an operating precondition, not a distributed lock.
2. Before redrafting or creating anything, run
   `node DISCOVERY_PROTOCOL recover-slices MAP --repo OWNER/REPO`.
   It returns the frozen `planIdentity`, validates every existing queue link,
   checks the trusted graduation event and exact trusted decision resolutions,
   and searches permanent map/slice markers in slice order. Put
   `Discovery plan: PLAN_IDENTITY` in the S-1 draft exactly; later slices omit
   it. If recovery returns `approvalRequired`, show that exact recovered title
   and body to the human, wait for explicit approval, save the unchanged body
   to a file, and pass it to `file-slice`; recovery does not link the issue
   before that approval.
3. Work through missing slices in order, one at a time. Resolve every declared
   dependency to the already-filed predecessor issue number, put the exact
   `Needs #N merged` lines into that slice's complete draft, show the exact
   eventual issue title and body to the human, and wait for explicit approval.
   Never approve a placeholder dependency or a later draft whose predecessor
   number is not known yet.
4. File that unchanged approved title and body with
   `node DISCOVERY_PROTOCOL file-slice MAP --repo OWNER/REPO --slice S-N --title "TITLE" --body-file /path/to/draft.md`.
   The helper checks the open `gsd:map`, frozen plan identity, repository
   identity, title, unique markers, exact dependencies, and that every linked
   issue remains open; searches before creation; reconciles an uncertain create
   result; updates the queue; and verifies the write. A prematurely closed slice
   blocks the pass for human intervention, as does any slice labeled
   `gsd:ready` before map completion; spec never interprets review or merge
   evidence. Its returned issue number is authoritative for the next slice.
   Repeat steps 3–4 until all slices are linked.
5. Comment on the map with the title and URL of every issue created in this
   pass. After the human explicitly confirms that the linked issues still cover
   the map's entire destination, run
   `node DISCOVERY_PROTOCOL complete-map MAP --repo OWNER/REPO`. It verifies
   that every slice has a queue entry, every linked issue is still open, and
   only then closes the map. The command is repeat-safe: if the close response
   was lost, a retry verifies the already-closed map and reports completion.

Only after the map is confirmed closed does the human apply `gsd:ready` to
each issue individually. Until then the new issues remain open but outside the
build queue; map graduation is not build authorization. The build lane still
claims one issue per pass. Multiple ready slices are processed over multiple
bounded passes, never by multiple simultaneous builders in one repository.

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
