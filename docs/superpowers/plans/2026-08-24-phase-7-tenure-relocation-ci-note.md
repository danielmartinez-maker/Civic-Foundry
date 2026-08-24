# CI-backed execution note

The execution environment cannot clone GitHub directly, so pull-request GitHub Actions is the authoritative RED/GREEN harness for this branch. No production behavior is considered verified until the exact branch head passes Tests, Typecheck, Lint, and Build.
