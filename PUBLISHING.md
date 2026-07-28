# Publishing `@aethexai/react`

How to cut and publish a release of the SDK to npm. Releases are driven by
[Changesets](https://github.com/changesets/changesets) and published **manually
from a local machine** — CI only verifies (`.github/workflows/ci.yml`), it does
not publish.

- **Package:** `@aethexai/react` (scoped, published with **public** access — see
  `access` in `.changeset/config.json`)
- **Registry:** the public npm registry (`https://registry.npmjs.org`)
- **Artifacts:** `dist/` (ESM + CJS + `.d.ts`), `README.md`, `LICENSE` — the
  exact set listed under `files` in `package.json`. Nothing else is shipped.
- **Base branch:** `main`

---

## Prerequisites

1. **Node ≥ 18** (CI tests 18, 20, 22).
2. **npm account with publish rights on the `@aethexai` scope.** Ask an org owner
   to add you to the `aethexai` npm organization/team if `npm access list packages`
   doesn't show the scope.
3. **Authenticated npm session:**
   ```bash
   npm whoami          # should print your npm username
   npm login           # if it doesn't
   ```
   If your account has 2FA enabled (recommended), keep your authenticator ready —
   `npm publish` will prompt for an OTP.
4. **Clean, up-to-date `main`:**
   ```bash
   git switch main && git pull
   git status          # working tree must be clean
   ```

---

## Release flow

### 1. Add a changeset (per meaningful change)

Every user-facing change should ship with a changeset describing it. Create one
_on your feature branch, before merging_:

```bash
npx changeset
```

Pick the bump level for `@aethexai/react`:

- **patch** — bug fixes, no API change
- **minor** — new backwards-compatible features
- **major** — breaking changes

This writes a markdown file under `.changeset/`. Commit it with your change. The
description becomes the changelog entry, so write it for consumers.

### 2. Version the package

When you're ready to release, on a clean `main`, apply all pending changesets:

```bash
npm run version        # = changeset version
```

This bumps `package.json`, deletes the consumed changeset files, and updates
`CHANGELOG.md`. **Leave these changes uncommitted for now** and review the diff —
nothing is committed or pushed until verification passes (step 3).

> **Current state:** version is `0.0.0` with three pending changesets
> (two `minor`, one `patch`). Changesets applies the highest bump, so the first
> `npm run version` will produce **`0.1.0`**.

### 3. Verify — _before_ committing anything

Run the full CI pipeline locally against the version-bumped tree. This is the
same gate CI enforces, and running it now — while the release is still only an
uncommitted working-tree change — means a failure never reaches `main`:

```bash
npm run ci
```

Runs, in order: `format:check → typecheck → lint → test:coverage → build →
size-limit → publint + are-the-types-wrong`. All must pass.

If it **fails**, fix the issue and re-run, or discard the bump entirely and start
over — `main` is untouched either way:

```bash
git checkout -- . && git clean -f CHANGELOG.md   # revert the version bump
```

Optionally, inspect the exact tarball that will be published:

```bash
npm pack --dry-run     # lists files + reports the packed size
```

Confirm it contains only `dist/`, `README.md`, `LICENSE`, and `package.json`.

### 4. Commit the release (locally — do not push yet)

Only once `npm run ci` is green, commit the version bump. Commit **before**
publishing so the git tag `changeset publish` creates points at the release
commit — but don't push yet, so a failed publish can be undone locally
(`git reset --hard HEAD~1`):

```bash
git add -A
git commit -m "Release @aethexai/react vX.Y.Z"
```

### 5. Publish

```bash
npm run release        # = npm run build && changeset publish
```

`changeset publish` publishes every package whose version isn't yet on the
registry, honoring `access: public`, and creates a git tag for the release on the
commit from step 4. `prepublishOnly` also runs `build` as a safety net.

Enter your npm OTP if prompted.

### 6. Push commit + tags, then confirm

`main` only receives the release now — after verification passed **and** the
publish succeeded:

```bash
git push --follow-tags
npm view @aethexai/react version    # should show the version you just published
```

Then create a GitHub release from the new tag if that's your team's convention.

---

## One-shot cheat sheet

Verify → commit → publish → push. `main` never sees a release commit that hasn't
already passed `npm run ci` and been published.

```bash
git switch main && git pull          # clean main
npx changeset                        # (only if a changeset isn't already committed)
npm run version                      # bump + changelog (leave uncommitted)
npm run ci                           # verify BEFORE committing — main stays clean if it fails
npm pack --dry-run                   # (optional) inspect the tarball
git add -A && git commit -m "Release @aethexai/react vX.Y.Z"   # local commit only
npm run release                      # build + publish (+ git tag)
git push --follow-tags               # push commit + tags, last — only after everything passed
```

---

## Notes & troubleshooting

- **First publish of a scoped package.** The very first `changeset publish` of
  `@aethexai/react` needs `access: public` so npm doesn't reject a scoped package
  as private — this is already set in `.changeset/config.json`, so no extra flag
  is needed.
- **`402 Payment Required` / "private packages require a paid plan".** You're
  publishing as private. Verify `access` is `public` in the changeset config (it
  is) and that no `publishConfig.access: restricted` was added to `package.json`.
- **`403 Forbidden`.** Your npm user lacks publish rights on the `@aethexai` scope,
  or you're not logged in (`npm whoami`).
- **`E409` / "cannot publish over existing version".** That version is already on
  the registry — run `npm run version` again to bump before publishing.
- **`git` tag already exists.** A previous partial release left a tag; delete it
  (`git tag -d vX.Y.Z`) only if that version was never actually published.
- **Publishing to a private registry instead of public npm** (e.g. GitHub
  Packages) is **not** the current setup. It would require adding a
  `publishConfig.registry` to `package.json`, a scope→registry mapping in
  `.npmrc`, and flipping `access` to `restricted` — coordinate with the team
  before changing this.
- **Automating releases.** If you'd rather publish from CI, add the
  [`changesets/action`](https://github.com/changesets/action) workflow with an
  `NPM_TOKEN` secret; it opens a "Version Packages" PR and publishes on merge.
  Not wired up yet.
