export function assertFiniteNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) throw new Error(`${path} must be finite`);
  return value;
}

export function assertFiniteRecord(value: unknown, path: string): void {
  if (typeof value === "number") {
    assertFiniteNumber(value, path);
    return;
  }
  if (value === null || value === undefined || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      assertFiniteRecord(value[index], `${path}[${index}]`);
    }
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) =>
    a.localeCompare(b),
  )) {
    assertFiniteRecord((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
