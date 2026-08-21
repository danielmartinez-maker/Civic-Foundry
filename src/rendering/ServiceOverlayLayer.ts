import type { SimulationCore } from '../simulation/core/SimulationCore.ts';

export type ServiceOverlayMode = 'none' | 'quality' | 'fire' | 'police' | 'healthcare' | 'education' | 'garbage';
export type ServiceOverlayCell = Readonly<{ buildingId: string; x: number; y: number; value: number; label: string }>;
export type ServiceOverlaySnapshot = Readonly<{ mode: ServiceOverlayMode; cells: readonly ServiceOverlayCell[]; legend: string }>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function mapServiceOverlay(core: SimulationCore, mode: ServiceOverlayMode): ServiceOverlaySnapshot {
  const cells = core.buildings.occupied().map((building): ServiceOverlayCell => {
    const quality = core.neighborhoodSnapshot.perBuilding[building.id];
    const value = mode === 'quality' ? quality?.combinedServiceQuality ?? 0
      : mode === 'fire' ? quality?.fireSafety ?? 0
      : mode === 'police' ? quality?.policeSafety ?? 0
      : mode === 'healthcare' ? quality?.healthcareAccess ?? 0
      : mode === 'education' ? quality?.educationAccess ?? 0
      : mode === 'garbage' ? quality?.garbageCleanliness ?? 0
      : 0;
    const normalized = clamp01(value);
    return { buildingId: building.id, x: building.x, y: building.y, value: normalized, label: `${Math.round(normalized * 100)}%` };
  }).sort((a, b) => a.buildingId.localeCompare(b.buildingId));
  const labels: Record<ServiceOverlayMode, string> = {
    none: 'Service overlay off.',
    quality: 'Combined service quality: 0% unserved → 100% well served.',
    fire: 'Fire safety: 0% poor response/access → 100% strong protection.',
    police: 'Police safety: 0% poor response/access → 100% strong protection.',
    healthcare: 'Healthcare access: 0% unreachable/saturated → 100% strong access.',
    education: 'Education access: 0% unreachable/overcrowded → 100% strong access.',
    garbage: 'Garbage cleanliness: 0% severe collection failure → 100% reliable collection.',
  };
  return Object.freeze({ mode, cells: Object.freeze(cells), legend: labels[mode] });
}
