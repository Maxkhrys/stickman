import './style.css';
import { App } from './game/App';

const app = new App();
// handy for debugging / tuning from the console
(window as unknown as { stickfight: App }).stickfight = app;
