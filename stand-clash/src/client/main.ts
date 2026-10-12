import './ui/styles.css';
import { Game } from './game/game';
import { Menus } from './ui/menus';
import { audio } from './engine/audio';

const game = new Game();
const menus = new Menus(game);
document.getElementById('loading')?.remove();
menus.show('title');
// pre-compile all materials (effects, Stands, projectiles) so the first punch never hitches
setTimeout(() => game.warmup(), 300);

// Audio can only start after a user gesture
window.addEventListener('pointerdown', () => audio.init(), { once: false });
window.addEventListener('keydown', () => audio.init(), { once: true });

// Debug / automation handle (used by the Playwright verification scripts)
(window as unknown as { __sc: unknown }).__sc = { game, menus, audio };
