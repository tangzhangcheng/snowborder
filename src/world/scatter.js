import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 站房周围、停着的车周围各留出这么多米的空地，不往上摆东西。 */
const STATION_CLEARANCE = 26;
const VEHICLE_CLEARANCE = 6;
/** 山脚营地：木屋在山脚站东边、南边各多少米，营地占多大一圈（米）。圈里不长树不摆石头，留给木屋和小摆设。 */
const CAMP = { east: 46, south: 38, radius: 44 };
/** 索道线正下方两侧各留这么多米。 */
const LIFT_CLEARANCE = 16;
/** 散布的东西默认分成几乘几块，离得远的整块不画。 */
const CHUNKS = 6;

/** 两个整数换一个 0–1 的随机数，同样的输入永远得到同样的结果。 */
export function hash(ix, iz) {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** 平滑的二维噪声（0–1），用来圈出成片的林子、乱石滩。 */
export function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const top = hash(ix, iz) * (1 - sx) + hash(ix + 1, iz) * sx;
  const bottom = hash(ix, iz + 1) * (1 - sx) + hash(ix + 1, iz + 1) * sx;
  return top * (1 - sz) + bottom * sz;
}

export function distToSeg(px, pz, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((px - a.x) * abx + (pz - a.z) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  return Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t));
}

/**
 * 抖动网格：每格出一个候选点，在格子里随机偏开，看上去不成行成列。
 * seed 让不同的东西各用一套随机数；roll(n) 是这一格的第 n 个随机数（0–1）。
 */
export function* jitteredGrid(worldSize, spacing, seed) {
  const cells = Math.floor(worldSize / spacing);
  for (let cz = 1; cz < cells - 1; cz++) {
    for (let cx = 1; cx < cells - 1; cx++) {
      const roll = (n) => hash(cx + seed + n * 53, cz + seed * 3 + n * 97);
      yield { x: (cx + 0.1 + roll(0) * 0.8) * spacing, z: (cz + 0.1 + roll(1) * 0.8) * spacing, roll };
    }
  }
}

/** 每个山脚营地的中心（也就是大木屋的位置）。 */
export function campCentres(world) {
  return world.pois.filter((poi) => poi.kind === 'base').map((poi) => ({ x: poi.x + CAMP.east, z: poi.z + CAMP.south }));
}

/** 这个点是不是落在哪个山脚营地的圈里。 */
export function inCamp(world, x, z) {
  return campCentres(world).some((camp) => Math.hypot(camp.x - x, camp.z - z) < CAMP.radius);
}

/**
 * 这个点是不是没被占着：不在雪道上（边线外再让出 margin 米），不在索道线下，不挨着站房和停着的车。
 * @param {{ pistes: object, world: object }} ctx
 */
export function isClear({ pistes, world }, x, z, margin = 0) {
  if (pistes.locate(x, z, margin)) return false;
  if (world.lifts.some((lift) => distToSeg(x, z, lift.bottom, lift.top) < LIFT_CLEARANCE)) return false;
  const within = (site, reach) => Math.hypot(site.x - x, site.z - z) < reach;
  if (world.pois.some((poi) => poi.kind === 'station' && within(poi, STATION_CLEARANCE))) return false;
  return !world.vehicles.some((vehicle) => within(vehicle, VEHICLE_CLEARANCE));
}

/** 这个点能不能随手摆点东西：没被占着，也不在山脚营地里（那里另有安排）。 */
export function isFree(ctx, x, z, margin = 0) {
  return isClear(ctx, x, z, margin) && !inCamp(ctx.world, x, z);
}

/** 给几何体刷顶点色：pick(顶点位置, 顶点法线) 返回这个顶点的颜色。 */
export function paint(geo, pick) {
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const color = pick(p.fromBufferAttribute(pos, i), normal ? n.fromBufferAttribute(normal, i) : n);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** 整个几何体刷成一个颜色。合并几何体前用，合并后一个材质就能画出好几种颜色。 */
export function paintFlat(geo, color) {
  const flat = new THREE.Color(color);
  return paint(geo, () => flat);
}

/** 把几块刷好顶点色的几何体并成一个。带索引和不带索引的不能直接并，先统一拆成不带索引的。 */
export function mergeParts(parts) {
  return mergeGeometries(parts.map((geo) => (geo.index ? geo.toNonIndexed() : geo)));
}

/**
 * 把一批散布点 { x, y, z, turn, scale } 做成 InstancedMesh，按地块分开，离得远的地块整块被视锥剔除。
 * scale 可以是一个数，也可以是 [x, y, z]。
 */
export function instanceByChunk(spots, geometry, material, worldSize) {
  const group = new THREE.Group();
  const size = worldSize / CHUNKS;
  const cell = (v) => Math.min(CHUNKS - 1, Math.max(0, Math.floor(v / size)));
  const buckets = new Map();
  for (const spot of spots) {
    const key = cell(spot.z) * CHUNKS + cell(spot.x);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(spot);
  }
  const dummy = new THREE.Object3D();
  for (const bucket of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, bucket.length);
    bucket.forEach((spot, i) => {
      dummy.position.set(spot.x, spot.y, spot.z);
      dummy.rotation.set(0, spot.turn ?? 0, 0);
      if (Array.isArray(spot.scale)) dummy.scale.set(...spot.scale);
      else dummy.scale.setScalar(spot.scale ?? 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  group.userData.count = spots.length;
  return group;
}
