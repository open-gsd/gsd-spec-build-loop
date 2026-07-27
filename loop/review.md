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
  --json number,title,labels,isDraft,headRefName,headRefOid,updatedAt,url
```

Drafts are out of scope. Resolve the authenticated reviewer identity, then
retrieve the complete author-bearing comment trail with GraphQL pagination:

```bash
REVIEWER_LOGIN=$(gh api user --jq .login)
gh api graphql --paginate --slurp \
  -F owner=OWNER -F name=REPO -F number=NUMBER \
  -f query='
    query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          author { login }
          body
          baseRefOid
          headRefOid
          comments(first: 100, after: $endCursor) {
            nodes { author { login } body isMinimized }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }' > PR_EVIDENCE
```

Resolve current linkage before interpreting the trail. Search every comment
authored by `REVIEWER_LOGIN`, not only the last matching comment:

```bash
VERDICT_HEADER="gsd-loop verdict for HEAD_SHA issue #ISSUE"
jq --arg reviewer "$REVIEWER_LOGIN" --arg header "$VERDICT_HEADER" \
  '[.[].data.repository.pullRequest.comments.nodes[]
    | select(.author.login == $reviewer and ((.body | split("\n")[0]) == $header))]' \
  PR_EVIDENCE
```

- An exact first line `gsd-loop verdict for HEAD_SHA issue #ISSUE` covering
  both the current head and currently linked issue means don't re-audit.
  Synchronize that issue's outcomes to `complete` for an approved verdict or
  `pending` for any blocking/escalated verdict, then reinstate whatever labels
  the verdict dictates. Post nothing. A verdict pinned to another issue is
  stale and must never drive repair.
- A trusted `gsd-loop linkage block for HEAD_SHA` is not a verdict. If the
  issue is still unlinked, repair the linkage-block labels and post nothing.
  If linkage now exists, continue to a normal audit of that SHA.
- No trusted verdict anywhere in the trail covers the current head and issue →
  auditable. Searching the full trail prevents an A→B→A head sequence from
  creating a second verdict for A.

Never trust a marker from any other author, including one that copies the
authenticated login into its text.

Resolve the linked issue before checking CI, using the linkage rules under
"Establish the contract." For a new head, invalidate earlier outcome evidence
before auditing it:

```bash
node OUTCOME_SYNC ISSUE pending --repo OWNER/REPO --pr NUMBER --head HEAD_SHA
test "$(gh pr view NUMBER --json headRefOid --jq .headRefOid)" = "HEAD_SHA"
if gh pr view NUMBER --json labels --jq '.labels[].name' | grep -Fxq gsd:approved; then
  gh pr edit NUMBER --remove-label gsd:approved
fi
```

`OUTCOME_SYNC` is the absolute script path resolved by the review skill. The
command verifies the PR head and issue linkage before and after its write,
rejects malformed contracts, brackets the write with issue-body checks, and
changes only `O-N` checkboxes in `## Outcomes`. GitHub has no conditional
Update Issue mutation, so an edit in the narrow interval between the final
pre-write body check and `gh issue edit` can still be overwritten; the
immediate post-write check detects many such races but cannot make the update
atomic. If the command is unavailable or fails, report the pass as blocked;
never edit the issue body with an ad-hoc text transform. After it succeeds,
re-fetch the head and remove `gsd:approved`; a changed head stops the pass
before label mutation. Missing `gsd:approved` is a no-op. If this changes the
checklist or removes the label but CI is not yet auditable, report work with
reason `outcomes-invalidated`; only an unchanged pending checklist with no
stale approval label counts as an idle CI wait.

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
  --jq '.closingIssuesReferences[] | {number, repository: .repository.nameWithOwner}'
```

Only a reference whose repository identity matches `OWNER/REPO` and whose
number matches `ISSUE` establishes linkage.

- No linked issue → there is no contract, so there is nothing to audit
  against and no issue checklist to synchronize. For a `gsd/NNN-*` branch,
  post one reviewer-authored, SHA-pinned
  `gsd-loop linkage block for HEAD_SHA` comment whose
  single finding is `[BUG] no linked issue`, but only when that exact marker
  is absent. Re-fetch the head, then add `gsd:escalated` and remove
  `gsd:approved` and `gsd:rework`. A pass that finds the marker repairs those
  labels without another comment. The comment closes with "Link the issue,
  then remove `gsd:escalated`." For any other branch, apply the same labels
  without a loop-authored comment; human PRs aren't the loop's to judge.
  Stop without entering "Deliver the verdict."
- Linked issue closed, and not by this PR's own merge → the contract was
  withdrawn underneath the PR. `gsd:escalated`.
- Otherwise read the full issue with comments, the complete diff, and every
  touched file in context.

Audit strictly inside the contract: unmet `O-N` outcomes, defects, broken
data paths, scope creep, security holes, absent loading/error handling, and
code a future agent won't be able to safely modify. Unrelated improvement
ideas stay out of the verdict unless severe.

List the changed paths before accepting dependency evidence. The paginated
`PR_EVIDENCE` projection above already pins the base/head SHAs, PR author, body,
and every comment with its author and minimization state:

```bash
gh pr view NUMBER --json files --jq '[.files[].path]'
```

If a dependency manifest or lockfile changed, require branch-head evidence that
the default-branch baseline and proposed branch were audited with the same
machine-readable command and compared by advisory identifier and affected
package. The PR body or a non-minimized comment by the PR author must contain
`Dependency audit for HEAD_SHA: baseline compared`, immediately followed by
one fenced JSON object with this schema:

```json
{
  "schema": "gsd-loop/dependency-audit-v1",
  "baseline": "BASE_REF_OID",
  "head": "HEAD_REF_OID",
  "audits": [{
    "manifests": ["path/to/lockfile"],
    "directory": ".",
    "command": ["package-manager", "audit", "--json"],
    "baselineAdvisories": [{"id": "GHSA-...", "package": "name", "severity": "high"}],
    "headAdvisories": [{"id": "GHSA-...", "package": "name", "severity": "high"}]
  }]
}
```

Reject evidence unless `schema` matches exactly; `baseline` and `head` equal
the fetched full `baseRefOid` and `headRefOid`; every changed dependency
manifest or lockfile appears in exactly one `manifests` array; every command is
a nonempty argv array used unchanged at both commits from the stated directory;
and both advisory arrays contain only `id`, `package`, and lowercase
`severity`, sorted by `id` then `package`, with no duplicate identifier/package
pairs. Compare the two arrays by the `id` and `package` pair. Treat malformed,
partial, unsorted, duplicate, or extra-field data as incomparable.

Pass the full author-bearing `PR_EVIDENCE` projection to the bundled validator,
along with every changed dependency manifest or lockfile:

```bash
node AUDIT_VALIDATOR --baseline BASE_REF_OID --head HEAD_REF_OID \
  --manifest PATH [--manifest PATH ...] < PR_EVIDENCE
```

`AUDIT_VALIDATOR` is the absolute script path resolved by the review skill.
It verifies pagination completeness and consistent base/head/author/body
provenance across pages; selects only the latest current-head marker in the PR
body or a non-minimized comment by the PR author; extracts its immediately
adjacent JSON fence; then validates schema, SHAs, exact manifest coverage,
sorting, uniqueness, and advisory comparison. Its JSON result is `pass` only
when every check succeeds. Invalid or missing trusted evidence exits blocked
and is `[SEC]`. A `blocking` result lists new high/critical advisories and is
`[SEC]`. Do not preselect evidence or reproduce these deterministic decisions
by inspection.

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
gsd-loop verdict for COMMIT_SHA issue #ISSUE

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
pass as blocked. The next pass recognizes the reviewer-authored
SHA-and-issue-pinned verdict anywhere in the trail and repairs the checklist
and labels without posting a second verdict. After every synchronization,
re-fetch `headRefOid` once more before changing labels; a head change stops the
pass with no label mutation.

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
