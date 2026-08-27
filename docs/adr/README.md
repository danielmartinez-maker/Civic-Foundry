# Architecture Decision Records

Use an ADR when a decision changes repository-wide architecture, public module boundaries, persistence ownership, build/dependency strategy, asset authority, or another constraint that future contributors would otherwise have to rediscover.

## File naming

Use the next four-digit sequence and a short kebab-case title, for example:

`0002-adopt-import-map.md`

## Template

```markdown
# ADR NNNN: Decision title

- Status: Proposed | Accepted | Superseded
- Date: YYYY-MM-DD
- Supersedes: ADR NNNN (when applicable)

## Context

What problem or constraint requires a durable decision?

## Decision

What is being adopted, including important boundaries and exclusions?

## Consequences

What becomes easier, harder, required, or intentionally deferred?
```

ADRs record decisions rather than implementation logs. If a later decision replaces one, keep the old record and mark it `Superseded` with a link to the replacement.
