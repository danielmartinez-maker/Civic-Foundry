import {
  polygonArea,
  polygonDifference,
} from '../../world/cadastre/Geometry.ts';
import type {
  ParcelDevelopmentEnvelope,
  ZoningCandidate,
  ZoningComplianceResult,
  ZoningConstraint,
} from './ZoningTypes.ts';

const AREA_TOLERANCE_M2 = 0.01;
const NUMERIC_TOLERANCE = 1e-9;

export class ZoningComplianceSystem {
  evaluate(candidate: ZoningCandidate, envelope: ParcelDevelopmentEnvelope): ZoningComplianceResult {
    const violations: ZoningConstraint[] = [];

    if (candidate.footprint.length < 3 || envelope.buildableFootprint.length < 3) {
      violations.push(violation('footprint', 'inside-buildable-envelope', 'no-buildable-footprint', envelope.districtId));
    } else {
      const outside = polygonDifference(candidate.footprint, envelope.buildableFootprint)
        .reduce((sum, ring) => sum + polygonArea(ring), 0);
      if (outside > AREA_TOLERANCE_M2) {
        violations.push(violation('footprint', AREA_TOLERANCE_M2, outside, envelope.districtId));
      }
    }

    if (candidate.realizedFAR > envelope.effectiveFAR + NUMERIC_TOLERANCE) {
      violations.push(violation('far', envelope.effectiveFAR, candidate.realizedFAR, envelope.districtId));
    }
    if (candidate.coverageRatio > envelope.effectiveCoverageRatio + NUMERIC_TOLERANCE) {
      violations.push(violation('coverage', envelope.effectiveCoverageRatio, candidate.coverageRatio, envelope.districtId));
    }
    if (candidate.heightMeters > envelope.maxHeightMeters + NUMERIC_TOLERANCE) {
      violations.push(violation('height', envelope.maxHeightMeters, candidate.heightMeters, envelope.districtId));
    }
    if (candidate.stories > envelope.maxStories) {
      violations.push(violation('stories', envelope.maxStories, candidate.stories, envelope.districtId));
    }

    const permitted = new Set(envelope.permittedUses);
    for (const use of [...new Set(candidate.uses)].sort()) {
      if (!permitted.has(use)) violations.push(violation('use', envelope.permittedUses.join(','), use, envelope.districtId));
    }

    return Object.freeze({
      legal: violations.length === 0,
      violations: Object.freeze(violations.sort(compareViolations)),
    });
  }
}

function violation(
  code: ZoningConstraint['code'],
  limit: number | string,
  actual: number | string,
  sourceId: string,
): ZoningConstraint {
  return Object.freeze({ code, limit, actual, sourceId });
}

function compareViolations(left: ZoningConstraint, right: ZoningConstraint): number {
  return left.code.localeCompare(right.code)
    || String(left.actual ?? '').localeCompare(String(right.actual ?? ''));
}
