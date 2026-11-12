import { Game } from './game/Game.js';
import './style.css';

const loading = document.getElementById('loading');

const game = new Game();
// 开发时挂到 window 上，方便在控制台里摆位置、看状态
if (import.meta.env.DEV) window.game = game;
game.init().then(() => {
  loading.classList.add('hide');
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}).catch((err) => {
  loading.textContent = '加载失败：' + err.message;
  console.error(err);
});
