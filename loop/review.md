# gsd-loop: review

Each pass audits one PR, posts one verdict, sets labels, stops. Your loop
runner supplies the cadence.

Runs alongside a build loop running the `loop/build.md` playbook in its own
session. Sharing a token is fine — this playbook's entire output is comments
and labels, so it can't collide with the builder's git state.

## Choose what to audit

Guarantee the labels exist (repeat-safe), then list candidates:

```bash
for l in gsd:approved gsd:rework gsd:escalated; do
  gh label create "$l" --color ededed 2>/dev/null || true
done
gh pr list --state open --limit 200 \
  --json number,title,labels,isDraft,headRefOid,updatedAt,url
```

Drafts are out of scope. For each candidate, pull its verdict trail — the
comments array is chronological, so "current verdict" is its last matching
element:

```bash
gh pr view NUMBER --json headRefOid,comments \
  --jq '{head: .headRefOid, verdicts: [.comments[] | select(.body | startswith("gsd-loop verdict for "))]}'
```

- Current verdict already covers the head SHA? Don't re-audit — even when
  the verdict's labels are missing (a prior pass died between comment and
  label). Reinstate whatever labels that verdict dictates, post nothing,
  move on. One SHA, one verdict, ever.
- New commits beyond the last verdict, or no verdict at all → auditable.

Cheap gate before the expensive read: a PR whose required checks are still
running, or whose mergeability reads `UNKNOWN`, isn't auditable yet — count
it as idle without opening the diff. Five straight passes pending on one
SHA → apply `gsd:escalated` with a "CI never finished" note.

Nothing auditable at all = an idle pass: say so, steer the loop runner to
its longest interval, and after three consecutive idle passes recommend
stopping the loop.

## Establish the contract

Resolve the linked issue through GitHub's own linkage, with body-parsing of
`Closes #NNN` only as a fallback:

```bash
gh pr view NUMBER --json closingIssuesReferences \
  --jq '.closingIssuesReferences[].number'
```

- No linked issue → there is no contract, so there is nothing to audit
  against. If the branch is `gsd/NNN-*`, post a verdict whose single blocking
  finding is `[BUG] no linked issue`. Any other branch means a human authored
  it — apply `gsd:escalated` instead; human PRs aren't the loop's to judge.
- Linked issue closed, and not by this PR's own merge → the contract was
  withdrawn underneath the PR. `gsd:escalated`.
- Otherwise read the full issue with comments, the complete diff, and every
  touched file in context.

Audit strictly inside the contract: unmet `O-N` outcomes, defects, broken
data paths, scope creep, security holes, absent loading/error handling, and
code a future agent won't be able to safely modify. Unrelated improvement
ideas stay out of the verdict unless severe.

Blocking findings are tagged:

- `[O-N]` — that outcome isn't delivered
- `[BUG]` — broken behavior within scope
- `[SEC]` — a security problem that bars shipping
- `[CI]` — a required check failed

Exclusions bind the reviewer too. When the only fix for a finding sits
behind an `X-N`, prescribe nothing — record
`[SCOPE O-N ↔ X-N]` with the precise contradiction and route the PR to
escalation.

## Gather merge evidence

```bash
gh pr view NUMBER --json headRefOid,mergeable,mergeStateStatus
gh pr checks NUMBER --required --json bucket,name,state,link
```

`gh pr checks` has semantic exit codes — don't treat nonzero as a crash.
Exit 8 = still pending. Exit 1 with `no required checks reported` (or
`no checks reported`) on stderr = the repo defines no required checks, which
is the escalation case below, not an error.

- `mergeable` ∈ `MERGEABLE | CONFLICTING | UNKNOWN`. `UNKNOWN` is normal
  right after a push (GitHub computes lazily; your fetch queues the
  computation) — treat as pending, retry next pass. Only `CONFLICTING` is a
  conflict, and it's a `[BUG]` blocking finding.
- Pending required checks or `UNKNOWN` mergeability → report the wait, stop,
  no verdict, no label changes.
- A failed required check → `[CI]` blocking finding.
- No required checks configured → `gsd:escalated`, never `gsd:approved`.
  Absent CI is not passing CI.

Note the `headRefOid` behind all this evidence and re-fetch it right before
posting. Changed? The evidence is stale — discard everything and let a
future pass re-audit.

## Deliver the verdict

One comment via `gh pr comment NUMBER --body-file`:

```md
gsd-loop verdict for COMMIT_SHA

Required CI: passing | failing | none configured
Merge state: <mergeStateStatus verbatim — CLEAN, DIRTY, BEHIND, BLOCKED, ...>

### What this PR does

One or two plain sentences.

### Blocking

None.

### Advisory

None.

### Merge-ready

Yes — automated evidence is complete. The merge itself is a human decision.
```

Labels follow the verdict:

- Nothing blocking, nothing newly escalated → add `gsd:approved`, remove
  `gsd:rework`. An existing `gsd:escalated` stays put; it may be somebody's
  independent high-risk gate.
- Blocking findings present → first count earlier blocking verdicts on
  **distinct SHAs**, restarting the count from the most recent removal of
  `gsd:escalated` (count everything if it was never applied) — a human
  clearing an escalation wipes the slate. Third strike: the repair cycle
  isn't converging, so add `gsd:escalated`, remove `gsd:rework`, and note
  the non-convergence in the verdict. Below three: add `gsd:rework`, remove
  `gsd:approved`.
- Scope contradiction, human-authored PR, or missing required CI → add
  `gsd:escalated`, remove both `gsd:approved` and `gsd:rework`, and write
  Merge-ready as `No — a human must decide.`

Any verdict that applies `gsd:escalated` closes with the resumption
instruction: "Resolve the above, then remove `gsd:escalated`."

Escalation is a one-way door out of automation by design: the loop won't
look at that commit again until a human fixes the underlying cause and
removes the label.

## Absolute limits

- No merging, no auto-merge.
- No commits, no pushes, ever, to any branch.
- No formal GitHub review approvals or change-requests — the loop may share
  the PR author's token, and GitHub refuses self-review. One comment plus
  labels is the whole interface.
- `gsd:approved` is input to a human's merge decision, not a substitute for
  it.
