import type { AssetOrientation } from './AssetTypes.ts';
import type { QuarterTurn } from '../isometric/IsometricProjection.ts';
import { stableHash32 } from './VariantSelector.ts';

export function vehicleOrientationFromWorldDelta(dx: number, dy: number, cameraTurn: QuarterTurn): AssetOrientation {
  let base: AssetOrientation;
  if (Math.abs(dx) >= Math.abs(dy)) base = dx >= 0 ? 0 : 2;
  else base = dy >= 0 ? 1 : 3;
  return ((base + cameraTurn) % 4) as AssetOrientation;
}

export function privateVehicleVariantKey(vehicleId: string): 'vehicle_sedan_01' | 'vehicle_suv_01' {
  return stableHash32(vehicleId) % 3 === 0 ? 'vehicle_suv_01' : 'vehicle_sedan_01';
}

export function serviceVehicleVariantKey(type: string): string {
  if (type === 'fire_engine') return 'vehicle_fire_engine_01';
  if (type === 'ambulance') return 'vehicle_ambulance_01';
  if (type === 'patrol_car') return 'vehicle_police_01';
  return 'vehicle_garbage_truck_01';
}

export function transitVehicleVariantKey(mode: string): string | null {
  if (mode === 'bus') return 'vehicle_bus_01';
  if (mode === 'brt') return 'vehicle_brt_01';
  if (mode === 'tram') return 'vehicle_tram_01';
  return null;
}
