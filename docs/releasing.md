# Publishing to npm

Releases use npm Trusted Publishing from GitHub Actions. The workflow uses a
short-lived OIDC identity and does not require an `NPM_TOKEN` secret.

## Configure the trusted publisher

Open the settings for `@opengsd/gsd-loop` on npm, add a GitHub Actions trusted
publisher, and enter these values exactly:

| npm field | Value |
|---|---|
| Organization or user | `open-gsd` |
| Repository | `gsd-spec-build-loop` |
| Workflow filename | `publish.yml` |
| Environment name | Leave blank |
| Allowed actions | `npm publish` |

The filename is case-sensitive and must be entered without the
`.github/workflows/` path.

## Publish a release

1. Merge the version bump and release changes into `main`.
2. Confirm CI is green on `main`.
3. Open **Actions → Publish npm package → Run workflow**.
4. Select `main` and run the workflow.
5. Confirm the workflow succeeded and the version appears on npm.

The workflow refuses to publish from another branch. `npm publish` runs the
package's `prepublishOnly` tests before uploading it, and npm automatically
generates provenance for this public package when trusted publishing succeeds.
