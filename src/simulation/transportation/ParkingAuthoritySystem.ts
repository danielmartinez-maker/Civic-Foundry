export type CurbRegulation =
  "none" | "metered" | "loading" | "permit" | "no-parking" | "time-limited";

export type ParkingFacility = Readonly<{
  id: string;
  destinationId: string;
  capacity: number;
  occupied: number;
  legal: boolean;
  pricePerTrip: number;
  baseSearchTicks: number;
  curbRegulation: CurbRegulation;
}>;

export type ParkingReservation = Readonly<{
  vehicleId: string;
  facilityId: string;
}>;

export type ParkingAuthoritySnapshot = Readonly<{
  facilities: readonly ParkingFacility[];
  reservations: readonly ParkingReservation[];
}>;

export type ParkingDestinationState = Readonly<{
  capacity: number;
  occupied: number;
  available: number;
  legalCapacity: number;
  pricePerTrip: number;
  searchPenaltyTicks: number;
  curbRegulations: readonly CurbRegulation[];
}>;

function safeCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
  return value;
}

function canonicalFacility(input: ParkingFacility): ParkingFacility {
  if (input.id.length === 0)
    throw new Error("parking facility id must be non-empty");
  if (input.destinationId.length === 0)
    throw new Error("parking destinationId must be non-empty");
  const capacity = safeCount(input.capacity, "parking capacity");
  const occupied = safeCount(input.occupied, "parking occupancy");
  if (occupied > capacity)
    throw new Error("parking occupancy cannot exceed capacity");
  return Object.freeze({
    ...input,
    capacity,
    occupied,
    pricePerTrip: finiteNonNegative(input.pricePerTrip, "parking pricePerTrip"),
    baseSearchTicks: finiteNonNegative(
      input.baseSearchTicks,
      "parking baseSearchTicks",
    ),
  });
}

export class ParkingAuthoritySystem {
  private readonly facilities = new Map<string, ParkingFacility>();
  private readonly reservationByVehicle = new Map<string, string>();

  upsert(facility: ParkingFacility): void {
    const canonical = canonicalFacility(facility);
    const reservationCount = [...this.reservationByVehicle.values()].filter(
      (facilityId) => facilityId === canonical.id,
    ).length;
    if (reservationCount > canonical.occupied) {
      throw new Error(
        "parking occupancy cannot drop below active reservations",
      );
    }
    this.facilities.set(canonical.id, canonical);
  }

  remove(facilityId: string): boolean {
    if ([...this.reservationByVehicle.values()].includes(facilityId))
      return false;
    return this.facilities.delete(facilityId);
  }

  reserve(destinationId: string, vehicleId: string): string | null {
    if (vehicleId.length === 0)
      throw new Error("parking vehicleId must be non-empty");
    if (this.reservationByVehicle.has(vehicleId))
      return this.reservationByVehicle.get(vehicleId) ?? null;

    const candidates = [...this.facilities.values()]
      .filter(
        (facility) =>
          facility.destinationId === destinationId &&
          facility.legal &&
          facility.curbRegulation !== "no-parking" &&
          facility.occupied < facility.capacity,
      )
      .sort(
        (a, b) =>
          a.pricePerTrip - b.pricePerTrip ||
          a.baseSearchTicks - b.baseSearchTicks ||
          a.id.localeCompare(b.id),
      );
    const selected = candidates[0];
    if (!selected) return null;

    this.facilities.set(
      selected.id,
      Object.freeze({ ...selected, occupied: selected.occupied + 1 }),
    );
    this.reservationByVehicle.set(vehicleId, selected.id);
    return selected.id;
  }

  release(vehicleId: string): boolean {
    const facilityId = this.reservationByVehicle.get(vehicleId);
    if (!facilityId) return false;
    const facility = this.facilities.get(facilityId);
    if (!facility || facility.occupied <= 0) {
      throw new Error("parking reservation references invalid occupancy");
    }
    this.facilities.set(
      facility.id,
      Object.freeze({ ...facility, occupied: facility.occupied - 1 }),
    );
    this.reservationByVehicle.delete(vehicleId);
    return true;
  }

  destinationState(destinationId: string): ParkingDestinationState {
    const matching = [...this.facilities.values()]
      .filter((facility) => facility.destinationId === destinationId)
      .sort((a, b) => a.id.localeCompare(b.id));
    const legal = matching.filter(
      (facility) => facility.legal && facility.curbRegulation !== "no-parking",
    );
    const capacity = matching.reduce(
      (total, facility) => total + facility.capacity,
      0,
    );
    const occupied = matching.reduce(
      (total, facility) => total + facility.occupied,
      0,
    );
    const legalCapacity = legal.reduce(
      (total, facility) => total + facility.capacity,
      0,
    );
    const legalOccupied = legal.reduce(
      (total, facility) => total + facility.occupied,
      0,
    );
    const available = Math.max(0, legalCapacity - legalOccupied);
    const pricePerTrip =
      legal.length > 0
        ? Math.min(...legal.map((facility) => facility.pricePerTrip))
        : 0;
    const baseSearchTicks =
      legalCapacity > 0
        ? legal.reduce(
            (total, facility) =>
              total + facility.baseSearchTicks * facility.capacity,
            0,
          ) / legalCapacity
        : 0;
    const occupancyRatio =
      legalCapacity > 0 ? legalOccupied / legalCapacity : 1;
    const searchPenaltyTicks = baseSearchTicks * (1 + occupancyRatio * 2);
    const curbRegulations = Object.freeze(
      [...new Set(legal.map((facility) => facility.curbRegulation))].sort(),
    );

    return Object.freeze({
      capacity,
      occupied,
      available,
      legalCapacity,
      pricePerTrip,
      searchPenaltyTicks,
      curbRegulations,
    });
  }

  snapshot(): ParkingAuthoritySnapshot {
    return Object.freeze({
      facilities: Object.freeze(
        [...this.facilities.values()].sort((a, b) => a.id.localeCompare(b.id)),
      ),
      reservations: Object.freeze(
        [...this.reservationByVehicle.entries()]
          .map(([vehicleId, facilityId]) =>
            Object.freeze({ vehicleId, facilityId }),
          )
          .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId)),
      ),
    });
  }

  restore(snapshot: ParkingAuthoritySnapshot): void {
    const facilities = new Map<string, ParkingFacility>();
    for (const facility of snapshot.facilities) {
      const canonical = canonicalFacility(facility);
      if (facilities.has(canonical.id))
        throw new Error(`duplicate parking facility id: ${canonical.id}`);
      facilities.set(canonical.id, canonical);
    }
    const reservations = new Map<string, string>();
    const reservationCounts = new Map<string, number>();
    for (const reservation of snapshot.reservations) {
      if (reservation.vehicleId.length === 0)
        throw new Error("parking reservation vehicleId must be non-empty");
      if (reservations.has(reservation.vehicleId)) {
        throw new Error(
          `duplicate parking reservation vehicle: ${reservation.vehicleId}`,
        );
      }
      if (!facilities.has(reservation.facilityId)) {
        throw new Error(
          `parking reservation references unknown facility: ${reservation.facilityId}`,
        );
      }
      reservations.set(reservation.vehicleId, reservation.facilityId);
      reservationCounts.set(
        reservation.facilityId,
        (reservationCounts.get(reservation.facilityId) ?? 0) + 1,
      );
    }
    for (const [facilityId, count] of reservationCounts) {
      const facility = facilities.get(facilityId);
      if (!facility || count > facility.occupied) {
        throw new Error("parking snapshot reservations exceed occupancy");
      }
    }

    this.facilities.clear();
    for (const [id, facility] of facilities) this.facilities.set(id, facility);
    this.reservationByVehicle.clear();
    for (const [vehicleId, facilityId] of reservations) {
      this.reservationByVehicle.set(vehicleId, facilityId);
    }
  }
}
