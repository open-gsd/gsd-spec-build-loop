# Publishing releases

Releases use npm Trusted Publishing from GitHub Actions. The workflow publishes
the package and creates a matching GitHub Release tagged `vVERSION` from the
package's exact published commit. It uses a short-lived OIDC identity and does
not require an `NPM_TOKEN` secret.

## Configure the GitHub environment

1. Open **Settings → Environments** for the repository.
2. Create an environment named `npm`.
3. Under **Deployment branches and tags**, select **Selected branches and
   tags**.
4. Add a deployment **branch** rule named `main`.

The environment rule prevents a workflow selected from another branch or tag
from receiving the npm publishing identity.

## Configure the trusted publisher

Open the settings for `@opengsd/gsd-loop` on npm, add a GitHub Actions trusted
publisher, and enter these values exactly:

| npm field | Value |
|---|---|
| Organization or user | `open-gsd` |
| Repository | `gsd-spec-build-loop` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed actions | `npm publish` |

The filename is case-sensitive and must be entered without the
`.github/workflows/` path.

## Publish a release

1. Merge a green PR containing the version bump and release changes into
   `main`.
2. Confirm CI is green on `main`.
3. Open **Actions → Publish release → Run workflow**.
4. Select `main` and run the workflow.
5. Confirm the workflow succeeded, the version appears on npm, and the matching
   `vVERSION` entry appears under GitHub Releases.

The workflow refuses to publish from another branch. `npm publish` runs the
package's `prepublishOnly` tests before uploading it, and npm automatically
generates provenance for this public package when trusted publishing succeeds.
Before publishing, the driver verifies that the selected commit is still the
tip of `main` and that the `ci` workflow succeeded for that exact commit. It is
retry-safe: registry and GitHub API failures stop the run, while a confirmed
missing destination is repaired without republishing an existing package. When
npm already has the version, its `gitHead` metadata identifies the exact commit
that the matching GitHub Release must target.
