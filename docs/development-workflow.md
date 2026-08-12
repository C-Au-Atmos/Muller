# Muller development workflow

Muller uses one set of version branches for requirements, implementation,
stabilization, and stable integration:

```text
req/X.Y.Z -> feat/X.Y.Z -> release/X.Y.Z -> master
```

`X.Y.Z` is the target product version, for example `0.1.3`. A commit advances
only from left to right during normal delivery. Matching branch names do not
mean the stages can be skipped.

## Branch responsibilities

| Branch | Owns | Must not be used for |
|---|---|---|
| `req/X.Y.Z` | Requirements, scope, acceptance criteria, design and delivery plans | Product implementation |
| `feat/X.Y.Z` | Product code, refactoring, automated tests, implementation documentation | Release publication or direct integration into `master` |
| `release/X.Y.Z` | Integrated candidate, regression fixes, version metadata, changelog and release evidence | Unplanned feature work |
| `master` | Verified milestone history and the stable repository baseline | Day-to-day development |

When requirements change, commit them to `req/X.Y.Z` first and merge that
branch into `feat/X.Y.Z` before implementing the change. If a code fix must be
made directly on `release/X.Y.Z`, merge it back into `feat/X.Y.Z` before new
development so the fix is not lost in the next promotion.

## Starting a version

Create every version branch from the same verified `master` commit. The
requirement branch is opened first; the other branches may be reserved at the
same baseline, but they do not advance until their preceding stage is ready.

```powershell
git fetch origin --prune
git switch master
git pull --ff-only
git switch -c req/X.Y.Z
git push -u origin req/X.Y.Z
git switch -c feat/X.Y.Z master
git push -u origin feat/X.Y.Z
git switch -c release/X.Y.Z master
git push -u origin release/X.Y.Z
```

If the remote branches already exist, use `git switch --track
origin/<branch>` instead of recreating them.

## Promotion sequence

First update and review the requirement documents on `req/X.Y.Z`. Then promote
the approved requirements into the implementation branch:

```powershell
git switch feat/X.Y.Z
git merge --no-ff req/X.Y.Z
git push origin feat/X.Y.Z
```

Implement and test on `feat/X.Y.Z`. When the planned scope and its tests are
complete, promote it into the release candidate:

```powershell
git switch release/X.Y.Z
git merge --no-ff feat/X.Y.Z
git push origin release/X.Y.Z
```

Only stabilization work is allowed after this point. Run the full quality gate
before declaring a milestone ready:

```powershell
npm run lint
npm test
npm run build
cargo fmt --all -- --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
npm run test:e2e
```

After the candidate passes and the changelog/version metadata describe the
same milestone, integrate it into `master`:

```powershell
git switch master
git pull --ff-only
git merge --no-ff release/X.Y.Z
git push origin master
```

`master` may receive multiple coherent milestones from the same release branch,
but each one must pass the applicable gates. Do not merge `req/X.Y.Z` or
`feat/X.Y.Z` directly into `master`, and do not force-push shared branches.

## Promotion checklist

- The worktree is clean and remote references are current.
- The implementation matches the latest committed requirement documents.
- Relevant unit, integration, and E2E coverage accompanies the change.
- Required checks pass on the exact commit being promoted.
- `release/X.Y.Z` contains only the intended version scope and stabilization.
- Version metadata, changelog, and release evidence agree.
- The remote branch is pushed after each promotion.
