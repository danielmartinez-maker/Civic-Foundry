import test from 'node:test';
import assert from 'node:assert/strict';
import { polygonArea } from '../src/world/cadastre/Geometry.ts';
import type { Parcel } from '../src/world/cadastre/CadastralTypes.ts';
import type { ParcelDevelopmentEnvelope } from '../src/simulation/zoning/ZoningTypes.ts';
import { BuildingMassingSystem } from '../src/simulation/buildings/BuildingMassingSystem.ts';
import { calculateBuildingMetrics } from '../src/simulation/buildings/BuildingMetrics.ts';
import type { BuildingTypology } from '../src/data/buildingTypologies.ts';
import type { BuildingV2 } from '../src/simulation/buildings/BuildingTypes.ts';

const parcel: Parcel = {
  id: 'parcel:test:1',
  blockId: 'block:test',
  boundaryEdgeIds: ['e0', 'e1', 'e2', 'e3'],
  areaM2: 1_000,
  centroid: { x: 20, y: 12.5 },
  frontageEdgeIds: ['e0'],
  accessEdgeIds: ['e0'],
  zoningDistrictId: 'MU4',
  historicalParentIds: [],
};

const envelope: ParcelDevelopmentEnvelope = {
  parcelId: parcel.id,
  districtId: 'MU4',
  buildableFootprint: [
    { x: 2, y: 2 },
    { x: 38, y: 2 },
    { x: 38, y: 23 },
    { x: 2, y: 23 },
  ],
  parcelAreaM2: parcel.areaM2,
  frontageMeters: 40,
  maxFootprintAreaM2: 650,
  maxGrossFloorAreaM2: 4_000,
  maxHeightMeters: 42,
  maxStories: 12,
  allowedFAR: 4,
  effectiveFAR: 4,
  effectiveCoverageRatio: 0.65,
  permittedUses: ['residential', 'retail', 'office'],
  limitingConstraints: [],
};

const mixedUseTypology: BuildingTypology = {
  id: 'typology:mixed-main-street',
  name: 'Main Street Mixed Use',
  primaryUse: 'residential',
  allowedUses: ['residential', 'retail'],
  defaultUseMix: { residential: 0.8, retail: 0.2 },
  preferredStories: 6,
  minStories: 2,
  maxStories: 12,
  floorToFloorHeightMeters: 3.2,
  efficiencyRatio: 0.82,
  costPerM2: 2_100,
  maintenanceCostPerM2: 34,
  constructionTicksPer1000M2: 22,
  averageResidentialUnitAreaM2: 80,
  jobsPer1000M2ByUse: { retail: 35 },
  powerDemandPer1000M2: 28,
  waterDemandPer1000M2: 24,
  garbagePer1000M2: 9,
  taxBasePerM2: 310,
  baseRentPerM2ByUse: { residential: 260, retail: 380 },
  operatingExpenseRatio: 0.32,
  baseVacancy: 0.08,
  baseCapRate: 0.06,
  minimumAccess: 0.4,
  minimumUtilityRatio: 0.6,
  minimumServiceQuality: 0.4,
  complexityFactor: 1.08,
  riskWeight: 0.35,
};

test('massing generator returns deterministic legal candidates across target FAR utilization', () => {
  const system = new BuildingMassingSystem();
  const candidatesA = system.generate(parcel, envelope, [mixedUseTypology]);
  const candidatesB = system.generate(parcel, envelope, [mixedUseTypology]);

  assert.deepEqual(candidatesA, candidatesB);
  assert.ok(candidatesA.length >= 3);
  assert.deepEqual(candidatesA.map((candidate) => candidate.targetUtilization), [0.55, 0.75, 0.9, 1]);
  assert.ok(candidatesA.every((candidate) => candidate.zoningLegal));
  assert.ok(candidatesA.every((candidate) => candidate.realizedFAR <= envelope.effectiveFAR + 1e-9));
  assert.ok(candidatesA.every((candidate) => candidate.coverageRatio <= envelope.effectiveCoverageRatio + 1e-9));
  assert.ok(candidatesA.every((candidate) => candidate.heightMeters <= envelope.maxHeightMeters + 1e-9));
  assert.ok(candidatesA.every((candidate) => candidate.stories <= envelope.maxStories));
  assert.ok(candidatesA.every((candidate) => polygonArea(candidate.footprint) <= envelope.maxFootprintAreaM2 + 0.1));
});

test('mixed-use massing allocates usable floor area exactly across permitted uses', () => {
  const candidate = new BuildingMassingSystem().generate(parcel, envelope, [mixedUseTypology]).at(-1)!;
  const floorUseArea = candidate.floors.flatMap((floor) => floor.uses)
    .reduce((sum, allocation) => sum + allocation.floorAreaM2, 0);

  assert.equal(Math.round(floorUseArea * 100), Math.round(candidate.usableFloorAreaM2 * 100));
  assert.deepEqual(candidate.uses, ['residential', 'retail']);
  assert.ok(candidate.floors.some((floor) => floor.uses.some((allocation) => allocation.use === 'retail')));
  assert.ok(candidate.floors.some((floor) => floor.uses.some((allocation) => allocation.use === 'residential')));
});

test('mixed-use metrics derive residential units jobs utilities and tax base from floor area', () => {
  const building = buildingFixture();
  const metrics = calculateBuildingMetrics(building, mixedUseTypology);

  assert.equal(metrics.floorAreaByUse.residential, 1_600);
  assert.equal(metrics.floorAreaByUse.retail, 400);
  assert.equal(metrics.residentialUnits, 20);
  assert.equal(metrics.jobCapacity, 14);
  assert.equal(metrics.powerDemand, 56);
  assert.equal(metrics.waterDemand, 48);
  assert.equal(metrics.garbageGeneration, 18);
  assert.equal(metrics.taxBase, 620_000);
});

test('physical building lifecycle state is canonical and not duplicated on BuildingV2', () => {
  const building = buildingFixture();
  assert.equal(building.lifecycle.condition, 92);
  assert.equal(building.lifecycle.maintenanceBacklog, 0);
  assert.equal('condition' in building, false);
  assert.equal('maintenanceBacklog' in building, false);
});

function buildingFixture(): BuildingV2 {
  return {
    id: 'building:v2:test',
    parcelIds: [parcel.id],
    typologyId: mixedUseTypology.id,
    footprint: [
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 20 },
      { x: 5, y: 20 },
    ],
    grossFloorAreaM2: 2_439.0243902439024,
    usableFloorAreaM2: 2_000,
    heightMeters: 19.2,
    stories: 6,
    realizedFAR: 2.4390243902439024,
    coverageRatio: 0.3,
    floors: [
      {
        level: 1,
        elevationMeters: 0,
        grossAreaM2: 406.5040650406504,
        uses: [{ use: 'retail', floorAreaM2: 400, jobs: 14 }],
      },
      {
        level: 2,
        elevationMeters: 3.2,
        grossAreaM2: 406.5040650406504,
        uses: [{ use: 'residential', floorAreaM2: 320, residentialUnits: 4 }],
      },
      {
        level: 3,
        elevationMeters: 6.4,
        grossAreaM2: 406.5040650406504,
        uses: [{ use: 'residential', floorAreaM2: 320, residentialUnits: 4 }],
      },
      {
        level: 4,
        elevationMeters: 9.6,
        grossAreaM2: 406.5040650406504,
        uses: [{ use: 'residential', floorAreaM2: 320, residentialUnits: 4 }],
      },
      {
        level: 5,
        elevationMeters: 12.8,
        grossAreaM2: 406.5040650406504,
        uses: [{ use: 'residential', floorAreaM2: 320, residentialUnits: 4 }],
      },
      {
        level: 6,
        elevationMeters: 16,
        grossAreaM2: 406.5040650406504,
        uses: [{ use: 'residential', floorAreaM2: 320, residentialUnits: 4 }],
      },
    ],
    status: 'occupied',
    yearBuilt: 0,
    entitlement: {
      approvalTick: 0,
      zoningDistrictId: 'MU4',
      approvedFAR: 2.5,
      approvedHeightMeters: 20,
      approvedUses: ['residential', 'retail'],
    },
    lifecycle: {
      ageTicks: 0,
      condition: 92,
      structuralCondition: 95,
      systemsCondition: 90,
      exteriorCondition: 91,
      maintenanceBacklog: 0,
      deferredMaintenanceTicks: 0,
      effectiveAge: 0,
      vacancyDurationTicks: 0,
      distressScore: 0,
    },
    projectCost: 5_121_951,
  };
}
