import * as THREE from 'three';
import { addOutline, toonMat } from '../render/Toon.js';

/** 配色：青绿外套 + 米白拼色，深蓝雪裤，姜黄手套和背包做点缀。 */
export const OUTFIT = {
  jacket: '#2fb3c2',
  trim: '#f6eedd',
  pants: '#2b3447',
  band: '#232a39',
  helmet: '#f7f2e8',
  accent: '#f2b53c',
  boot: '#434b5c',
  sole: '#1e222a',
  skin: '#f4d3b9',
  hair: '#5b3a2a',
};

/** 骨架尺寸（米）。身体面朝 +Z、左手在 +X，原点在两脚之间的板面上。 */
export const RIG = {
  thigh: 0.3,
  shin: 0.3,
  upperArm: 0.21,
  forearm: 0.2,
  hipHalf: 0.1,
  ankle: 0.2,
  shoulder: new THREE.Vector3(0.225, 0.33, 0),
};

const HEAD_Y = 0.19; // 头心相对脖子的高度
const FACE_R = 0.2;
const HELMET_R = 0.225;
const HELMET_TILT = -0.45;
const GOGGLE_Y = 0.195;
const RIM = 0.32;
const FORWARD = new THREE.Vector3(0, 0, 1);

/** 外套的侧面轮廓：[半径, 高度]，从下摆到领口。 */
const JACKET_PROFILE = [
  [0.19, -0.03],
  [0.214, 0.0],
  [0.218, 0.08],
  [0.212, 0.18],
  [0.2, 0.27],
  [0.186, 0.34],
  [0.152, 0.41],
  [0.1, 0.452],
];
const JACKET_SQUASH = new THREE.Vector3(1.12, 1, 0.9);

function mesh(geometry, material, parent, outline = true) {
  const m = new THREE.Mesh(geometry, material);
  if (outline) addOutline(m);
  parent.add(m);
  return m;
}

function lathe(profile, grow = 0) {
  const pts = [new THREE.Vector2(0, profile[0][1])];
  for (const [r, y] of profile) pts.push(new THREE.Vector2(r + grow, y));
  pts.push(new THREE.Vector2(0, profile[profile.length - 1][1] + 0.012));
  return new THREE.LatheGeometry(pts, 24).scale(JACKET_SQUASH.x, JACKET_SQUASH.y, JACKET_SQUASH.z);
}

/** 外套轮廓在某个高度的半径。 */
function jacketRadius(y) {
  for (let i = 1; i < JACKET_PROFILE.length; i++) {
    const [r0, y0] = JACKET_PROFILE[i - 1];
    const [r1, y1] = JACKET_PROFILE[i];
    if (y <= y1) return THREE.MathUtils.lerp(r0, r1, THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1));
  }
  return JACKET_PROFILE[JACKET_PROFILE.length - 1][0];
}

/** 一段肢体：单位长度、两头粗细不同的圆台，之后被拉到两个关节之间。 */
function limb(fromRadius, toRadius, material, parent) {
  return mesh(new THREE.CylinderGeometry(toRadius, fromRadius, 1, 14).translate(0, 0.5, 0), material, parent);
}

/** 雪镜镜片的渐变贴图：金 → 橙 → 紫，带一道高光。 */
function lensTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const sweep = ctx.createLinearGradient(0, 0, 128, 64);
  sweep.addColorStop(0, '#ffd45e');
  sweep.addColorStop(0.5, '#f26f4a');
  sweep.addColorStop(1, '#a8479f');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(18, 64);
  ctx.lineTo(44, 0);
  ctx.lineTo(60, 0);
  ctx.lineTo(34, 64);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(44, 64);
  ctx.lineTo(70, 0);
  ctx.lineTo(76, 0);
  ctx.lineTo(50, 64);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 把一个贴片放到脸的球面上，朝外。yaw 是左右角，y 是相对头心的高度。 */
function onFace(object, yaw, y, lift = 0.003) {
  const ring = Math.sqrt(Math.max(0, FACE_R * FACE_R - y * y));
  const dir = new THREE.Vector3(Math.sin(yaw) * ring, y, Math.cos(yaw) * ring).normalize();
  object.position.set(0, HEAD_Y, 0).addScaledVector(dir, FACE_R + lift);
  object.quaternion.setFromUnitVectors(FORWARD, dir);
  return object;
}

function buildTorso(body, mats) {
  const torso = new THREE.Group();
  body.add(torso);
  mesh(lathe(JACKET_PROFILE), mats.jacket, torso);
  // 肩部拼色
  mesh(lathe(JACKET_PROFILE.slice(4), 0.007), mats.trim, torso);
  // 下摆松紧带
  mesh(lathe([[0.2, -0.045], [0.224, -0.02], [0.226, 0.035], [0.214, 0.05]]), mats.band, torso);
  for (const side of [1, -1]) {
    mesh(new THREE.SphereGeometry(0.098, 14, 10), mats.trim, torso).position.set(side * RIG.shoulder.x, RIG.shoulder.y, 0);
  }

  // 拉链沿着前襟的弧线走
  const front = [];
  for (let y = -0.02; y <= 0.44; y += 0.046) front.push(new THREE.Vector3(0, y, jacketRadius(y) * JACKET_SQUASH.z + 0.004));
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(front), 16, 0.009, 5), mats.band, torso, false);
  mesh(new THREE.BoxGeometry(0.075, 0.012, 0.012), mats.band, torso, false).position.set(-0.11, 0.2, jacketRadius(0.2) * JACKET_SQUASH.z - 0.012);

  // 背后：兜帽搭在背包上面
  mesh(new THREE.SphereGeometry(0.13, 16, 10).scale(1.35, 0.72, 0.85).translate(0, 0.43, -0.14), mats.jacket, torso);
  mesh(new THREE.CapsuleGeometry(0.088, 0.12, 4, 12).scale(1.3, 1, 0.78).translate(0, 0.2, -0.235), mats.accent, torso);
  mesh(new THREE.BoxGeometry(0.15, 0.07, 0.03).translate(0, 0.16, -0.31), mats.trim, torso, false);

  // 围脖
  mesh(new THREE.TorusGeometry(0.1, 0.052, 8, 18).rotateX(Math.PI / 2).scale(1, 1.15, 1).translate(0, 0.462, 0.008), mats.accent, torso);
  return torso;
}

function buildHead(torso, mats) {
  const head = new THREE.Group();
  head.position.set(0, 0.47, 0.01);
  torso.add(head);

  mesh(new THREE.SphereGeometry(FACE_R, 24, 18).translate(0, HEAD_Y, 0), mats.skin, head);
  // 头发：摘了头盔能看到头顶，戴着时只露后颈一撮
  mesh(new THREE.SphereGeometry(0.212, 18, 12, 0, Math.PI * 2, 0, 1.5).rotateX(-0.55).translate(0, HEAD_Y, 0), mats.hair, head);
  mesh(new THREE.SphereGeometry(0.085, 12, 8).scale(1.6, 0.8, 0.8).translate(0, 0.055, -0.15), mats.hair, head);

  const ink = new THREE.MeshBasicMaterial({ color: '#2a2530' });
  for (const side of [1, -1]) {
    onFace(mesh(new THREE.SphereGeometry(0.026, 10, 8).scale(1, 1.35, 0.4), ink, head, false), side * 0.36, 0.01);
    const blush = new THREE.MeshBasicMaterial({ color: '#f08f86', transparent: true, opacity: 0.6, depthWrite: false });
    onFace(mesh(new THREE.CircleGeometry(0.034, 14), blush, head, false), side * 0.66, -0.085);
  }
  const smile = new THREE.TorusGeometry(0.03, 0.0075, 5, 12, Math.PI).rotateZ(Math.PI);
  onFace(mesh(smile, new THREE.MeshBasicMaterial({ color: '#8c4a3d' }), head, false), 0, -0.1, -0.002);

  const helmet = new THREE.Group();
  head.add(helmet);
  const shell = new THREE.SphereGeometry(HELMET_R, 24, 16, 0, Math.PI * 2, 0, 1.75).rotateX(HELMET_TILT).translate(0, HEAD_Y, 0);
  mesh(shell, mats.helmet, helmet);
  // 头盔顶上一道色带，两侧护耳
  const stripe = new THREE.TorusGeometry(HELMET_R + 0.003, 0.013, 4, 22, Math.PI * 0.86)
    .rotateZ(Math.PI * 0.07)
    .rotateY(Math.PI / 2)
    .rotateX(HELMET_TILT)
    .translate(0, HEAD_Y, 0);
  mesh(stripe, mats.accent, helmet, false);
  for (const side of [1, -1]) {
    mesh(new THREE.SphereGeometry(0.062, 12, 10).scale(0.5, 1.1, 0.95), mats.band, helmet).position.set(side * 0.212, HEAD_Y - 0.05, -0.005);
  }

  const goggles = new THREE.Group();
  head.add(goggles);
  const arc = (radius, height, half) => new THREE.CylinderGeometry(radius, radius, height, 18, 1, false, -half, half * 2).translate(0, GOGGLE_Y, 0);
  mesh(arc(0.24, 0.132, 1.02), mats.band, goggles);
  mesh(arc(0.247, 0.098, 0.9), new THREE.MeshBasicMaterial({ map: lensTexture() }), goggles, false);
  mesh(new THREE.TorusGeometry(0.222, 0.014, 5, 28).rotateX(Math.PI / 2).scale(1, 2.1, 1).translate(0, GOGGLE_Y, 0), mats.accent, goggles, false);

  return { head, helmet, goggles };
}

function buildBoot(body, mats) {
  const boot = new THREE.Group();
  mesh(new THREE.CapsuleGeometry(0.078, 0.17, 4, 12).rotateX(Math.PI / 2).scale(1.05, 0.42, 1).translate(0, 0.034, 0.02), mats.sole, boot);
  mesh(new THREE.SphereGeometry(0.085, 14, 10).scale(0.98, 0.85, 1.65).translate(0, 0.105, 0.03), mats.boot, boot);
  mesh(new THREE.CylinderGeometry(0.086, 0.082, 0.2, 14).rotateX(0.1).translate(0, 0.2, -0.04), mats.boot, boot);
  // 脚背绑带
  mesh(new THREE.BoxGeometry(0.172, 0.032, 0.06).rotateX(-0.5).translate(0, 0.155, 0.07), mats.accent, boot, false);
  body.add(boot);
  return boot;
}

function buildLeg(body, mats, side) {
  const shin = limb(0.1, 0.128, mats.pants, body);
  // 裤脚收口
  mesh(new THREE.CylinderGeometry(0.133, 0.133, 0.14, 14).translate(0, 0.95, 0), mats.band, shin);
  return {
    side,
    thigh: limb(0.115, 0.1, mats.pants, body),
    shin,
    knee: mesh(new THREE.SphereGeometry(0.103, 12, 10), mats.pants, body),
    boot: buildBoot(body, mats),
  };
}

function buildArm(body, mats, side) {
  const fore = limb(0.08, 0.09, mats.jacket, body);
  // 袖口
  mesh(new THREE.CylinderGeometry(0.094, 0.094, 0.2, 14).translate(0, 0.93, 0), mats.trim, fore);
  const mitten = new THREE.Group();
  mesh(new THREE.SphereGeometry(0.086, 14, 10).scale(1, 1.2, 0.82).translate(0, 0.06, 0), mats.accent, mitten);
  mesh(new THREE.SphereGeometry(0.038, 10, 8).translate(side * -0.02, 0.05, 0.075), mats.accent, mitten);
  body.add(mitten);
  return {
    side,
    upper: limb(0.088, 0.08, mats.jacket, body),
    fore,
    elbow: mesh(new THREE.SphereGeometry(0.083, 12, 10), mats.jacket, body),
    mitten,
  };
}

/**
 * 程序生成的卡通滑手。返回各个可动部件，姿态由 Rider 每帧摆。
 * 身体各段是独立网格，靠两端的球形关节接起来。
 */
export function buildRiderModel() {
  const mats = Object.fromEntries(Object.entries(OUTFIT).map(([name, color]) => [name, toonMat(color, { rim: RIM })]));
  const body = new THREE.Group();
  const pelvis = mesh(new THREE.SphereGeometry(0.178, 16, 12).scale(1.15, 0.82, 0.95), mats.pants, body);
  const torso = buildTorso(body, mats);
  const { head, helmet, goggles } = buildHead(torso, mats);
  const legs = [1, -1].map((side) => buildLeg(body, mats, side));
  const arms = [1, -1].map((side) => buildArm(body, mats, side));
  return { body, pelvis, torso, head, helmet, goggles, legs, arms, mats };
}
