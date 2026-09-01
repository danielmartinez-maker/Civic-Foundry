const ASSET_ID = /^cf_[a-z0-9]+(?:_[a-z0-9]+)*_v\d{2}$/;
const CATEGORIES = new Set([
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
const PRIMITIVES = new Set(['box', 'wedge', 'cylinder', 'plane']);
const INSTANCING = new Set(['thin', 'hardware', 'unique']);
const STREAMING = new Set(['critical', 'near', 'normal', 'background']);
const MEMORY = new Set(['tiny', 'small', 'medium', 'large']);
const SNAP_MODES = new Set(['parcel', 'road', 'socket', 'free']);
const STATE_CHANNELS = new Set([
  'condition',
  'occupancy',
  'power',
  'construction',
  'night',
]);
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'assetId',
  'category',
  'semanticFamily',
  'dimensions',
  'pivot',
  'placement',
  'materials',
  'sockets',
  'stateChannels',
  'runtime',
  'art',
  'lods',
  'collision',
  'bakedPeople',
  'bakedVehicles',
  'bakedText',
]);
const MATERIAL_KEYS = new Set([
  'id',
  'family',
  'baseColor',
  'roughness',
  'metallic',
  'alpha',
]);
const COMMON_PART_KEYS = new Set(['id', 'primitive', 'center', 'material']);
const PART_KEYS = {
  box: new Set([...COMMON_PART_KEYS, 'size']),
  wedge: new Set([...COMMON_PART_KEYS, 'size', 'axis']),
  cylinder: new Set([
    ...COMMON_PART_KEYS,
    'radius',
    'height',
    'segments',
  ]),
  plane: new Set([...COMMON_PART_KEYS, 'size', 'orientation']),
};

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateUnknownKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not supported`);
  }
}

function validateVector(value, path, errors, { positive = false } = {}) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an xyz vector`);
    return;
  }
  validateUnknownKeys(value, new Set(['x', 'y', 'z']), path, errors);
  for (const axis of ['x', 'y', 'z']) {
    if (!finite(value[axis])) {
      errors.push(`${path}.${axis} must be finite`);
    } else if (positive && value[axis] <= 0) {
      errors.push(`${path}.${axis} must be > 0`);
    }
  }
}

function validateDimensions(value, errors) {
  if (!isRecord(value)) {
    errors.push('dimensions must be an object');
    return;
  }
  const keys = ['widthM', 'depthM', 'heightM'];
  validateUnknownKeys(value, new Set(keys), 'dimensions', errors);
  for (const key of keys) {
    if (!finite(value[key]) || value[key] <= 0) {
      errors.push(`dimensions.${key} must be finite and > 0`);
    }
  }
}

function validateTokenArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const token = value[index];
    if (!isNonEmptyString(token)) {
      errors.push(`${path}[${index}] must be a non-empty token`);
      continue;
    }
    if (seen.has(token)) errors.push(`${path} contains duplicate token '${token}'`);
    seen.add(token);
  }
}

function validateMaterial(material, index, errors, materialIds) {
  const path = `materials[${index}]`;
  if (!isRecord(material)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateUnknownKeys(material, MATERIAL_KEYS, path, errors);
  if (!isNonEmptyString(material.id)) {
    errors.push(`${path}.id must be non-empty`);
  } else if (materialIds.has(material.id)) {
    errors.push(`materials contains duplicate id '${material.id}'`);
  } else {
    materialIds.add(material.id);
  }
  if (!isNonEmptyString(material.family)) {
    errors.push(`${path}.family must be non-empty`);
  }
  if (
    typeof material.baseColor !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(material.baseColor)
  ) {
    errors.push(`${path}.baseColor must be a six-digit hex color`);
  }
  for (const key of ['roughness', 'metallic', 'alpha']) {
    if (material[key] === undefined && key === 'alpha') continue;
    if (!finite(material[key]) || material[key] < 0 || material[key] > 1) {
      errors.push(`${path}.${key} must be finite in [0, 1]`);
    }
  }
}

function validatePrimitive(part, path, errors, materialIds, requireMaterial) {
  if (!isRecord(part)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(part.primitive) || !PRIMITIVES.has(part.primitive)) {
    errors.push(`${path}.primitive must be box, wedge, cylinder, or plane`);
    return;
  }
  validateUnknownKeys(part, PART_KEYS[part.primitive], path, errors);
  if (!isNonEmptyString(part.id)) errors.push(`${path}.id must be non-empty`);
  validateVector(part.center, `${path}.center`, errors);

  if (requireMaterial) {
    if (!isNonEmptyString(part.material)) {
      errors.push(`${path}.material must be non-empty`);
    } else if (!materialIds.has(part.material)) {
      errors.push(
        `${path}.material references unknown material '${part.material}'`,
      );
    }
  } else if (
    part.material !== undefined &&
    !materialIds.has(part.material)
  ) {
    errors.push(`${path}.material references unknown material '${part.material}'`);
  }

  if (part.primitive === 'box' || part.primitive === 'wedge') {
    validateVector(part.size, `${path}.size`, errors, { positive: true });
    if (
      part.primitive === 'wedge' &&
      part.axis !== undefined &&
      !['x', 'z'].includes(part.axis)
    ) {
      errors.push(`${path}.axis must be x or z`);
    }
  } else if (part.primitive === 'cylinder') {
    if (!finite(part.radius) || part.radius <= 0) {
      errors.push(`${path}.radius must be > 0`);
    }
    if (!finite(part.height) || part.height <= 0) {
      errors.push(`${path}.height must be > 0`);
    }
    if (
      !Number.isInteger(part.segments) ||
      part.segments < 3 ||
      part.segments > 128
    ) {
      errors.push(`${path}.segments must be an integer between 3 and 128`);
    }
  } else {
    validateVector(part.size, `${path}.size`, errors);
    if (!['xy', 'xz', 'yz'].includes(part.orientation)) {
      errors.push(`${path}.orientation must be xy, xz, or yz`);
    }
    if (
      isRecord(part.size) &&
      ['xy', 'xz', 'yz'].includes(part.orientation)
    ) {
      for (const axis of part.orientation) {
        if (!finite(part.size[axis]) || part.size[axis] <= 0) {
          errors.push(
            `${path}.size.${axis} must be > 0 for ${part.orientation} plane`,
          );
        }
      }
    }
  }
}

export function validateAssetSource(source) {
  const errors = [];
  if (!isRecord(source)) return ['asset source must be an object'];
  validateUnknownKeys(source, TOP_LEVEL_KEYS, 'source', errors);

  if (source.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (!isNonEmptyString(source.assetId) || !ASSET_ID.test(source.assetId)) {
    errors.push(`assetId must match ${ASSET_ID.source}`);
  }
  if (!isNonEmptyString(source.category) || !CATEGORIES.has(source.category)) {
    errors.push('category is not supported');
  }
  if (!isNonEmptyString(source.semanticFamily)) {
    errors.push('semanticFamily must be non-empty');
  }
  validateDimensions(source.dimensions, errors);

  if (!isRecord(source.pivot)) {
    errors.push('pivot must be an object');
  } else {
    validateUnknownKeys(
      source.pivot,
      new Set(['convention', 'forward', 'up']),
      'pivot',
      errors,
    );
    if (source.pivot.convention !== 'ground-center') {
      errors.push('pivot.convention must be ground-center');
    }
    if (source.pivot.forward !== '-Z') errors.push('pivot.forward must be -Z');
    if (source.pivot.up !== '+Y') errors.push('pivot.up must be +Y');
  }

  if (source.placement !== undefined) {
    if (!isRecord(source.placement)) {
      errors.push('placement must be an object');
    } else {
      validateUnknownKeys(
        source.placement,
        new Set(['snapMode', 'zoneCompatibility', 'density']),
        'placement',
        errors,
      );
      if (!SNAP_MODES.has(source.placement.snapMode)) {
        errors.push('placement.snapMode is not supported');
      }
      for (const key of ['zoneCompatibility', 'density']) {
        if (source.placement[key] !== undefined) {
          validateTokenArray(
            source.placement[key],
            `placement.${key}`,
            errors,
          );
        }
      }
    }
  }

  const materialIds = new Set();
  if (!Array.isArray(source.materials) || source.materials.length === 0) {
    errors.push('materials must be a non-empty array');
  } else {
    for (let index = 0; index < source.materials.length; index += 1) {
      validateMaterial(source.materials[index], index, errors, materialIds);
    }
  }

  if (!Array.isArray(source.sockets)) {
    errors.push('sockets must be an array');
  } else {
    const socketIds = new Set();
    for (let index = 0; index < source.sockets.length; index += 1) {
      const socket = source.sockets[index];
      const path = `sockets[${index}]`;
      if (!isRecord(socket)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      validateUnknownKeys(
        socket,
        new Set(['id', 'position', 'forward']),
        path,
        errors,
      );
      if (!isNonEmptyString(socket.id)) {
        errors.push(`${path}.id must be non-empty`);
      } else if (socketIds.has(socket.id)) {
        errors.push(`sockets contains duplicate id '${socket.id}'`);
      } else {
        socketIds.add(socket.id);
      }
      validateVector(socket.position, `${path}.position`, errors);
      validateVector(socket.forward, `${path}.forward`, errors);
    }
  }

  if (!isRecord(source.stateChannels)) {
    errors.push('stateChannels must be an object');
  } else {
    for (const key of Object.keys(source.stateChannels)) {
      if (!STATE_CHANNELS.has(key)) {
        errors.push(`stateChannels.${key} is not supported`);
      } else {
        validateTokenArray(
          source.stateChannels[key],
          `stateChannels.${key}`,
          errors,
        );
      }
    }
  }

  if (!isRecord(source.runtime)) {
    errors.push('runtime must be an object');
  } else {
    validateUnknownKeys(
      source.runtime,
      new Set([
        'instancing',
        'streamingClass',
        'memoryClass',
        'estimatedCpuGeometryBytes',
        'estimatedGpuGeometryBytes',
        'estimatedGpuMaterialBytes',
      ]),
      'runtime',
      errors,
    );
    if (!INSTANCING.has(source.runtime.instancing)) {
      errors.push('runtime.instancing is not supported');
    }
    if (!STREAMING.has(source.runtime.streamingClass)) {
      errors.push('runtime.streamingClass is not supported');
    }
    if (!MEMORY.has(source.runtime.memoryClass)) {
      errors.push('runtime.memoryClass is not supported');
    }
    for (const key of [
      'estimatedCpuGeometryBytes',
      'estimatedGpuGeometryBytes',
      'estimatedGpuMaterialBytes',
    ]) {
      if (!Number.isInteger(source.runtime[key]) || source.runtime[key] <= 0) {
        errors.push(`runtime.${key} must be a positive integer`);
      }
    }
    for (const key of [
      'estimatedCpuGeometryBytes',
      'estimatedGpuGeometryBytes',
      'estimatedGpuMaterialBytes',
    ]) {
      if (!Number.isInteger(source.runtime[key]) || source.runtime[key] <= 0) {
        errors.push(`runtime.${key} must be a positive integer`);
      }
    }
    for (const key of [
      'estimatedCpuGeometryBytes',
      'estimatedGpuGeometryBytes',
      'estimatedGpuMaterialBytes',
    ]) {
      if (!Number.isInteger(source.runtime[key]) || source.runtime[key] <= 0) {
        errors.push(`runtime.${key} must be a positive integer`);
      }
    }
  }

  if (!isRecord(source.art)) {
    errors.push('art must be an object');
  } else {
    validateUnknownKeys(
      source.art,
      new Set(['styleFamily', 'qualityTier', 'reviewImage']),
      'art',
      errors,
    );
    if (!isNonEmptyString(source.art.styleFamily)) {
      errors.push('art.styleFamily must be non-empty');
    }
    if (!isNonEmptyString(source.art.qualityTier)) {
      errors.push('art.qualityTier must be non-empty');
    }
    if (source.art.reviewImage !== undefined) {
      if (!isNonEmptyString(source.art.reviewImage)) {
        errors.push('art.reviewImage must be non-empty');
      } else if (
        /^[a-z][a-z0-9+.-]*:/i.test(source.art.reviewImage) ||
        source.art.reviewImage.startsWith('/') ||
        source.art.reviewImage.includes('..')
      ) {
        errors.push('art.reviewImage must be runtime-relative');
      }
    }
  }

  for (const key of ['bakedPeople', 'bakedVehicles', 'bakedText']) {
    if (source[key] !== undefined && typeof source[key] !== 'boolean') {
      errors.push(`${key} must be boolean when provided`);
    }
  }

  if (!Array.isArray(source.lods)) {
    errors.push('lods must be an array containing lod0, lod1, and lod2');
  } else {
    const lodIds = new Set();
    for (let index = 0; index < source.lods.length; index += 1) {
      const lod = source.lods[index];
      const path = `lods[${index}]`;
      if (!isRecord(lod)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      validateUnknownKeys(
        lod,
        new Set(['id', 'maxTriangles', 'parts']),
        path,
        errors,
      );
      if (!['lod0', 'lod1', 'lod2'].includes(lod.id)) {
        errors.push(`${path}.id must be lod0, lod1, or lod2`);
      } else if (lodIds.has(lod.id)) {
        errors.push(`lods contains duplicate id '${lod.id}'`);
      } else {
        lodIds.add(lod.id);
      }
      if (!Number.isInteger(lod.maxTriangles) || lod.maxTriangles <= 0) {
        errors.push(`${path}.maxTriangles must be a positive integer`);
      }
      if (!Array.isArray(lod.parts) || lod.parts.length === 0) {
        errors.push(`${path}.parts must be a non-empty array`);
      } else {
        const partIds = new Set();
        for (let partIndex = 0; partIndex < lod.parts.length; partIndex += 1) {
          const part = lod.parts[partIndex];
          validatePrimitive(
            part,
            `${path}.parts[${partIndex}]`,
            errors,
            materialIds,
            true,
          );
          if (isRecord(part) && isNonEmptyString(part.id)) {
            if (partIds.has(part.id)) {
              errors.push(`${path}.parts contains duplicate id '${part.id}'`);
            }
            partIds.add(part.id);
          }
        }
      }
    }
    for (const required of ['lod0', 'lod1', 'lod2']) {
      if (!lodIds.has(required)) errors.push(`lods must contain ${required}`);
    }
    if (source.lods.length !== 3) {
      errors.push('lods must contain exactly lod0, lod1, and lod2');
    }
  }

  if (!Array.isArray(source.collision)) {
    errors.push('collision must be an array');
  } else {
    if (source.category === 'building' && source.collision.length === 0) {
      errors.push('building assets require collision geometry');
    }
    const collisionIds = new Set();
    for (let index = 0; index < source.collision.length; index += 1) {
      const part = source.collision[index];
      validatePrimitive(
        part,
        `collision[${index}]`,
        errors,
        materialIds,
        false,
      );
      if (isRecord(part) && isNonEmptyString(part.id)) {
        if (collisionIds.has(part.id)) {
          errors.push(`collision contains duplicate id '${part.id}'`);
        }
        collisionIds.add(part.id);
      }
    }
  }

  return errors;
}

export function assertAssetSource(source) {
  const errors = validateAssetSource(source);
  if (errors.length > 0) {
    throw new Error(`Asset source invalid:\n${errors.join('\n')}`);
  }
}
