export type ShadowComparable =
  | null
  | boolean
  | number
  | string
  | readonly ShadowComparable[]
  | Readonly<{ [key: string]: ShadowComparable }>;

export type ShadowDifference = Readonly<{
  path: string;
  expected: ShadowComparable | undefined;
  actual: ShadowComparable | undefined;
}>;

const FNV_OFFSET = 1469598103934665603n;
const FNV_PRIME = 1099511628211n;
const MASK_64 = 0xffffffffffffffffn;

export class ShadowHash64 {
  private value = FNV_OFFSET;

  mixU64(input: bigint | number): this {
    let value = typeof input === "number" ? BigInt(input) : input;
    value &= MASK_64;
    for (let index = 0; index < 8; index += 1) {
      this.value ^= (value >> BigInt(index * 8)) & 0xffn;
      this.value = (this.value * FNV_PRIME) & MASK_64;
    }
    return this;
  }

  mixRawByte(input: number): this {
    this.value ^= BigInt(input & 0xff);
    this.value = (this.value * FNV_PRIME) & MASK_64;
    return this;
  }

  mixString(input: string): this {
    for (let index = 0; index < input.length; index += 1) {
      this.mixRawByte(input.charCodeAt(index));
    }
    this.mixRawByte(0xff);
    return this;
  }

  hex(): string {
    return this.value.toString(16).padStart(16, "0");
  }
}

export function firstShadowDifference(
  expected: ShadowComparable,
  actual: ShadowComparable,
  path = "$",
): ShadowDifference | null {
  if (Object.is(expected, actual)) return null;

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return Object.freeze({ path, expected, actual });
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const left = expected[index];
      const right = actual[index];
      if (left === undefined || right === undefined) {
        return Object.freeze({
          path: `${path}[${index}]`,
          expected: left,
          actual: right,
        });
      }
      const difference = firstShadowDifference(
        left,
        right,
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return null;
  }

  if (isRecord(expected) || isRecord(actual)) {
    if (!isRecord(expected) || !isRecord(actual)) {
      return Object.freeze({ path, expected, actual });
    }
    const keys = [
      ...new Set([...Object.keys(expected), ...Object.keys(actual)]),
    ].sort();
    for (const key of keys) {
      const left = expected[key];
      const right = actual[key];
      if (left === undefined || right === undefined) {
        return Object.freeze({
          path: `${path}.${key}`,
          expected: left,
          actual: right,
        });
      }
      const difference = firstShadowDifference(left, right, `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }

  return Object.freeze({ path, expected, actual });
}

function isRecord(
  value: ShadowComparable | undefined,
): value is Readonly<{ [key: string]: ShadowComparable }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
