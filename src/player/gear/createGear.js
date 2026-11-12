import * as THREE from 'three';
import { addOutline, toonMat } from '../../render/Toon.js';

export const PATTERNS = ['solid', 'stripes', 'diagonal', 'chevron', 'split', 'plaid'];

const HALF_WIDTH = 0.135;
const WAIST = 0.012; // 腰线收窄量
const FLAT_HALF = 0.5; // 有效边刃的一半
const TIP = 0.28; // 板头/板尾圆弧长度
const THICKNESS = 0.022;
const KICK = 1.1; // 板头翘起的弯度
const BASE_Y = 0.016;
/** 半站距（米）：两个固定器各离板心多远。 */
export const STANCE = 0.27;
/** 八字站位：前脚、后脚的固定器各朝外打开 15°。 */
export const STANCE_ANGLES = [15, -15].map(THREE.MathUtils.degToRad);
const TEX_W = 128;
const TEX_H = 512;

export function defaultStyle() {
  return {
    format: 'hemu-like-gear',
    version: 1,
    kind: 'snowboard',
    top: '#e2603a',
    base: '#1c1f24',
    accent: '#f6e7c8',
    binding: '#2a2d32',
    pattern: 'chevron',
  };
}

/** 板面图案：画布的 v 方向对应板长。 */
export function patternTexture(style) {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = style.top;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = style.accent;
  ctx.strokeStyle = style.accent;
  if (style.pattern === 'stripes') {
    for (let x = 14; x < TEX_W; x += 40) ctx.fillRect(x, 0, 14, TEX_H);
  } else if (style.pattern === 'diagonal') {
    ctx.lineWidth = 16;
    for (let i = -TEX_H; i < TEX_H; i += 64) {
      ctx.beginPath();
      ctx.moveTo(-10, i);
      ctx.lineTo(TEX_W + 10, i + 180);
      ctx.stroke();
    }
  } else if (style.pattern === 'chevron') {
    ctx.lineWidth = 14;
    ctx.beginPath();
    for (let y = 40; y < TEX_H; y += 72) {
      ctx.moveTo(-8, y + 44);
      ctx.lineTo(TEX_W / 2, y);
      ctx.lineTo(TEX_W + 8, y + 44);
    }
    ctx.stroke();
  } else if (style.pattern === 'split') {
    ctx.fillRect(0, 0, TEX_W, TEX_H * 0.42);
  } else if (style.pattern === 'plaid') {
    for (let x = 0; x < TEX_W; x += 32) ctx.fillRect(x, 0, 6, TEX_H);
    for (let y = 0; y < TEX_H; y += 48) ctx.fillRect(0, y, TEX_W, 6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // 挤出体的顶面 UV 就是轮廓坐标（米），换算到 0..1
  const length = (FLAT_HALF + TIP) * 2;
  tex.repeat.set(1 / (HALF_WIDTH * 2), 1 / length);
  tex.offset.set(0.5, 0.5);
  return tex;
}

/** 板的俯视轮廓：两侧带腰线，两头是圆弧。x 为板宽，y 为板长。 */
function outline(grow = 0) {
  const pts = [];
  const side = 8;
  const arc = 10;
  const half = (t) => HALF_WIDTH - WAIST * (1 - t * t) + grow;
  for (let i = 0; i <= side; i++) {
    const t = -1 + (2 * i) / side;
    pts.push(new THREE.Vector2(half(t), t * FLAT_HALF));
  }
  for (let i = 1; i < arc; i++) {
    const a = (Math.PI * i) / arc;
    pts.push(new THREE.Vector2(Math.cos(a) * (HALF_WIDTH + grow), FLAT_HALF + Math.sin(a) * (TIP + grow)));
  }
  for (let i = 0; i <= side; i++) {
    const t = 1 - (2 * i) / side;
    pts.push(new THREE.Vector2(-half(t), t * FLAT_HALF));
  }
  for (let i = 1; i < arc; i++) {
    const a = Math.PI + (Math.PI * i) / arc;
    pts.push(new THREE.Vector2(Math.cos(a) * (HALF_WIDTH + grow), -FLAT_HALF + Math.sin(a) * (TIP + grow)));
  }
  return new THREE.Shape(pts);
}

/** 挤出成板，放平（板长沿 +Z），再把两头翘起来。 */
function deckGeometry(thickness, y, grow) {
  const geo = new THREE.ExtrudeGeometry(outline(grow), { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y + thickness, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const over = Math.max(0, Math.abs(pos.getZ(i)) - FLAT_HALF);
    pos.setY(i, pos.getY(i) + over * over * KICK);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createSnowboard(style) {
  const group = new THREE.Group();
  group.name = 'Snowboard';
  const top = new THREE.MeshToonMaterial({ map: patternTexture(style), color: '#ffffff' });
  const deck = new THREE.Mesh(deckGeometry(THICKNESS, BASE_Y, 0), [top, toonMat(style.base)]);
  const base = addOutline(new THREE.Mesh(deckGeometry(BASE_Y, 0, 0.004), toonMat(style.base)));
  group.add(deck, base);
  group.add(createBinding(style, STANCE, STANCE_ANGLES[0]));
  group.add(createBinding(style, -STANCE, STANCE_ANGLES[1]));
  return group;
}

/** 固定器：底盘、脚跟侧的高背、两条绑带。脚跟在 +X 一侧。 */
export function createBinding(style, z, yaw) {
  const pivot = new THREE.Group();
  pivot.position.set(0, BASE_Y + THICKNESS, z);
  pivot.rotation.y = yaw;
  const frame = toonMat(style.binding);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.016, 0.17), frame);
  plate.position.y = 0.008;
  const highback = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.24, 0.15), frame);
  highback.position.set(0.155, 0.13, 0);
  highback.rotation.z = 0.22;
  pivot.add(plate, highback);
  for (const x of [-0.08, 0.04]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.19), toonMat(style.accent));
    strap.position.set(x, x < 0 ? 0.1 : 0.17, 0);
    pivot.add(strap);
  }
  return pivot;
}

export function createGear(style) {
  return createSnowboard(style);
}
