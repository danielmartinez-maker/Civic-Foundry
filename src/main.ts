import { GameApp } from './app/GameApp.ts';
import { NativeEngineBridge } from './native/NativeEngineBridge.ts';
import type { NativeEngineAddon } from './native/NativeEngineTypes.ts';
import { LandHousingUiController } from './ui/LandHousingUiController.ts';
import { UrbanFabricUiController } from './ui/UrbanFabricUiController.ts';

function installDesktopNativeAuthority(): NativeEngineBridge | null {
  const scope = globalThis as typeof globalThis & {
    civicNativeAddon?: NativeEngineAddon;
    __CIVIC_NATIVE_WORLD_AUTHORITY__?: boolean;
    __CIVIC_NATIVE_WORLD_BRIDGE__?: NativeEngineBridge;
    __CIVIC_NATIVE_URBAN_AUTHORITY__?: boolean;
    __CIVIC_NATIVE_URBAN_BRIDGE__?: NativeEngineBridge;
  };
  if (!scope.civicNativeAddon) return null;

  const bridge = new NativeEngineBridge(scope.civicNativeAddon);
  scope.__CIVIC_NATIVE_WORLD_AUTHORITY__ = true;
  scope.__CIVIC_NATIVE_WORLD_BRIDGE__ = bridge;
  scope.__CIVIC_NATIVE_URBAN_AUTHORITY__ = true;
  scope.__CIVIC_NATIVE_URBAN_BRIDGE__ = bridge;
  return bridge;
}

const nativeBridge = installDesktopNativeAuthority();
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');
const app = new GameApp(root);
const urbanFabricUi = new UrbanFabricUiController(app, root);
const landHousingUi = new LandHousingUiController(app, root);
Object.assign(window, {
  __civicApp: app,
  __urbanFabricUi: urbanFabricUi,
  __landHousingUi: landHousingUi,
});

if (nativeBridge) {
  window.addEventListener('beforeunload', () => nativeBridge.dispose(), {
    once: true,
  });
}
