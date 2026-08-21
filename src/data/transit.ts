export type TransitMode = 'bus' | 'brt' | 'tram' | 'metro';
export type TransitStopType = 'surface_stop' | 'metro_station';

export type TransitModeDefinition = Readonly<{
  id: TransitMode;
  label: string;
  defaultHeadwayTicks: number;
  defaultFare: number;
  vehicleCapacity: number;
  dwellTicks: number;
  surfaceRunning: boolean;
  stopType: TransitStopType;
}>;

export type TransitStopDefinition = Readonly<{
  id: TransitStopType;
  label: string;
  constructionCost: number;
}>;

export const TRANSIT_MODE_DEFINITIONS: Readonly<Record<TransitMode, TransitModeDefinition>> = Object.freeze({
  bus: Object.freeze({ id: 'bus', label: 'Bus', defaultHeadwayTicks: 80, defaultFare: 2, vehicleCapacity: 60, dwellTicks: 6, surfaceRunning: true, stopType: 'surface_stop' }),
  brt: Object.freeze({ id: 'brt', label: 'BRT', defaultHeadwayTicks: 60, defaultFare: 2.5, vehicleCapacity: 110, dwellTicks: 8, surfaceRunning: true, stopType: 'surface_stop' }),
  tram: Object.freeze({ id: 'tram', label: 'Tram', defaultHeadwayTicks: 90, defaultFare: 2.5, vehicleCapacity: 140, dwellTicks: 10, surfaceRunning: true, stopType: 'surface_stop' }),
  metro: Object.freeze({ id: 'metro', label: 'Metro', defaultHeadwayTicks: 50, defaultFare: 3, vehicleCapacity: 600, dwellTicks: 12, surfaceRunning: false, stopType: 'metro_station' }),
});

export const TRANSIT_STOP_DEFINITIONS: Readonly<Record<TransitStopType, TransitStopDefinition>> = Object.freeze({
  surface_stop: Object.freeze({ id: 'surface_stop', label: 'Surface Stop', constructionCost: 500 }),
  metro_station: Object.freeze({ id: 'metro_station', label: 'Metro Station', constructionCost: 6_000 }),
});

export const TRANSIT_LIMITS = Object.freeze({
  minHeadwayTicks: 20,
  maxHeadwayTicks: 600,
  minFare: 0,
  maxFare: 20,
});
