export type ServiceDepartment = 'fire' | 'police' | 'healthcare' | 'education' | 'garbage';
export type ServiceVehicleType = 'fire_engine' | 'patrol_car' | 'ambulance' | 'garbage_truck';
export type ServiceFacilityType = 'fire_station' | 'police_station' | 'clinic' | 'elementary_school' | 'landfill' | 'recycling_center';

export type ServiceDefinition = Readonly<{
  id: ServiceFacilityType;
  label: string;
  department: ServiceDepartment;
  vehicleType: ServiceVehicleType | null;
  baseVehicleCount: number;
  baseCapacity: number;
  studentCapacity: number;
  constructionCost: number;
  monthlyOperatingCost: number;
  staffingRequired: number;
  dispatchTurnaroundTicks: number;
  processingEfficiency: number;
}>;

export const SERVICE_DEFINITIONS: Readonly<Record<ServiceFacilityType, ServiceDefinition>> = Object.freeze({
  fire_station: Object.freeze({
    id: 'fire_station', label: 'Fire Station', department: 'fire', vehicleType: 'fire_engine', baseVehicleCount: 2,
    baseCapacity: 2, studentCapacity: 0, constructionCost: 20_000, monthlyOperatingCost: 300, staffingRequired: 12,
    dispatchTurnaroundTicks: 10, processingEfficiency: 1,
  }),
  police_station: Object.freeze({
    id: 'police_station', label: 'Police Station', department: 'police', vehicleType: 'patrol_car', baseVehicleCount: 2,
    baseCapacity: 3, studentCapacity: 0, constructionCost: 18_000, monthlyOperatingCost: 260, staffingRequired: 10,
    dispatchTurnaroundTicks: 8, processingEfficiency: 1,
  }),
  clinic: Object.freeze({
    id: 'clinic', label: 'Clinic', department: 'healthcare', vehicleType: 'ambulance', baseVehicleCount: 1,
    baseCapacity: 20, studentCapacity: 0, constructionCost: 22_000, monthlyOperatingCost: 320, staffingRequired: 14,
    dispatchTurnaroundTicks: 12, processingEfficiency: 1,
  }),
  elementary_school: Object.freeze({
    id: 'elementary_school', label: 'Elementary School', department: 'education', vehicleType: null, baseVehicleCount: 0,
    baseCapacity: 120, studentCapacity: 120, constructionCost: 16_000, monthlyOperatingCost: 240, staffingRequired: 12,
    dispatchTurnaroundTicks: 0, processingEfficiency: 1,
  }),
  landfill: Object.freeze({
    id: 'landfill', label: 'Landfill', department: 'garbage', vehicleType: 'garbage_truck', baseVehicleCount: 2,
    baseCapacity: 90, studentCapacity: 0, constructionCost: 10_000, monthlyOperatingCost: 140, staffingRequired: 8,
    dispatchTurnaroundTicks: 8, processingEfficiency: 1,
  }),
  recycling_center: Object.freeze({
    id: 'recycling_center', label: 'Recycling Center', department: 'garbage', vehicleType: 'garbage_truck', baseVehicleCount: 2,
    baseCapacity: 70, studentCapacity: 0, constructionCost: 14_000, monthlyOperatingCost: 190, staffingRequired: 10,
    dispatchTurnaroundTicks: 8, processingEfficiency: 1.15,
  }),
});
