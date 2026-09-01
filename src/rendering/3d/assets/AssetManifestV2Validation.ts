import type {
  AssetCategory,
  AssetManifestV2,
  AssetManifestV2Entry,
  AssetVector3,
} from './AssetManifestV2.ts';

const ASSET_ID = /^cf_[a-z0-9]+(?:_[a-z0-9]+)*_v\d{2}$/;

const CATEGORIES = new Set<AssetCategory>([
  'building',
  'vehicle',
  'vegetation',
  'road',
  'civic',
  'industrial',
  'transit',
  'construction',
  'public_realm',
]);

const SNAP_MODES = new Set(['parcel', 'road', 'socket', 'free']);
const INSTANCING_MODES = new Set(['thin', 'hardware', 'unique']);
const STREAMING_CLASSES = new Set(['critical', 'near', 'normal', 'background']);
const MEMORY_CLASSES = new Set(['tiny', 'small', 'medium', 'large']);
const STATE_CHANNELS = ['condition', 'occupancy', 'power', 'construction', 'night'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateVector(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be a finite vector`);
    return;
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    if (!isFiniteNumber(value[axis])) {
      errors.push(`${path}.${axis} must be finite`);
    }
  }
}

function validateRuntimeReference(value: unknown, path: string, errors: string[]): void {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} must be a non-empty runtime-relative reference`);
    return;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme || value.startsWith('/') || value.includes('..')) {
    errors.push(`${path} must be runtime-relative and may not contain a scheme, root slash, or '..'`);
  }
}

function validateTokenArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const token = value[index];
    if (!isNonEmptyString(token)) {
      errors.push(`${path}[${index}] must be a non-empty token`);
      continue;
    }
    if (seen.has(token)) {
      errors.push(`${path} contains duplicate token '${token}'`);
    }
    seen.add(token);
  }
}

function validateEntry(value: unknown, index: number, errors: string[]): string | null {
  const path = `entries[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  const assetId = value.assetId;
  if (!isNonEmptyString(assetId) || !ASSET_ID.test(assetId)) {
    errors.push(`${path}.assetId must match ${ASSET_ID.source}`);
  }

  if (!Number.isInteger(value.revision) || Number(value.revision) <= 0) {
    errors.push(`${path}.revision must be a positive integer`);
  }

  if (!isNonEmptyString(value.category) || !CATEGORIES.has(value.category as AssetCategory)) {
    errors.push(`${path}.category is not supported`);
  }
  if (!isNonEmptyString(value.semanticFamily)) {
    errors.push(`${path}.semanticFamily must be non-empty`);
  }

  if (!isRecord(value.geometry)) {
    errors.push(`${path}.geometry must be an object`);
  } else {
    validateRuntimeReference(value.geometry.lod0, `${path}.geometry.lod0`, errors);
    for (const key of ['lod1', 'lod2', 'impostor', 'collision'] as const) {
      if (value.geometry[key] !== undefined) {
        validateRuntimeReference(value.geometry[key], `${path}.geometry.${key}`, errors);
      }
    }
  }

  if (!isRecord(value.dimensions)) {
    errors.push(`${path}.dimensions must be an object`);
  } else {
    for (const key of ['widthM', 'depthM', 'heightM'] as const) {
      const dimension = value.dimensions[key];
      if (!isFiniteNumber(dimension) || dimension <= 0) {
        errors.push(`${path}.dimensions.${key} must be finite and > 0`);
      }
    }
  }

  if (!isRecord(value.pivot)) {
    errors.push(`${path}.pivot must be an object`);
  } else {
    if (value.pivot.convention !== 'ground-center') {
      errors.push(`${path}.pivot.convention must be ground-center`);
    }
    if (value.pivot.forward !== '-Z') {
      errors.push(`${path}.pivot.forward must be -Z`);
    }
    if (value.pivot.up !== '+Y') {
      errors.push(`${path}.pivot.up must be +Y`);
    }
  }

  if (!isRecord(value.placement)) {
    errors.push(`${path}.placement must be an object`);
  } else {
    if (!isNonEmptyString(value.placement.snapMode) || !SNAP_MODES.has(value.placement.snapMode)) {
      errors.push(`${path}.placement.snapMode is not supported`);
    }
    for (const key of ['zoneCompatibility', 'density'] as const) {
      if (value.placement[key] !== undefined) {
        validateTokenArray(value.placement[key], `${path}.placement.${key}`, errors);
      }
    }
  }

  if (!Array.isArray(value.sockets)) {
    errors.push(`${path}.sockets must be an array`);
  } else {
    const socketIds = new Set<string>();
    for (let socketIndex = 0; socketIndex < value.sockets.length; socketIndex += 1) {
      const socket = value.sockets[socketIndex];
      const socketPath = `${path}.sockets[${socketIndex}]`;
      if (!isRecord(socket)) {
        errors.push(`${socketPath} must be an object`);
        continue;
      }
      if (!isNonEmptyString(socket.id)) {
        errors.push(`${socketPath}.id must be non-empty`);
      } else if (socketIds.has(socket.id)) {
        errors.push(`${path}.sockets contains duplicate id '${socket.id}'`);
      } else {
        socketIds.add(socket.id);
      }
      validateVector(socket.position, `${socketPath}.position`, errors);
      validateVector(socket.forward, `${socketPath}.forward`, errors);
    }
  }

  if (!Array.isArray(value.materials)) {
    errors.push(`${path}.materials must be an array`);
  } else {
    const materialIds = new Set<string>();
    for (let materialIndex = 0; materialIndex < value.materials.length; materialIndex += 1) {
      const material = value.materials[materialIndex];
      const materialPath = `${path}.materials[${materialIndex}]`;
      if (!isRecord(material)) {
        errors.push(`${materialPath} must be an object`);
        continue;
      }
      if (!isNonEmptyString(material.id)) {
        errors.push(`${materialPath}.id must be non-empty`);
      } else if (materialIds.has(material.id)) {
        errors.push(`${path}.materials contains duplicate id '${material.id}'`);
      } else {
        materialIds.add(material.id);
      }
      if (!isNonEmptyString(material.family)) {
        errors.push(`${materialPath}.family must be non-empty`);
      }
    }
  }

  if (!isRecord(value.stateChannels)) {
    errors.push(`${path}.stateChannels must be an object`);
  } else {
    for (const channel of STATE_CHANNELS) {
      if (value.stateChannels[channel] !== undefined) {
        validateTokenArray(value.stateChannels[channel], `${path}.stateChannels.${channel}`, errors);
      }
    }
  }

  if (!isRecord(value.runtime)) {
    errors.push(`${path}.runtime must be an object`);
  } else {
    if (!isNonEmptyString(value.runtime.instancing) || !INSTANCING_MODES.has(value.runtime.instancing)) {
      errors.push(`${path}.runtime.instancing is not supported`);
    }
    if (
      !isNonEmptyString(value.runtime.streamingClass) ||
      !STREAMING_CLASSES.has(value.runtime.streamingClass)
    ) {
      errors.push(`${path}.runtime.streamingClass is not supported`);
    }
    if (!isNonEmptyString(value.runtime.memoryClass) || !MEMORY_CLASSES.has(value.runtime.memoryClass)) {
      errors.push(`${path}.runtime.memoryClass is not supported`);
    }
    for (const key of [
      'estimatedCpuGeometryBytes',
      'estimatedGpuGeometryBytes',
      'estimatedGpuMaterialBytes',
    ] as const) {
      if (!Number.isInteger(value.runtime[key]) || Number(value.runtime[key]) <= 0) {
        errors.push(`${path}.runtime.${key} must be a positive integer`);
      }
    }
    for (const key of [
      'estimatedCpuGeometryBytes',
      'estimatedGpuGeometryBytes',
      'estimatedGpuMaterialBytes',
    ] as const) {
      if (!Number.isInteger(value.runtime[key]) || Number(value.runtime[key]) <= 0) {
        errors.push(`${path}.runtime.${key} must be a positive integer`);
      }
    }
  }

  if (!isRecord(value.art)) {
    errors.push(`${path}.art must be an object`);
  } else {
    if (!isNonEmptyString(value.art.styleFamily)) {
      errors.push(`${path}.art.styleFamily must be non-empty`);
    }
    if (!isNonEmptyString(value.art.qualityTier)) {
      errors.push(`${path}.art.qualityTier must be non-empty`);
    }
    if (value.art.reviewImage !== undefined) {
      validateRuntimeReference(value.art.reviewImage, `${path}.art.reviewImage`, errors);
    }
  }

  return typeof assetId === 'string' ? assetId : null;
}

export function validateAssetManifestV2(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ['manifest must be an object'];
  }
  if (value.schemaVersion !== 2) {
    errors.push('schemaVersion must equal 2');
  }
  if (!Array.isArray(value.entries)) {
    errors.push('entries must be an array');
    return errors;
  }

  const assetIds = new Set<string>();
  for (let index = 0; index < value.entries.length; index += 1) {
    const assetId = validateEntry(value.entries[index], index, errors);
    if (assetId === null) continue;
    if (assetIds.has(assetId)) {
      errors.push(`duplicate assetId '${assetId}'`);
    }
    assetIds.add(assetId);
  }
  return errors;
}

export function assertAssetManifestV2(value: unknown): asserts value is AssetManifestV2 {
  const errors = validateAssetManifestV2(value);
  if (errors.length > 0) {
    throw new Error(`Asset Manifest V2 invalid:\n${errors.join('\n')}`);
  }
}

export function isAssetVector3(value: unknown): value is AssetVector3 {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
}

export function isAssetManifestV2Entry(value: unknown): value is AssetManifestV2Entry {
  return validateAssetManifestV2({ schemaVersion: 2, entries: [value] }).length === 0;
}
