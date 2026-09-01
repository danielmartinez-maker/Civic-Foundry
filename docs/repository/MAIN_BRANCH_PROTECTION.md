# Main Branch Protection Policy

**Repository:** `danielmartinez-maker/Civic-Foundry`

## Verified current state

Stack 7 read the live GitHub repository before implementation and observed:

- `main.protected = false`;
- branch-protection enforcement disabled;
- repository rulesets: none.

This document is policy, not proof that the administrative settings are enabled.

## Required target settings

Configure either a repository ruleset or branch protection for `main` with these effective requirements:

1. Require a pull request before merging.
2. Require the canonical `acceptance` status check from `.github/workflows/ci.yml`.
3. Require at least one approving review while Civic Foundry has a single primary repository owner; increase this when the active maintainer group grows.
4. Dismiss stale approvals when material commits are pushed after review.
5. Require the branch to be up to date before merge where GitHub can enforce this without blocking intentionally stacked PR workflows.
6. Block force pushes.
7. Block deletion of `main`.
8. Restrict direct pushes to explicit emergency/admin override.
9. Keep draft PRs non-mergeable by process; do not use admin override to bypass draft status or failing checks.
10. Standardize the accepted merge method at repository level. Preserve historical merge topology when a stacked/integration program explicitly requires it.

Automatic deletion of merged feature branches should remain disabled until the historical branch backlog is classified and active stacked bases no longer rely on retained refs.

## Required check semantics

The required check should be the stable acceptance contract, not a proliferating list of stack-specific workflow names. Stack 7 keeps one permanent workflow with one canonical job:

```text
Civic Foundry CI / acceptance
```

That job runs cheap deterministic checks first and then the portable asset/build/browser/visual acceptance stack.

## Administrative blocker

The GitHub connection used for Stack 7 exposes branch/ruleset reads but no safe branch-protection/ruleset write operation. Therefore Stack 7 cannot legitimately mark protection as enabled. A repository administrator must apply the settings above and then verify them through GitHub before the health status can move from `PARTIAL` to `PASS` on this item.
