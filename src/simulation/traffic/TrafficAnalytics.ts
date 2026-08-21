import { clamp01 } from '../core/types.ts';
import type { EdgeTrafficMetric, TripOutcome } from './TrafficSystem.ts';

export type TrafficAnalyticsSnapshot = Readonly<{
  activeVehicleCount: number;
  averageCommuteTicks: number;
  averageNetworkSpeed: number;
  congestionIndex: number;
  delayedTripShare: number;
  jobAccessibility: number;
  commercialAccessibility: number;
  worstBottlenecks: readonly string[];
}>;

export class TrafficAnalytics {
  evaluate(edgeMetrics: readonly EdgeTrafficMetric[], outcomes: readonly TripOutcome[], activeVehicleCount: number): TrafficAnalyticsSnapshot {
    const weightedVolume = edgeMetrics.reduce((sum, metric) => sum + metric.weightedVehicles, 0);
    const averageNetworkSpeed = weightedVolume === 0
      ? 0
      : edgeMetrics.reduce((sum, metric) => sum + metric.averageSpeedCellsPerSecond * metric.weightedVehicles, 0) / weightedVolume;
    const congestionIndex = weightedVolume === 0
      ? 0
      : edgeMetrics.reduce((sum, metric) => sum + metric.congestion * metric.weightedVehicles, 0) / weightedVolume;

    const commuteSuccesses = outcomes.filter((outcome) => outcome.purpose === 'commute' && outcome.success);
    const commuteWeight = commuteSuccesses.reduce((sum, outcome) => sum + outcome.travelerWeight, 0);
    const averageCommuteTicks = commuteWeight === 0
      ? 0
      : commuteSuccesses.reduce((sum, outcome) => sum + outcome.actualTravelTicks * outcome.travelerWeight, 0) / commuteWeight;

    const totalOutcomeWeight = outcomes.reduce((sum, outcome) => sum + outcome.travelerWeight, 0);
    const delayedWeight = outcomes
      .filter((outcome) => !outcome.success || outcome.actualTravelTicks > outcome.freeFlowTicks * 1.25)
      .reduce((sum, outcome) => sum + outcome.travelerWeight, 0);
    const delayedTripShare = totalOutcomeWeight === 0 ? 0 : delayedWeight / totalOutcomeWeight;

    const worstBottlenecks = edgeMetrics
      .filter((metric) => metric.weightedVehicles > 0)
      .slice()
      .sort((a, b) => (b.congestion * b.weightedVehicles) - (a.congestion * a.weightedVehicles) || a.edgeId.localeCompare(b.edgeId))
      .slice(0, 5)
      .map((metric) => metric.edgeId);

    return {
      activeVehicleCount,
      averageCommuteTicks,
      averageNetworkSpeed,
      congestionIndex: clamp01(congestionIndex),
      delayedTripShare: clamp01(delayedTripShare),
      jobAccessibility: this.purposeAccessibility(outcomes, 'commute'),
      commercialAccessibility: this.purposeAccessibility(outcomes, 'shopping'),
      worstBottlenecks,
    };
  }

  private purposeAccessibility(outcomes: readonly TripOutcome[], purpose: TripOutcome['purpose']): number {
    const relevant = outcomes.filter((outcome) => outcome.purpose === purpose);
    if (relevant.length === 0) return 1;
    const totalWeight = relevant.reduce((sum, outcome) => sum + outcome.travelerWeight, 0);
    if (totalWeight <= 0) return 1;
    const score = relevant.reduce((sum, outcome) => {
      if (!outcome.success) return sum;
      const travelQuality = outcome.actualTravelTicks <= 0 ? 1 : clamp01(outcome.freeFlowTicks / outcome.actualTravelTicks);
      return sum + travelQuality * outcome.travelerWeight;
    }, 0);
    return clamp01(score / totalWeight);
  }
}
