import type { MobilityAlternative, MobilityChoiceOutcome } from './MobilityTypes.ts';

const compareAlternatives = (a: MobilityAlternative, b: MobilityAlternative): number =>
  a.cost.generalizedCost - b.cost.generalizedCost
  || a.providerPriority - b.providerPriority
  || a.mode.localeCompare(b.mode)
  || a.id.localeCompare(b.id);

export class MobilityChoiceSystem {
  choose(alternatives: readonly MobilityAlternative[]): MobilityChoiceOutcome {
    if (alternatives.length === 0) return Object.freeze({ outcome: 'unmet', alternative: null });
    const winner = [...alternatives].sort(compareAlternatives)[0];
    if (!winner) return Object.freeze({ outcome: 'unmet', alternative: null });
    return Object.freeze({ outcome: winner.mode, alternative: winner });
  }
}
