# gsd-loop: build

Each pass does one thing, then stops: repair one bounced PR, or take one
issue from ready to open-PR. Your loop runner provides the repetition; this
playbook provides the unit.

Pair it with a review loop running the `loop/review.md` playbook in its own
session. Both can share a GitHub token — the reviewer never touches git, so
there's nothing to race.

## Ground rules before touching anything

- Confirm the repo (`gh repo view --json nameWithOwner`) and that `origin`
  answers.
- Look up the default branch —
  `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` — and
  use what it says, whatever it says.
- Guarantee the label vocabulary exists (repeat-safe, non-destructive):

```bash
for l in gsd:ready gsd:blocked gsd:approved gsd:rework gsd:escalated; do
  gh label create "$l" --color ededed 2>/dev/null || true
done
```

## Pick up after a dead pass

A pass can die on any line, so recovery reads git and GitHub state rather
than trusting memory:

- **Uncommitted changes on a `gsd/NNN-*` branch, PR open** → a repair pass
  died. Re-enter the repair flow below for that PR.
- **Uncommitted changes on a `gsd/NNN-*` branch, no PR** → a build pass died.
  Re-check that issue is still open, still `gsd:ready`, still yours; if so,
  pick up at "Implement". If not, leave everything in place, report, stop.
- **Uncommitted changes anywhere else** → not the loop's doing. Name the
  files, stop. Stashing, resetting, or committing someone else's work is
  forbidden.
- **Clean tree, but a `gsd/NNN-*` branch (local or on origin) exists for an
  open issue assigned to you with no PR** → a pass died between commit/push
  and PR creation. Check out the branch, diff it against the issue's
  outcomes, and continue from "Implement" or "Open the PR" as appropriate.
- **Abandoned claims.** Find them:

  ```bash
  gh issue list --state open --label gsd:ready --assignee "@me" --limit 200 \
    --json number,closedByPullRequestsReferences
  ```

  Any with no open linked PR and no `gsd/NNN-*` branch anywhere: unassign
  (`gh issue edit NUMBER --remove-assignee @me`) so the queue reclaims it.
  If its PR was closed unmerged, additionally apply `gsd:escalated` with a
  comment — whether to rebuild is a human call.

## Repair queue takes priority

```bash
gh pr list --state open --label gsd:rework --limit 200 \
  --json number,title,headRefName,headRefOid,labels,updatedAt,url
```

Ignore anything also carrying `gsd:escalated` — those PRs have exited
automation until a human clears them.

Take the stalest remaining PR and pull its most recent verdict:

```bash
gh pr view NUMBER --json headRefOid,comments \
  --jq '{head: .headRefOid, verdict: ([.comments[] | select(.body | startswith("gsd-loop verdict for "))] | last)}'
```

- Verdict SHA already matches the head? The label outlived its verdict
  (fixes were pushed but the label removal died). Drop `gsd:rework`, stop —
  the reviewer will take it from here.
- Can't check out the branch (deleted head, vanished fork)? Comment what
  happened, trade `gsd:rework` for `gsd:escalated`, stop.
- Otherwise: address only the verdict's "Blocking" items, run the checks
  that cover them, push, remove `gsd:rework`, comment a summary. Stop.

If a blocking item can't be fixed without crossing an `X-N` exclusion or
making a product decision, don't. Comment the exact collision, ending with
the sentence that restarts automation ("Resolve this, then remove
`gsd:escalated`."), apply `gsd:escalated`, remove `gsd:rework`, stop.

## Choose an issue

```bash
gh issue list --state open --label gsd:ready --limit 200 \
  --json number,title,labels,body,assignees,createdAt,url \
  --jq '[.[] | select(.assignees | length == 0)]'
```

(The unassigned filter is client-side on purpose — `--search "no:assignee"`
rides a lagging index and can miss an issue you unassigned seconds ago.)

Discard issues labeled `gsd:blocked`. Discard issues whose body says
`Needs #N merged` unless `#N` is closed *and* its closing PR actually merged
(`gh issue view N --json state,closedByPullRequestsReferences`) — closure
without merged code doesn't satisfy the dependency. Of what's left, take the
oldest.

Empty queue plus empty repair queue = an idle pass. Say so, and steer the
loop runner: self-pacing → longest interval; three idle passes in a row →
suggest shutting the loop down, since only a human filing, unblocking, or
merging creates new work.

## Stake the claim

```bash
gh issue edit NUMBER --add-assignee @me
```

Claim before deep reading, before any code. Immediately re-fetch: if the
issue meanwhile became blocked, someone else's, or lost `gsd:ready`, walk
away and choose again.

Assignment is a courtesy lock, not an atomic one — two sessions on the same
GitHub account can both "win" it. One builder loop per repository, no more.

## Read the contract

`gh issue view NUMBER --comments` for the full body and discussion. The `O-N`
outcomes are the entire job; the `X-N` exclusions are the fence. Hold each
outcome against each exclusion before writing a line. Nothing outside the
contract: no drive-by refactors, no bonus fixes.

An outcome that's ambiguous, collides with an exclusion, or leans on an
unmet dependency goes straight to "Hand it back" — guessing is the one
unrecoverable failure.

## Implement

- Update from `origin`'s default branch, then create or resume
  `gsd/NNN-short-slug` (real issue number). If origin already has the
  branch, build on it as-is — force-pushing over it is forbidden.
- Follow the codebase's existing architecture, style, and names.
- Logic, data flow, permissions, integrations, or visible behavior changed?
  Tests change with it.
- Everything the contract doesn't mention keeps working exactly as before.

## Prove it

Run whatever lint, typecheck, build, and focused tests this change implicates.
Everything attributable to your diff must pass. When a broad suite fails for
pre-existing unrelated reasons, run the narrow equivalent, keep the output,
and disclose both in the PR.

Read your own `git diff` and `git status` end to end. Unrelated files or
anything secret-shaped in the diff = full stop.

## Open the PR

First re-confirm the issue is still open and `gsd:ready` — a human may have
pulled it mid-build. If they did, comment what the branch contains, skip the
PR, stop. Otherwise push and run `gh pr create --body-file` with a body
containing:

- The change and its motivation
- `Closes #NNN` (real number)
- An accounting: evidence per `O-N`, an untouched-confirmation per `X-N`,
  then the line `Side effects beyond the contract: none`
- Numbered hands-on verification steps that match what actually got built
- Which automated checks ran, with results
- A risk call: Low / Medium / High

If the side-effects line would be a lie, stop and get the issue amended
first.

Drop the PR URL as an issue comment. Merge-time closure is `Closes #NNN`'s
job — never close the issue by hand, never merge, never arm auto-merge.
Stop.

## Hand it back

When only a human can answer, ask exactly one answerable question in an
issue comment, then in a single command label and release:

```bash
gh issue comment NUMBER --body "..."
gh issue edit NUMBER --add-label gsd:blocked --remove-assignee @me
```

The comment closes with the resumption instruction: "Answer above, then
remove `gsd:blocked`." Leave `gsd:ready` on — the picker already skips
`gsd:blocked`, so the issue resurfaces the moment a human answers and
unlabels.

"This is unclear" is not a question. Name the decision, the options, and the
`O-N` it gates. Then stop, so the next pass is free to work something else.
