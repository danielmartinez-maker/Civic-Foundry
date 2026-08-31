function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

export function canonicalVisualString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function visualSeed(...parts: readonly string[]): number {
  let hash = 0x811c9dc5;
  const input = parts.join('\u001f');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function visualFingerprint(value: unknown): string {
  return visualSeed(canonicalVisualString(value)).toString(16).padStart(8, '0');
}
