# gsd-loop: review

Each pass handles one PR, repairs or posts one verdict, synchronizes its linked
issue, sets labels, then stops. Your loop runner supplies the cadence.

Runs alongside a build loop running the `loop/build.md` playbook in its own
session. Sharing a token is fine — this playbook changes only PR comments,
issue outcome checkboxes, and labels, so it can't collide with the builder's
git state.

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

- Current verdict already covers the head SHA? Don't re-audit. Resolve its
  linked issue as below, synchronize that issue's outcomes to `complete` for
  an approved verdict or `pending` for any blocking/escalated verdict, then
  reinstate whatever labels the verdict dictates. Post nothing. This repairs
  a pass that died between comment, checklist, and label. One SHA, one verdict,
  ever.
- New commits beyond the last verdict, or no verdict at all → auditable.

Resolve the linked issue before checking CI, using the linkage rules under
"Establish the contract." For a new head, invalidate earlier outcome evidence
before auditing it:

```bash
node OUTCOME_SYNC ISSUE pending --repo OWNER/REPO --pr NUMBER --head HEAD_SHA
```

`OUTCOME_SYNC` is the absolute script path resolved by the review skill. The
command verifies the PR head and issue linkage twice, refuses malformed or
concurrently changed issue bodies, and changes only `O-N` checkboxes in
`## Outcomes`. If it is unavailable or fails, report the pass as blocked;
never edit the issue body with an ad-hoc text transform. An already-pending
checklist is a no-op. If this invalidates checked outcomes but CI is not yet
auditable, report work with reason `outcomes-invalidated`; only an unchanged
pending checklist counts as an idle CI wait.

Cheap gate before the expensive read: a PR whose required checks are still
running, or whose mergeability reads `UNKNOWN`, isn't auditable yet — count
it as idle without opening the diff. Before reporting the wait, resolve Git's
common directory with `git rev-parse --git-common-dir` and inspect
`gsd-loop/review.jsonl` beneath it. Use `pending-ci-NUMBER-HEAD_SHA` as the
result reason. If the last two log entries are idle passes with that exact
reason, this is the third straight pending pass: apply `gsd:escalated` with a
"CI never finished" note and report the pass as work. A missing or malformed
log is no evidence of prior attempts, so do not escalate from it.

Nothing auditable at all = an idle pass: say so, steer the loop runner to
its longest interval, and after three consecutive idle passes recommend
stopping the loop.

## Establish the contract

Resolve the linked issue through GitHub's own linkage, with body-parsing of
`Closes #NNN` only as a fallback. Do this once per candidate, before the CI
gate and outcome invalidation described above:

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

List the changed paths and read the PR body before accepting its test evidence:

```bash
gh pr view NUMBER --json files,body --jq '{files: [.files[].path], body: .body}'
```

If a dependency manifest or lockfile changed, require branch-head evidence that
the default-branch baseline and proposed branch were audited with the same
machine-readable command and compared by advisory identifier and affected
package. The PR body or a later builder repair comment must contain
`Dependency audit for HEAD_SHA: baseline compared` with the full current
`headRefOid`, commands, and result. Evidence pinned to any other SHA is stale.
When the PR body does not carry current-head evidence, fetch every comment body
explicitly:

```bash
gh pr view NUMBER --json comments --jq '.comments[].body'
```

Do not reuse the verdict-only projection from candidate selection. Repair
comments are not verdict comments. Find the exact current-head marker in the
full output and audit its commands and result.

Missing, stale, or incomparable evidence is `[SEC]` and blocks approval. A new
high or critical advisory attributable to the diff is also `[SEC]`; route it
to `gsd:escalated` when the issue contract does not permit a compatible fix.
Only a diff with no dependency manifest or lockfile changes may use
`Dependency audit: not applicable`.

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
  no verdict, and no label changes unless the third-pass escalation rule above
  applies.
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
Dependency audit: baseline compared | not applicable | blocking

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

Immediately after posting the verdict and before changing labels, synchronize
the linked issue against the same head SHA. An approval checks every outcome:

```bash
node OUTCOME_SYNC ISSUE complete --repo OWNER/REPO --pr NUMBER --head HEAD_SHA
```

Any blocking or escalated verdict uses `pending` instead. If synchronization
fails after the comment is posted, stop without changing labels and report the
pass as blocked. The next pass recognizes the SHA-pinned verdict and repairs
the checklist and labels without posting a second verdict. After every
synchronization, re-fetch `headRefOid` once more before changing labels; a head
change stops the pass with no label mutation.

Escalation is a one-way door out of automation by design: the loop won't
look at that commit again until a human fixes the underlying cause and
removes the label.

## Absolute limits

- No merging, no auto-merge.
- No commits, no pushes, ever, to any branch.
- No formal GitHub review approvals or change-requests — the loop may share
  the PR author's token, and GitHub refuses self-review. The verdict comment,
  issue outcome checkboxes, and labels are the whole interface.
- `gsd:approved` is input to a human's merge decision, not a substitute for
  it.

## Report the pass

The final response must end with exactly one machine-readable line and no text
after it:

```text
GSD_LOOP_RESULT={"lane":"review","status":"work|idle|blocked","reason":"short-reason"}
```

Use `work` after changing a checklist, posting or repairing a verdict, or
changing a label; `idle` only when no PR is auditable and no state changed;
and `blocked` when credentials, permissions, required CI, or malformed
repository state prevent a safe verdict.
