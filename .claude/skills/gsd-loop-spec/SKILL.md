---
name: gsd-loop-spec
description: Turn a rough idea into a fully specified GitHub issue through a structured interview, ready for the gsd-loop build queue. Use when asked to spec an idea, write up a queue-ready issue, or shape a feature for the loop. Needs the user in the room — never runs unattended.
---

# gsd-loop: spec

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

Between rounds, integrate the answers and test the spec:

> Would two engineers, working apart, ship indistinguishable behavior from
> this document?

Not yet? Another round. Round count is unbounded — two questions can settle a
typo fix while a real feature may take twenty. Don't quit early to be polite,
and don't pad with questions after the test passes.

## Write the issue

The body always carries these six sections:

```md
## Why

The user or business problem, in a sentence or two.

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

Show the complete draft in chat and wait for explicit approval. Then create
the issue, passing the body as a file so shell quoting can't mangle it:

```bash
gh issue create --title "TITLE" --body-file /path/to/draft.md
```

Relay the issue number and URL exactly as returned — downstream skills trust
that number, not a guess.

Finish by spelling out the user's role in the loop (this is the one skill a
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
