import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { assertAssetSource, validateAssetSource } from './asset-source-schema.mjs';
import {
  boxGeometry,
  cylinderGeometry,
  geometryBounds,
  planeGeometry,
  triangleCount,
  wedgeGeometry,
} from './geometry.mjs';

export { validateAssetSource } from './asset-source-schema.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const GROUND_TOLERANCE_M = 0.001;
const BOUNDS_TOLERANCE_M = 0.02;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hexColor(value, alpha = 1) {
  const red = Number.parseInt(value.slice(1, 3), 16) / 255;
  const green = Number.parseInt(value.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(value.slice(5, 7), 16) / 255;
  return [red, green, blue, alpha];
}

function primitiveGeometry(part) {
  switch (part.primitive) {
    case 'box':
      return boxGeometry(part.size, part.center);
    case 'wedge':
      return wedgeGeometry(part.size, part.center, part.axis ?? 'x');
    case 'cylinder':
      return cylinderGeometry(part.radius, part.height, part.segments, part.center);
    case 'plane':
      return planeGeometry(part.size, part.center, part.orientation);
    default:
      throw new Error(`unsupported primitive '${part.primitive}'`);
  }
}

function assertBounds(geometry, dimensions, label) {
  const bounds = geometryBounds(geometry);
  if (bounds.min.y < -GROUND_TOLERANCE_M) {
    throw new Error(`${label} extends below ground: ${bounds.min.y.toFixed(4)}m`);
  }

  const limits = {
    minX: -dimensions.widthM / 2 - BOUNDS_TOLERANCE_M,
    maxX: dimensions.widthM / 2 + BOUNDS_TOLERANCE_M,
    minZ: -dimensions.depthM / 2 - BOUNDS_TOLERANCE_M,
    maxZ: dimensions.depthM / 2 + BOUNDS_TOLERANCE_M,
    maxY: dimensions.heightM + BOUNDS_TOLERANCE_M,
  };
  if (
    bounds.min.x < limits.minX ||
    bounds.max.x > limits.maxX ||
    bounds.min.z < limits.minZ ||
    bounds.max.z > limits.maxZ ||
    bounds.max.y > limits.maxY
  ) {
    throw new Error(`${label} exceeds declared asset dimensions`);
  }
}

function prepareParts(parts, dimensions, label) {
  return [...parts]
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    .map((part) => {
      const geometry = primitiveGeometry(part);
      assertBounds(geometry, dimensions, `${label}.${part.id}`);
      return { part, geometry };
    });
}

function createMaterials(document, definitions) {
  const materials = new Map();
  for (const definition of [...definitions].sort((left, right) =>
    left.id.localeCompare(right.id, 'en'),
  )) {
    const alpha = definition.alpha ?? 1;
    const material = document
      .createMaterial(definition.id)
      .setBaseColorFactor(hexColor(definition.baseColor, alpha))
      .setRoughnessFactor(definition.roughness)
      .setMetallicFactor(definition.metallic);
    if (alpha < 1) material.setAlphaMode('BLEND');
    materials.set(definition.id, material);
  }
  return materials;
}

function createAccessor(document, buffer, name, type, array) {
  return document
    .createAccessor(name)
    .setType(type)
    .setArray(array)
    .setBuffer(buffer);
}

async function emitGlb(source, preparedParts, { collision = false } = {}) {
  const document = new Document();
  const buffer = document.createBuffer('geometry');
  const scene = document.createScene('Scene');
  const mesh = document.createMesh(collision ? 'collision' : source.assetId);
  const materials = collision
    ? new Map()
    : createMaterials(document, source.materials);

  for (const { part, geometry } of preparedParts) {
    const positions = createAccessor(
      document,
      buffer,
      `${part.id}_POSITION`,
      'VEC3',
      new Float32Array(geometry.positions),
    );
    const normals = createAccessor(
      document,
      buffer,
      `${part.id}_NORMAL`,
      'VEC3',
      new Float32Array(geometry.normals),
    );
    const vertexCount = geometry.positions.length / 3;
    const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
    const indices = createAccessor(
      document,
      buffer,
      `${part.id}_INDICES`,
      'SCALAR',
      new IndexArray(geometry.indices),
    );
    const primitive = document
      .createPrimitive(part.id)
      .setAttribute('POSITION', positions)
      .setAttribute('NORMAL', normals)
      .setIndices(indices);
    if (!collision) primitive.setMaterial(materials.get(part.material));
    mesh.addPrimitive(primitive);
  }

  scene.addChild(
    document
      .createNode(collision ? 'collision_root' : source.assetId)
      .setMesh(mesh),
  );
  return new NodeIO().writeBinary(document);
}

function revisionFromAssetId(assetId) {
  const match = assetId.match(/_v(\d{2})$/);
  if (!match) {
    throw new Error(
      `assetId '${assetId}' does not contain a two-digit revision`,
    );
  }
  return Number.parseInt(match[1], 10);
}

function manifestForSource(source) {
  const assetId = source.assetId;
  const placement = source.placement ?? {
    snapMode: source.category === 'building' ? 'parcel' : 'free',
  };
  const entry = {
    assetId,
    revision: revisionFromAssetId(assetId),
    category: source.category,
    geometry: {
      lod0: `assets/models/${assetId}_lod0.glb`,
      lod1: `assets/models/${assetId}_lod1.glb`,
      lod2: `assets/models/${assetId}_lod2.glb`,
      collision: `assets/collisions/${assetId}_collision.glb`,
    },
    dimensions: source.dimensions,
    pivot: source.pivot,
    placement,
    sockets: [...source.sockets].sort((left, right) =>
      left.id.localeCompare(right.id, 'en'),
    ),
    materials: [...source.materials]
      .sort((left, right) => left.id.localeCompare(right.id, 'en'))
      .map(({ id, family }) => ({ id, family })),
    stateChannels: source.stateChannels,
    runtime: source.runtime,
    art: source.art,
  };
  if (source.collision.length === 0) delete entry.geometry.collision;
  return { schemaVersion: 2, entries: [entry] };
}

function contentHash(compilerVersion, source, outputs) {
  const hash = createHash('sha256');
  hash.update(`${compilerVersion}\n`);
  hash.update(canonicalJson(source));
  for (const key of ['lod0', 'lod1', 'lod2']) hash.update(outputs.lods[key]);
  hash.update(outputs.collision);
  return hash.digest('hex');
}

export async function compileAssetSource(
  source,
  { compilerVersion = 'civic-asset-compiler-v1' } = {},
) {
  assertAssetSource(source);
  if (typeof compilerVersion !== 'string' || compilerVersion.length === 0) {
    throw new Error('compilerVersion must be a non-empty string');
  }

  const lodById = new Map(source.lods.map((lod) => [lod.id, lod]));
  const prepared = {};
  const triangleCounts = {};
  for (const lodId of ['lod0', 'lod1', 'lod2']) {
    const lod = lodById.get(lodId);
    if (!lod) throw new Error(`missing required ${lodId}`);
    prepared[lodId] = prepareParts(lod.parts, source.dimensions, lodId);
    triangleCounts[lodId] = prepared[lodId].reduce(
      (sum, item) => sum + triangleCount(item.geometry),
      0,
    );
    if (triangleCounts[lodId] > lod.maxTriangles) {
      throw new Error(
        `${lodId} triangle count ${triangleCounts[lodId]} exceeds maxTriangles ${lod.maxTriangles}`,
      );
    }
  }

  if (triangleCounts.lod1 > triangleCounts.lod0) {
    throw new Error('lod1 triangle count may not exceed lod0');
  }
  if (triangleCounts.lod2 > triangleCounts.lod1) {
    throw new Error('lod2 triangle count may not exceed lod1');
  }

  const preparedCollision = prepareParts(
    source.collision,
    source.dimensions,
    'collision',
  );
  const collisionTriangleCount = preparedCollision.reduce(
    (sum, item) => sum + triangleCount(item.geometry),
    0,
  );
  if (source.category === 'building' && collisionTriangleCount === 0) {
    throw new Error('building assets require collision geometry');
  }

  const lods = {
    lod0: await emitGlb(source, prepared.lod0),
    lod1: await emitGlb(source, prepared.lod1),
    lod2: await emitGlb(source, prepared.lod2),
  };
  const collision = await emitGlb(source, preparedCollision, {
    collision: true,
  });
  const manifest = manifestForSource(source);
  const hash = contentHash(compilerVersion, source, { lods, collision });

  return {
    lods,
    collision,
    manifest,
    contentHash: hash,
    diagnostics: {
      compilerVersion,
      triangleCounts,
      collisionTriangleCount,
      dimensions: source.dimensions,
    },
    triangleCounts,
    collisionTriangleCount,
    dimensions: source.dimensions,
  };
}

export async function compileAssetFile(
  sourcePath,
  outputRoot,
  { compilerVersion = 'civic-asset-compiler-v1' } = {},
) {
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const result = await compileAssetSource(source, { compilerVersion });
  const assetId = source.assetId;
  const root = resolve(outputRoot);
  const modelRoot = join(root, 'models');
  const collisionRoot = join(root, 'collisions');
  const manifestRoot = join(root, 'manifests');
  await Promise.all([
    mkdir(modelRoot, { recursive: true }),
    mkdir(collisionRoot, { recursive: true }),
    mkdir(manifestRoot, { recursive: true }),
  ]);

  const writes = [
    writeFile(join(modelRoot, `${assetId}_lod0.glb`), result.lods.lod0),
    writeFile(join(modelRoot, `${assetId}_lod1.glb`), result.lods.lod1),
    writeFile(join(modelRoot, `${assetId}_lod2.glb`), result.lods.lod2),
    writeFile(
      join(manifestRoot, `${assetId}_manifest.json`),
      `${JSON.stringify(result.manifest, null, 2)}\n`,
      'utf8',
    ),
  ];
  if (source.collision.length > 0) {
    writes.push(
      writeFile(
        join(collisionRoot, `${assetId}_collision.glb`),
        result.collision,
      ),
    );
  }
  await Promise.all(writes);
  return result;
}

export async function listAssetSourceFiles(
  sourceRoot = join(repositoryRoot, 'assets', 'source', '3d'),
) {
  const root = resolve(sourceRoot);
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith('.asset.json')) {
        files.push(path);
      }
    }
  }

  await visit(root);
  return files;
}

async function compileAssetSources({ sourceRoot, outputRoot = null }) {
  const files = await listAssetSourceFiles(sourceRoot);
  const entries = [];
  const diagnostics = [];
  const seenAssetIds = new Set();

  for (const sourcePath of files) {
    const source = JSON.parse(await readFile(sourcePath, 'utf8'));
    if (seenAssetIds.has(source.assetId)) {
      throw new Error(`duplicate assetId '${source.assetId}' across 3D sources`);
    }
    seenAssetIds.add(source.assetId);

    const result = outputRoot
      ? await compileAssetFile(sourcePath, outputRoot)
      : await compileAssetSource(source);
    entries.push(result.manifest.entries[0]);
    diagnostics.push({
      assetId: source.assetId,
      sourcePath,
      contentHash: result.contentHash,
      triangleCounts: result.triangleCounts,
      collisionTriangleCount: result.collisionTriangleCount,
    });
  }

  return {
    files,
    catalog: { schemaVersion: 2, entries },
    diagnostics,
  };
}

export async function checkAssetSources(
  sourceRoot = join(repositoryRoot, 'assets', 'source', '3d'),
) {
  return compileAssetSources({ sourceRoot });
}

export async function buildAssetSources(
  sourceRoot = join(repositoryRoot, 'assets', 'source', '3d'),
  outputRoot = join(repositoryRoot, 'dist', 'assets'),
) {
  const root = resolve(outputRoot);
  const result = await compileAssetSources({ sourceRoot, outputRoot: root });
  const manifestRoot = join(root, 'manifests');
  await mkdir(manifestRoot, { recursive: true });
  await writeFile(
    join(manifestRoot, 'catalog-v2.json'),
    `${JSON.stringify(result.catalog, null, 2)}\n`,
    'utf8',
  );
  return result;
}

function parseFocusedCliArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(
        'Usage: CivicAssetCompiler.mjs --check | --build | --source <recipe.json> --out <output-root>',
      );
    }
    args.set(flag, value);
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--check') {
    const result = await checkAssetSources();
    process.stdout.write(
      `${JSON.stringify({ mode: 'check', assetCount: result.files.length, diagnostics: result.diagnostics })}\n`,
    );
    return;
  }
  if (argv.length === 1 && argv[0] === '--build') {
    const result = await buildAssetSources();
    process.stdout.write(
      `${JSON.stringify({ mode: 'build', assetCount: result.files.length, diagnostics: result.diagnostics })}\n`,
    );
    return;
  }

  const args = parseFocusedCliArgs(argv);
  const sourcePath = args.get('--source');
  const outputRoot = args.get('--out');
  if (!sourcePath || !outputRoot || args.size !== 2) {
    throw new Error(
      'Usage: CivicAssetCompiler.mjs --check | --build | --source <recipe.json> --out <output-root>',
    );
  }
  const result = await compileAssetFile(sourcePath, outputRoot);
  process.stdout.write(
    `${JSON.stringify({
      contentHash: result.contentHash,
      triangleCounts: result.triangleCounts,
      collisionTriangleCount: result.collisionTriangleCount,
    })}\n`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
