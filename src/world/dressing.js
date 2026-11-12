import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMat } from '../render/Toon.js';
import { campCentres, distToSeg, hash, inCamp, valueNoise } from './scatter.js';

const TREE_SPACING = 24;
const TREE_CHUNKS = 6;
/** 林线的海拔（米）：再往上就没有树了。 */
export const TREELINE = 2280;
const LIFT_CLEARANCE = 16;
/** 一棵标准大小的树：撞得到的半径和高度（米），按树的缩放再乘。 */
const TRUNK_RADIUS = 0.5;
const TREE_HEIGHT = 6.5;
const LODGE = { width: 22, depth: 12, height: 9 };

/** 这里的针叶林有多密（0–1）：成片的林子，中间留出林间空地。超过 FOREST_EDGE 才长树。 */
export function forestDensity(x, z) {
  return valueNoise(x * 0.0021, z * 0.0021) * 0.65 + valueNoise(x * 0.008, z * 0.008) * 0.35;
}
export const FOREST_EDGE = 0.42;

/** 一棵针叶树：树干 + 三层伞状树冠，冠尖带雪。 */
function treeGeometry() {
  const paint = (geo, bottom, top) => {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox;
    const low = new THREE.Color(bottom);
    const high = new THREE.Color(top);
    const mixed = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
      mixed.copy(low).lerp(high, t * t);
      colors.set([mixed.r, mixed.g, mixed.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  };
  const trunk = paint(new THREE.CylinderGeometry(0.16, 0.26, 1.6, 5, 1, true).translate(0, 0.8, 0), '#4d3b2f', '#4d3b2f');
  const tiers = [
    [1.9, 3.0, 1.2],
    [1.45, 2.7, 2.9],
    [0.95, 2.5, 4.5],
  ].map(([radius, height, base]) =>
    paint(new THREE.ConeGeometry(radius, height, 6, 1, true).translate(0, base + height / 2, 0), '#24553c', '#eef3f2'),
  );
  return mergeGeometries([trunk, ...tiers]);
}

function scatterTrees(terrain, pistes, world) {
  const chunkSize = terrain.worldSize / TREE_CHUNKS;
  const chunks = Array.from({ length: TREE_CHUNKS * TREE_CHUNKS }, () => []);
  const cells = Math.floor(terrain.worldSize / TREE_SPACING);
  for (let cz = 1; cz < cells - 1; cz++) {
    for (let cx = 1; cx < cells - 1; cx++) {
      const x = (cx + 0.15 + hash(cx, cz) * 0.7) * TREE_SPACING;
      const z = (cz + 0.15 + hash(cz + 911, cx) * 0.7) * TREE_SPACING;
      if (forestDensity(x, z) < FOREST_EDGE) continue;
      const sample = terrain.sample(x, z);
      const line = TREELINE + (valueNoise(x * 0.0012 + 40, z * 0.0012) - 0.5) * 320;
      if (sample.height > line || sample.slope > 0.66) continue;
      if (pistes.locate(x, z, 9) || inCamp(world, x, z)) continue;
      if (world.lifts.some((lift) => distToSeg(x, z, lift.bottom, lift.top) < LIFT_CLEARANCE)) continue;
      // 越靠近林线树越矮
      const stunt = THREE.MathUtils.clamp((line - sample.height) / 260, 0.45, 1);
      const index = Math.min(TREE_CHUNKS - 1, Math.floor(z / chunkSize)) * TREE_CHUNKS + Math.min(TREE_CHUNKS - 1, Math.floor(x / chunkSize));
      chunks[index].push({ x, y: sample.height - 0.15, z, scale: (0.75 + hash(cx + 37, cz + 91) * 0.75) * stunt, turn: hash(cz, cx + 5) * Math.PI * 2 });
    }
  }
  return chunks;
}

/** obstacles 可选：传进来就把每棵树的树干登记成障碍。 */
export function buildTrees(terrain, pistes, world, obstacles = null) {
  const group = new THREE.Group();
  group.name = 'Trees';
  const geo = treeGeometry();
  const mat = toonMat('#ffffff', { vertexColors: true });
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let total = 0;
  for (const spots of scatterTrees(terrain, pistes, world)) {
    if (!spots.length) continue;
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.turn, 0);
      dummy.scale.set(s.scale, s.scale * (0.9 + (s.turn % 1) * 0.25), s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.setHSL(0, 0, 0.82 + (s.turn % 0.9) * 0.2));
      // 只挡树干和最密的那一圈枝叶，外圈的枝条可以擦着过
      obstacles?.addCircle(s.x, s.z, TRUNK_RADIUS * s.scale, TREE_HEIGHT * s.scale);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    total += spots.length;
  }
  group.userData.count = total;
  return group;
}

/** 山脚的木屋：墙体 + 人字顶 + 屋顶积雪。wallColor 是木墙的颜色。 */
export function lodge(width, depth, wallColor = '#b7774a') {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 5, depth), toonMat(wallColor));
  wall.position.y = 2.5;
  const base = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 1.2, depth + 0.6), toonMat('#8d8a86'));
  base.position.y = 0.6;
  const gable = new THREE.Shape();
  gable.moveTo(-width / 2 - 1.2, 0);
  gable.lineTo(0, 4.2);
  gable.lineTo(width / 2 + 1.2, 0);
  gable.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(gable, { depth: depth + 2, bevelEnabled: false });
  roofGeo.translate(0, 5, -(depth + 2) / 2);
  const roof = new THREE.Mesh(roofGeo, toonMat('#f4f6f4'));
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.3), toonMat('#5d4636'));
  door.position.set(0, 1.5, depth / 2 + 0.1);
  group.add(base, wall, roof, door);
  for (const side of [-1, 1]) {
    // 窗户不吃光照，天黑了自己亮着
    const pane = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.3), new THREE.MeshBasicMaterial({ color: '#f2c14e' }));
    pane.position.set(side * width * 0.3, 3, depth / 2 + 0.1);
    group.add(pane);
  }
  return group;
}

export function buildLodges(terrain, world, obstacles = null) {
  const group = new THREE.Group();
  group.name = 'Lodges';
  for (const { x, z } of campCentres(world)) {
    const house = lodge(LODGE.width, LODGE.depth);
    house.position.set(x, terrain.heightAt(x, z) - 0.4, z);
    house.rotation.y = Math.PI;
    group.add(house);
    obstacles?.addBox(x, z, LODGE.width / 2 + 0.3, LODGE.depth / 2 + 0.3, Math.PI, LODGE.height);
  }
  return group;
}
