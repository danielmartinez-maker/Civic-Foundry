import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, edits) {
  let text = await readFile(path, 'utf8');
  for (const [from, to] of edits) {
    if (!text.includes(from)) {
      if (text.includes(to)) continue;
      throw new Error(`${path}: expected patch anchor not found:\n${from}`);
    }
    text = text.replace(from, to);
  }
  await writeFile(path, text);
}

await patch('tools/3d/asset-source-schema.mjs', [
  ["  'category',\n  'dimensions',", "  'category',\n  'semanticFamily',\n  'dimensions',"],
  ["  if (!isNonEmptyString(source.category) || !CATEGORIES.has(source.category)) {\n    errors.push('category is not supported');\n  }\n  validateDimensions(source.dimensions, errors);", "  if (!isNonEmptyString(source.category) || !CATEGORIES.has(source.category)) {\n    errors.push('category is not supported');\n  }\n  if (!isNonEmptyString(source.semanticFamily)) {\n    errors.push('semanticFamily must be non-empty');\n  }\n  validateDimensions(source.dimensions, errors);"],
  ["      new Set(['instancing', 'streamingClass', 'memoryClass']),", "      new Set([\n        'instancing',\n        'streamingClass',\n        'memoryClass',\n        'estimatedCpuGeometryBytes',\n        'estimatedGpuGeometryBytes',\n        'estimatedGpuMaterialBytes',\n      ]),"],
  ["    if (!MEMORY.has(source.runtime.memoryClass)) {\n      errors.push('runtime.memoryClass is not supported');\n    }", "    if (!MEMORY.has(source.runtime.memoryClass)) {\n      errors.push('runtime.memoryClass is not supported');\n    }\n    for (const key of [\n      'estimatedCpuGeometryBytes',\n      'estimatedGpuGeometryBytes',\n      'estimatedGpuMaterialBytes',\n    ]) {\n      if (!Number.isInteger(source.runtime[key]) || source.runtime[key] <= 0) {\n        errors.push(`runtime.${key} must be a positive integer`);\n      }\n    }"],
]);

await patch('tools/3d/CivicAssetCompiler.mjs', [
  ["    category: source.category,\n    geometry:", "    category: source.category,\n    semanticFamily: source.semanticFamily,\n    geometry:"],
]);

await patch('src/rendering/3d/assets/AssetManifestV2.ts', [
  ["  category: AssetCategory;\n  geometry:", "  category: AssetCategory;\n  semanticFamily: string;\n  geometry:"],
  ["    memoryClass: 'tiny' | 'small' | 'medium' | 'large';\n  }>;", "    memoryClass: 'tiny' | 'small' | 'medium' | 'large';\n    estimatedCpuGeometryBytes: number;\n    estimatedGpuGeometryBytes: number;\n    estimatedGpuMaterialBytes: number;\n  }>;"],
]);

await patch('src/rendering/3d/assets/AssetManifestV2Validation.ts', [
  ["  if (!isNonEmptyString(value.category) || !CATEGORIES.has(value.category as AssetCategory)) {\n    errors.push(`${path}.category is not supported`);\n  }\n\n  if (!isRecord(value.geometry))", "  if (!isNonEmptyString(value.category) || !CATEGORIES.has(value.category as AssetCategory)) {\n    errors.push(`${path}.category is not supported`);\n  }\n  if (!isNonEmptyString(value.semanticFamily)) {\n    errors.push(`${path}.semanticFamily must be non-empty`);\n  }\n\n  if (!isRecord(value.geometry))"],
  ["    if (!isNonEmptyString(value.runtime.memoryClass) || !MEMORY_CLASSES.has(value.runtime.memoryClass)) {\n      errors.push(`${path}.runtime.memoryClass is not supported`);\n    }", "    if (!isNonEmptyString(value.runtime.memoryClass) || !MEMORY_CLASSES.has(value.runtime.memoryClass)) {\n      errors.push(`${path}.runtime.memoryClass is not supported`);\n    }\n    for (const key of [\n      'estimatedCpuGeometryBytes',\n      'estimatedGpuGeometryBytes',\n      'estimatedGpuMaterialBytes',\n    ] as const) {\n      if (!Number.isInteger(value.runtime[key]) || Number(value.runtime[key]) <= 0) {\n        errors.push(`${path}.runtime.${key} must be a positive integer`);\n      }\n    }"],
]);

await patch('tests/asset_compiler.test.ts', [
  ["  category: 'building',\n  dimensions:", "  category: 'building',\n  semanticFamily: 'test-building',\n  dimensions:"],
  ["    memoryClass: 'tiny',\n  },", "    memoryClass: 'tiny',\n    estimatedCpuGeometryBytes: 4096,\n    estimatedGpuGeometryBytes: 8192,\n    estimatedGpuMaterialBytes: 2048,\n  },"],
]);

await patch('tests/asset_manifest_v2.test.ts', [
  ["    category: 'building',\n    geometry:", "    category: 'building',\n    semanticFamily: 'residential-detached-low',\n    geometry:"],
  ["    runtime: { instancing: 'thin', streamingClass: 'normal', memoryClass: 'small' },", "    runtime: {\n      instancing: 'thin',\n      streamingClass: 'normal',\n      memoryClass: 'small',\n      estimatedCpuGeometryBytes: 24000,\n      estimatedGpuGeometryBytes: 36000,\n      estimatedGpuMaterialBytes: 8192,\n    },"],
]);

await patch('assets/source/3d/buildings/cf_bld_res_detached_house_a_low_v01.asset.json', [
  ["  \"category\": \"building\",\n  \"dimensions\":", "  \"category\": \"building\",\n  \"semanticFamily\": \"residential-detached-low\",\n  \"dimensions\":"],
  ["    \"memoryClass\": \"small\"\n  },", "    \"memoryClass\": \"small\",\n    \"estimatedCpuGeometryBytes\": 32768,\n    \"estimatedGpuGeometryBytes\": 49152,\n    \"estimatedGpuMaterialBytes\": 12288\n  },"],
]);
