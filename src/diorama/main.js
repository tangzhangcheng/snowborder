import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLandscape, loadWorld } from '../world/World.js';
import { LiftSystem } from '../lift/LiftSystem.js';

const status = document.getElementById('loading');

/** 独立的沙盘页：整座山 + 索道，可以拖动旋转缩放。 */
async function main() {
  const ctx = await loadWorld();
  const { world, terrain } = ctx;
  const scene = new THREE.Scene();
  const landscape = buildLandscape(scene, ctx);
  landscape.setHaze(9000, 70000);
  const lifts = new LiftSystem(world, terrain);
  scene.add(lifts.group);

  const size = terrain.worldSize;
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 10, 60000);
  camera.position.set(size * 0.5, terrain.maxH + 3600, size * 1.55);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(size / 2, (terrain.minH + terrain.maxH) / 2, size / 2);
  controls.maxPolarAngle = 1.35;
  controls.minDistance = 600;
  controls.maxDistance = 16000;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  status.classList.add('hide');

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    landscape.update(dt);
    lifts.update(dt, { mode: 'ride' }, null);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((err) => {
  status.textContent = `加载失败：${err.message}`;
  console.error(err);
});
