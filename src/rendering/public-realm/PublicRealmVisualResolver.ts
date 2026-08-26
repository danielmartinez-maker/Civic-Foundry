import type { AssetOrientation } from '../assets/AssetTypes.ts';
import type {
  ParkingForm,
  PublicRealmContext,
  PublicRealmDescriptor,
  PublicRealmProfile,
  WorldFacing,
} from './PublicRealmTypes.ts';

export function resolvePublicRealmProfile(context: PublicRealmContext): PublicRealmProfile | undefined {
  if (context.kind === 'facility') {
    return context.facilityType === 'landfill' || context.facilityType === 'recycling_center'
      ? 'industrial-logistics'
      : 'civic-public-space';
  }

  const uses = new Set(context.uses);
  if (uses.has('civic')) return 'civic-public-space';
  if (uses.has('light-industrial') || uses.has('heavy-industrial') || uses.has('logistics')) {
    return 'industrial-logistics';
  }
  if (context.typologyId === 'main_street_mixed_use' || context.typologyId === 'typology:commercial_block') {
    return 'main-street';
  }
  if (context.typologyId === 'podium_mixed_use' || context.typologyId === 'typology:commercial_office') {
    return 'urban-core';
  }
  if (uses.has('retail') && context.stories >= 2 && context.stories <= 7 && context.coverageRatio > 0.35) {
    return 'main-street';
  }
  if (context.stories >= 8 || context.realizedFAR >= 3) return 'urban-core';
  if (context.typologyId === 'typology:residential_cottage' || context.typologyId === 'typology:residential_rowhouse') {
    return 'residential-green';
  }
  if (context.uses.length > 0 && context.uses.every((use) => use === 'residential') && context.stories <= 4) {
    return 'residential-green';
  }

  const compatibleUse = [...uses].some((use) =>
    use === 'residential' || use === 'retail' || use === 'office' || use === 'hospitality');
  if (compatibleUse && (context.coverageRatio <= 0.35 || context.typologyId === 'typology:commercial_shop')) {
    return 'suburban-auto-oriented';
  }
  if (context.uses.length > 0 && context.uses.every((use) => use === 'residential')) return 'residential-green';
  if ([...uses].some((use) => use === 'retail' || use === 'office' || use === 'hospitality')) {
    return 'suburban-auto-oriented';
  }
  return undefined;
}

export function resolveParkingForm(context: PublicRealmContext, profile: PublicRealmProfile): ParkingForm {
  if (context.kind === 'facility') return 'none';

  const garageEligible = context.typologyId === 'podium_mixed_use'
    || context.typologyId === 'typology:commercial_office'
    || context.stories >= 8;
  if (garageEligible && context.hasAccessEdge) return 'garage-entry';
  if (profile === 'suburban-auto-oriented' && context.coverageRatio <= 0.35) return 'surface-lot-edge';
  if (profile === 'residential-green' && context.hasAccessEdge) return 'driveway';

  const curbsideEligible = (context.roadType === 'local' || context.roadType === 'collector')
    && (profile === 'main-street' || profile === 'residential-green')
    && !context.atIntersection
    && !context.curbsideSuppressedByGeometry;
  return curbsideEligible ? 'curbside-dressing' : 'none';
}

export function resolvePublicRealmDescriptor(context: PublicRealmContext): PublicRealmDescriptor | undefined {
  const profile = resolvePublicRealmProfile(context);
  if (!profile) return undefined;
  const key = context.selectionKey;
  return Object.freeze({
    context,
    profile,
    parkingForm: resolveParkingForm(context, profile),
    channelKeys: Object.freeze({
      surface: `${key}|surface`,
      access: `${key}|access`,
      vegetation: `${key}|vegetation`,
      furniture: `${key}|furniture`,
      parking: `${key}|parking`,
      accent: `${key}|accent`,
    }),
  });
}

export function rotateWorldFacing(facing: WorldFacing, quarterTurns: AssetOrientation): AssetOrientation {
  return ((facing + quarterTurns) % 4) as AssetOrientation;
}
