import { GameApp } from './app/GameApp.ts';
import { LandHousingUiController } from './ui/LandHousingUiController.ts';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');
const app = new GameApp(root);
const landHousingUi = new LandHousingUiController(app, root);
(Object.assign(window, { __civicApp: app, __landHousingUi: landHousingUi }));
