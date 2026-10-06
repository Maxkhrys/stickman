import './style.css';
import { App } from './game/App';
import { loadRobotAssets } from './render/robot/RobotRenderer';

const ui = document.getElementById('ui');
const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'Loading robot and weapons…';
loading.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;font:600 18px system-ui;color:#fff;background:#1b1d22;z-index:50';
ui?.appendChild(loading);
try {
  await loadRobotAssets(import.meta.env.BASE_URL);
} catch (err) {
  console.error('robot assets failed to load, falling back to the stickman', err);
}
loading.remove();
const app = new App();
// handy for debugging / tuning from the console
(window as unknown as { stickfight: App }).stickfight = app;

// dev-only harness hook for scripted kill/stress checks (tree-shaken from production builds)
if (import.meta.env.DEV) {
  void import('./sim/combat').then((m) => { (window as unknown as { __applyDamage: typeof m.applyDamage }).__applyDamage = m.applyDamage; });
}
