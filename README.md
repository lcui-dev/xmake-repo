# lcui-xmake-repo

Standalone **xmake package registry** for the LCUI family. It holds only package
descriptors (`packages/**/xmake.lua`), a version manifest
(`packages/versions.json`), and the tooling that keeps them in sync with the LCUI
source repository. Descriptors live here — not in the LCUI source repo — so
sub-library releases never touch LCUI history.

Consume it from any xmake project:

```lua
add_repositories("lcui-repo https://github.com/lc-soft/lcui-xmake-repo.git")

add_requires("lcui")            -- self-contained binary (lockstep w/ LCUI releases), git-build fallback
add_requires("pandagl 1.0.0")  -- source-only, independently versioned
```

## Packages

| Package | Schemes | Versioning |
|---|---|---|
| `lcui` | binary + source | lockstep with LCUI release tags (merged self-contained `lcui.lib`) |
| `pandagl`, `yutil`, `css`, `ptk`, `ctest` | source only | **independent**, pinned to the last LCUI commit that changed that `lib/<dir>` |

`lcui` is self-contained; do NOT also depend on the sub-library packages in one
target (duplicate symbols). Sub-library packages are for consumers of a single
library.

### Renamed packages

The sub-library packages dropped the `lcui-` prefix:

| Old name | New name |
|---|---|
| `lcui-css` | `css` |
| `lcui-ptk` | `ptk` |
| `lcui-ctest` | `ctest` |

`lcui`, `yutil` and `pandagl` are unchanged. Update your `add_requires(...)` calls.

## Version manifest

`packages/versions.json` is the single source of truth for each package's current
version + the LCUI git commit its source checks out:

```json
{ "pandagl": { "version": "1.0.0", "commit": "<40-hex>" }, "lcui": { "version": "3.0.0", "commit": "" } }
```

## Updating versions — `scripts/update-versions.mjs`

Given a local LCUI checkout, it resolves each package's latest source commit
(`git -C <source> log -n1 --format=%H -- <lib path>`), bumps the version when the
source changed, rewrites the descriptor's source `add_versions` (and `develop`
line) and `versions.json`.

```bash
node scripts/update-versions.mjs --source /path/to/LCUI            # bump changed sub-libs (patch)
node scripts/update-versions.mjs --source /path/to/LCUI --pkg pandagl --bump minor
node scripts/update-versions.mjs --source /path/to/LCUI --pkg pandagl --ver 1.2.0
# lcui release: pin source to the tag + set binary shas produced by CI
node scripts/update-versions.mjs --source /path/to/LCUI --pkg lcui --ver 3.1.0 --ref v3.1.0 \
    --sha windows-x64=<sha256> --sha linux-x64=<sha256>
```

Rules the tool enforces:
- A git **source** build needs a real 40-hex commit — the tool never leaves
  `PENDING` on a pushed source version/develop line.
- `lcui` binary alias shas come from CI after the zip is uploaded to GitHub
  Releases (`--sha`); sub-libs have no binary.

## Dependency direction

This repo depends **one-way** on LCUI: it reads LCUI (source commits + its GitHub
Release binary zips). LCUI's release CI publishes `lcui-*.zip` to its own release
and **never** writes here.

Sync is a **manually-triggered** workflow in THIS repo (`.github/workflows/sync-and-test.yml`,
`workflow_dispatch`): it resolves commits / binary shas from LCUI, updates the
descriptors, runs the unit tests, and **verifies every package is actually
downloadable/installable** (linux + windows matrix). It only pushes back here
(opt-in `commit` input) — so it needs no LCUI credentials.

Run the tooling tests locally with `node --test scripts/`.
