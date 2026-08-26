# 3R-B Intersection Control — Save V9 Amendment

Date: 2026-08-25
Status: Approved-design correction based on repository state
Applies to: `2026-08-25-transportation-engine-2.0-intersection-control-design.md`

## Reason for amendment

The approved 3R-B design was written against `docs/SAVE_FORMAT.md`, which still described Save V7 as canonical. Repository inspection during implementation planning confirmed that runtime persistence has already advanced to Save V8 for World Foundation:

- `src/save/save.ts` emits and hydrates `SaveV8` by default;
- `src/save/saveV8.ts` owns `saveVersion: 8` and `gameVersion: '0.8.0-world-foundation'`.

3R-B therefore must not reuse Save V8 for a materially different intersection-control schema.

## Authoritative correction

Every reference in the 3R-B design to:

- “Save V8” as the new 3R-B canonical format becomes **Save V9**;
- “V7 → V8 migration” for 3R-B becomes **V8 → V9 migration**;
- V7 intersection queue migration is still required indirectly because V7 and older saves remain supported by the existing legacy hydration chain into the current V8 model before 3R-B state is created.

The intended canonical envelope is:

```ts
type SaveV9 = Omit<SaveV8, 'saveVersion' | 'gameVersion' | 'intersections'> & Readonly<{
  saveVersion: 9;
  gameVersion: '0.9.0-intersection-control';
  intersectionControl: IntersectionControlSnapshot;
}>;
```

The exact structural omission of legacy `intersections` may be implemented through an equivalent type composition, but canonical V9 must not persist the old node-capacity queue as a second live authority.

## V8 → V9 migration

Migration must:

1. hydrate the complete existing V8 world/city state using the established V8 rules;
2. rebuild the 3R-A transportation authority and lane groups from restored roads;
3. build deterministic U.S.-style 3R-B control plans;
4. map every persisted legacy intersection queue entry to the active vehicle's current-edge + next-edge route continuation and therefore to an explicit `TurnMovementId`;
5. derive valid lane-group references for that movement;
6. preserve traveler weight, queue arrival tick, emergency priority, and pending-released semantics exactly once;
7. validate queued traffic vehicles and queued service vehicles against the migrated queue state;
8. initialize signal runtime deterministically from restored tick, canonical timing plan, and coordination offset when no historical signal runtime exists;
9. initialize pedestrian occupancy empty because V8 has no equivalent authoritative state;
10. reject inconsistent/orphaned queue references rather than silently dropping them.

Older saves continue through existing V3–V8 compatibility paths. V8 remains a supported legacy load format after V9 becomes canonical.

## V9 persistence authority

V9 persists the canonical built control plans and all controller continuation state required for exact resume, including movement queues, pending releases, stop-compliance state, signal phase/cycle state, pedestrian runtime state, priority/preemption requests, control overrides, coordination state, and control revisions.

Derived conflict matrices, lane groups, and compatibility lookup indexes remain rebuildable and are not persisted.

## Scope

This amendment changes only the save-version number and migration baseline required by actual repository state. All approved 3R-B functional and architectural decisions remain unchanged.