import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/app/GameApp.ts';
let source = await readFile(path, 'utf8');

function replaceExactly(from, to) {
  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(`expected exactly one occurrence of ${JSON.stringify(from)}, found ${occurrences}`);
  }
  source = source.replace(from, to);
}

replaceExactly(
  "const LEGACY_STORAGE_KEY = 'civic-foundry-save-v6';\n",
  "const LEGACY_STORAGE_KEY = 'civic-foundry-save-v6';\nconst SERVICE_DEPARTMENT_LABELS: Readonly<Record<ServiceDepartment, string>> = Object.freeze({\n  fire: 'Fire',\n  police: 'Police',\n  healthcare: 'Healthcare',\n  education: 'Education',\n  garbage: 'Waste',\n});\n",
);

replaceExactly(
  '<span>${department[0]!.toUpperCase()}${department.slice(1, 4)}</span>',
  '<span>${SERVICE_DEPARTMENT_LABELS[department]}</span>',
);

await writeFile(path, source, 'utf8');
