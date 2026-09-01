const encoder = new TextEncoder();

function canonicalize(value: unknown, path: string, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new Error(`unsupported deterministic value at ${path}`);
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) throw new Error(`cyclic deterministic value at ${path}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => canonicalize(item, `${path}[${index}]`, seen));
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) =>
      a.localeCompare(b),
    )) {
      result[key] = canonicalize(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        seen,
      );
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, "$", new Set<object>()));
}

export function deterministicHash(value: unknown): string {
  const bytes = encoder.encode(stableStringify(value));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
