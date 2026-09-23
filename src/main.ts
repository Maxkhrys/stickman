import './style.css';
import { App } from './game/App';

const app = new App();
// handy for debugging / tuning from the console
(window as unknown as { stickfight: App }).stickfight = app;

// dev-only harness hook for scripted kill/stress checks (tree-shaken from production builds)
if (import.meta.env.DEV) {
  void import('./sim/combat').then((m) => { (window as unknown as { __applyDamage: typeof m.applyDamage }).__applyDamage = m.applyDamage; });
}
