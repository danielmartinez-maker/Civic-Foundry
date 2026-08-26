import { GameApp } from './app/GameApp.ts';
import { LandHousingUiController } from './ui/LandHousingUiController.ts';
import { UrbanFabricUiController } from './ui/UrbanFabricUiController.ts';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');
const app = new GameApp(root);
const urbanFabricUi = new UrbanFabricUiController(app, root);
const landHousingUi = new LandHousingUiController(app, root);
(Object.assign(window, { __civicApp: app, __urbanFabricUi: urbanFabricUi, __landHousingUi: landHousingUi }));
