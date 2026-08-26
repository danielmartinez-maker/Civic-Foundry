import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { CellCoord, ZoneType } from '../simulation/core/types.ts';
import type { RoadType } from '../data/roads.ts';
import type { UtilityFacilityType } from '../data/utilities.ts';
import type { ServiceFacilityType } from '../data/services.ts';
import { LEGACY_CELL_SIZE_METERS, pointInPolygon } from '../world/cadastre/Geometry.ts';

export type ToolId =
  | 'inspect'
  | 'road-local' | 'road-collector' | 'road-arterial'
  | 'zone-residential' | 'zone-commercial' | 'zone-industrial'
  | 'power' | 'water' | 'landfill'
  | 'service-fire' | 'service-police' | 'service-clinic' | 'service-school' | 'service-landfill' | 'service-recycling'
  | 'transit-stop' | 'transit-metro-station'
  | 'bulldoze';

export type ToolApplyResult = Readonly<{ ok: boolean; reason?: string }>;

const roadType = (tool: ToolId): RoadType | undefined => tool.startsWith('road-') ? tool.slice(5) as RoadType : undefined;
const zoneType = (tool: ToolId): ZoneType | undefined => tool.startsWith('zone-') ? tool.slice(5) as ZoneType : undefined;
const utilityType = (tool: ToolId): UtilityFacilityType | undefined => ['power', 'water', 'landfill'].includes(tool) ? tool as UtilityFacilityType : undefined;
const SERVICE_TOOL_TYPES: Partial<Record<ToolId, ServiceFacilityType>> = {
  'service-fire': 'fire_station', 'service-police': 'police_station', 'service-clinic': 'clinic',
  'service-school': 'elementary_school', 'service-landfill': 'landfill', 'service-recycling': 'recycling_center',
};

export class ToolController {
  activeTool: ToolId = 'inspect';

  setTool(tool: ToolId): void {
    this.activeTool = tool;
  }

  parcelIdAt(core: SimulationCore, x: number, y: number): string | null {
    const point = {
      x: (x + 0.5) * LEGACY_CELL_SIZE_METERS,
      y: (y + 0.5) * LEGACY_CELL_SIZE_METERS,
    };
    for (const parcel of core.cadastre.listParcels()) {
      if (pointInPolygon(point, core.cadastre.parcelPolygon(parcel.id))) return parcel.id;
    }
    return null;
  }

  applyPath(core: SimulationCore, cells: readonly CellCoord[]): ToolApplyResult {
    const type = roadType(this.activeTool);
    if (!type) return { ok: false, reason: 'active tool is not a road tool' };
    const result = core.buildRoad(cells, type);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'road placement failed' };
  }

  applyCell(core: SimulationCore, x: number, y: number): ToolApplyResult {
    const zone = zoneType(this.activeTool);
    if (zone) {
      const result = core.paintZone([{ x, y }], zone);
      return result.painted > 0 ? { ok: true } : { ok: false, reason: 'cell cannot be zoned' };
    }
    const service = SERVICE_TOOL_TYPES[this.activeTool];
    if (service) {
      const result = core.placeServiceFacility(service, x, y);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'service facility placement failed' };
    }
    if (this.activeTool === 'transit-stop' || this.activeTool === 'transit-metro-station') {
      const type = this.activeTool === 'transit-metro-station' ? 'metro_station' : 'surface_stop';
      const result = core.transit.placeStop(type, x, y, core.treasury);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'transit stop placement failed' };
    }
    const utility = utilityType(this.activeTool);
    if (utility) {
      const result = core.placeUtility(utility, x, y);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'facility placement failed' };
    }
    if (this.activeTool === 'bulldoze') {
      const result = core.bulldozeAt(x, y);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'bulldoze failed' };
    }
    if (this.activeTool === 'inspect') return { ok: true };
    return { ok: false, reason: 'road tools require a path' };
  }
}
