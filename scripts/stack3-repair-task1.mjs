import { readFile, writeFile } from 'node:fs/promises';

const sourceLoop = `    for (const key of [\n      'estimatedCpuGeometryBytes',\n      'estimatedGpuGeometryBytes',\n      'estimatedGpuMaterialBytes',\n    ]) {\n      if (!Number.isInteger(source.runtime[key]) || source.runtime[key] <= 0) {\n        errors.push(\`runtime.\${key} must be a positive integer\`);\n      }\n    }\n`;
const manifestLoop = `    for (const key of [\n      'estimatedCpuGeometryBytes',\n      'estimatedGpuGeometryBytes',\n      'estimatedGpuMaterialBytes',\n    ] as const) {\n      if (!Number.isInteger(value.runtime[key]) || Number(value.runtime[key]) <= 0) {\n        errors.push(\`\${path}.runtime.\${key} must be a positive integer\`);\n      }\n    }\n`;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function collapse(path, block) {
  const original = await readFile(path, 'utf8');
  const next = original.replace(new RegExp(`(?:${escapeRegex(block)})+`, 'g'), block);
  if (next !== original) await writeFile(path, next);
}

await collapse('tools/3d/asset-source-schema.mjs', sourceLoop);
await collapse('src/rendering/3d/assets/AssetManifestV2Validation.ts', manifestLoop);
