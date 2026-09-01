import assert from "node:assert/strict";
import test from "node:test";

import { MovementAwarePathfindingSystem } from "../src/simulation/transportation/MovementAwarePathfindingSystem.ts";
import {
  routingStateKey,
  type RoutingArc,
  type RoutingState,
  type RoutingTopology,
} from "../src/simulation/transportation/RoutingTopology.ts";
import { VEHICLE_PERMISSION } from "../src/simulation/transportation/TransportNetworkTypes.ts";

function state(
  junctionId: string,
  incomingCarriagewayId?: string,
): RoutingState {
  return incomingCarriagewayId
    ? { junctionId, incomingCarriagewayId }
    : { junctionId };
}

function arc(
  id: string,
  from: RoutingState,
  toJunctionId: string,
  carriagewayId: string,
  cost: number,
  permissions = VEHICLE_PERMISSION.privateCar | VEHICLE_PERMISSION.bus,
  movementId?: string,
): RoutingArc {
  return {
    id,
    fromStateKey: routingStateKey(from),
    toState: state(toJunctionId, carriagewayId),
    carriagewayId,
    laneGroupIds: [`lg:${carriagewayId}`],
    ...(movementId === undefined ? {} : { movementId }),
    permissions,
    traversalTicks: cost,
    movementPenaltyTicks: 0,
  };
}

function topology(
  revision: number,
  arcs: readonly RoutingArc[],
  extraStates: readonly RoutingState[] = [],
): RoutingTopology {
  const statesByKey = new Map<string, RoutingState>();
  for (const item of extraStates)
    statesByKey.set(routingStateKey(item), item);
  for (const item of arcs) {
    const [junctionId, incoming] = item.fromStateKey.split("|");
    statesByKey.set(
      item.fromStateKey,
      state(junctionId!, incoming === "-" ? undefined : incoming),
    );
    statesByKey.set(routingStateKey(item.toState), item.toState);
    statesByKey.set(
      routingStateKey(state(item.toState.junctionId)),
      state(item.toState.junctionId),
    );
  }
  const outgoing = new Map<string, RoutingArc[]>();
  for (const item of [...arcs].sort((a, b) => a.id.localeCompare(b.id))) {
    const list = outgoing.get(item.fromStateKey) ?? [];
    list.push(item);
    outgoing.set(item.fromStateKey, list);
  }
  const sortedArcs = [...arcs].sort((a, b) => a.id.localeCompare(b.id));
  return {
    revision,
    states: [...statesByKey.values()].sort((a, b) =>
      routingStateKey(a).localeCompare(routingStateKey(b)),
    ),
    arcs: sortedArcs,
    outgoingArcs(current: RoutingState): readonly RoutingArc[] {
      return outgoing.get(routingStateKey(current)) ?? [];
    },
  };
}

const CAR = VEHICLE_PERMISSION.privateCar;
const BUS = VEHICLE_PERMISSION.bus;

test("direct movement-aware route returns ordered junction carriageway and movement identity", () => {
  const a = state("A");
  const bEntered = state("B", "c:AB");
  const graph = topology(
    1,
    [
      arc("a:AB", a, "B", "c:AB", 3),
      arc(
        "a:BD",
        bEntered,
        "D",
        "c:BD",
        4,
        CAR | BUS,
        "m:B:c:AB>c:BD",
      ),
    ],
    [state("D")],
  );
  const finder = new MovementAwarePathfindingSystem();

  const route = finder.findRoute(graph, "A", "D", {
    permissions: CAR,
    costEpoch: 0,
  });
  assert.deepEqual(route, {
    junctionIds: ["A", "B", "D"],
    carriagewayIds: ["c:AB", "c:BD"],
    movementIds: ["m:B:c:AB>c:BD"],
    totalCost: 7,
  });
});

test("missing prohibited left movement forces the legal detour", () => {
  const graph = topology(
    2,
    [
      arc("a:AB", state("A"), "B", "c:AB", 1),
      arc(
        "a:BC",
        state("B", "c:AB"),
        "C",
        "c:BC",
        1,
        CAR,
        "m:B:through",
      ),
      arc(
        "a:CD",
        state("C", "c:BC"),
        "D",
        "c:CD",
        1,
        CAR,
        "m:C:right",
      ),
    ],
    [state("D")],
  );
  const finder = new MovementAwarePathfindingSystem();

  assert.deepEqual(
    finder.findRoute(graph, "A", "D", { permissions: CAR, costEpoch: 0 })
      ?.junctionIds,
    ["A", "B", "C", "D"],
  );
});

test("one-way disconnected reverse request returns null", () => {
  const graph = topology(
    3,
    [arc("a:AB", state("A"), "B", "c:AB", 1)],
    [state("B")],
  );
  const finder = new MovementAwarePathfindingSystem();
  assert.equal(
    finder.findRoute(graph, "B", "A", { permissions: CAR, costEpoch: 0 }),
    null,
  );
});

test("bus-only shortcut is rejected for private cars and accepted for buses", () => {
  const graph = topology(
    4,
    [
      arc("a:AD-bus", state("A"), "D", "c:AD", 1, BUS),
      arc("a:AB", state("A"), "B", "c:AB", 4, CAR | BUS),
      arc(
        "a:BD",
        state("B", "c:AB"),
        "D",
        "c:BD",
        4,
        CAR | BUS,
        "m:B:c:AB>c:BD",
      ),
    ],
    [state("D")],
  );
  const finder = new MovementAwarePathfindingSystem();

  assert.deepEqual(
    finder.findRoute(graph, "A", "D", { permissions: CAR, costEpoch: 0 })
      ?.carriagewayIds,
    ["c:AB", "c:BD"],
  );
  assert.deepEqual(
    finder.findRoute(graph, "A", "D", { permissions: BUS, costEpoch: 0 })
      ?.carriagewayIds,
    ["c:AD"],
  );
});

test("equal-cost alternatives use deterministic state and arc tie breaking", () => {
  const graph = topology(
    5,
    [
      arc("a:AC", state("A"), "C", "c:AC", 1),
      arc("a:AB", state("A"), "B", "c:AB", 1),
      arc("a:CD", state("C", "c:AC"), "D", "c:CD", 1, CAR, "m:C"),
      arc("a:BD", state("B", "c:AB"), "D", "c:BD", 1, CAR, "m:B"),
    ],
    [state("D")],
  );
  const finder = new MovementAwarePathfindingSystem();

  const first = finder.findRoute(graph, "A", "D", {
    permissions: CAR,
    costEpoch: 0,
  });
  finder.clearCache();
  const second = finder.findRoute(graph, "A", "D", {
    permissions: CAR,
    costEpoch: 0,
  });
  assert.deepEqual(first, second);
  assert.deepEqual(first?.junctionIds, ["A", "B", "D"]);
});

test("origin equals destination is a zero-cost route", () => {
  const graph = topology(6, [], [state("A")]);
  const finder = new MovementAwarePathfindingSystem();
  assert.deepEqual(
    finder.findRoute(graph, "A", "A", { permissions: CAR, costEpoch: 0 }),
    {
      junctionIds: ["A"],
      carriagewayIds: [],
      movementIds: [],
      totalCost: 0,
    },
  );
});

test("cache keys separate topology revision cost epoch permissions and custom cost identity", () => {
  const graph = topology(
    10,
    [arc("a:AB", state("A"), "B", "c:AB", 2)],
    [state("B")],
  );
  const finder = new MovementAwarePathfindingSystem();
  const options = { permissions: CAR, costEpoch: 3 } as const;

  assert.ok(finder.findRoute(graph, "A", "B", options));
  assert.ok(finder.findRoute(graph, "A", "B", options));
  assert.equal(finder.diagnostics.cacheHits, 1);
  assert.equal(finder.diagnostics.cacheMisses, 1);

  assert.ok(
    finder.findRoute(graph, "A", "B", { ...options, costEpoch: 4 }),
  );
  assert.equal(finder.diagnostics.cacheMisses, 2);

  assert.ok(
    finder.findRoute(graph, "A", "B", { permissions: BUS, costEpoch: 4 }),
  );
  assert.equal(finder.diagnostics.cacheMisses, 3);

  const custom = (item: RoutingArc) => item.traversalTicks + 1;
  assert.ok(
    finder.findRoute(graph, "A", "B", { ...options, arcCost: custom }),
  );
  assert.ok(
    finder.findRoute(graph, "A", "B", { ...options, arcCost: custom }),
  );
  assert.equal(
    finder.diagnostics.cacheHits,
    1,
    "unc keyed custom costs must not cache",
  );

  assert.ok(
    finder.findRoute(graph, "A", "B", {
      ...options,
      arcCost: custom,
      costKey: "plus-one",
    }),
  );
  assert.ok(
    finder.findRoute(graph, "A", "B", {
      ...options,
      arcCost: custom,
      costKey: "plus-one",
    }),
  );
  assert.equal(finder.diagnostics.cacheHits, 2);

  const nextRevision = topology(11, graph.arcs, [state("A"), state("B")]);
  assert.ok(finder.findRoute(nextRevision, "A", "B", options));
  assert.equal(finder.diagnostics.cacheMisses, 7);
});

test("negative and non-finite custom arc costs are not routable", () => {
  const graph = topology(
    12,
    [arc("a:AB", state("A"), "B", "c:AB", 2)],
    [state("B")],
  );
  const finder = new MovementAwarePathfindingSystem();
  assert.equal(
    finder.findRoute(graph, "A", "B", {
      permissions: CAR,
      costEpoch: 0,
      arcCost: () => -1,
    }),
    null,
  );
  assert.equal(
    finder.findRoute(graph, "A", "B", {
      permissions: CAR,
      costEpoch: 0,
      arcCost: () => Number.NaN,
    }),
    null,
  );
});
