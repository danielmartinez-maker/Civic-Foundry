import { GameApp } from './app/GameApp.ts';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');
const app = new GameApp(root);
(Object.assign(window, { __civicApp: app }));
