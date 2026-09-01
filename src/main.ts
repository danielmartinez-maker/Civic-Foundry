import { CivicRuntime } from './app/CivicRuntime.ts';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

const runtime = new CivicRuntime(root);
Object.assign(window, {
  __civicRuntime: runtime,
  __civicApp: runtime.app,
  __urbanFabricUi: runtime.urbanFabricUi,
  __landHousingUi: runtime.landHousingUi,
});
