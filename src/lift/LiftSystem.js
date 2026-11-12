import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';

const TOWER_GAP = 130;
/** 塔柱撞得到的半径，比柱子本身略粗。 */
const TOWER_RADIUS = 0.55;
const BOARD_RADIUS = 26;
const MAX_RIDE_SECONDS = 40;
const FAST_FORWARD = 3;
/** 没人坐的线上，吊椅按索道速度的这个比例慢慢转。 */
const IDLE_SPEED = 0.5;
/** 玩家的落脚点在缆线下方多少米。 */
const SEAT_DROP = { gondola: 3.1, chair_lift: 2.65, magic_carpet: 0 };
/** 出站后落脚点离站房中心的距离，避免出生在房子里。 */
export const EXIT_OFFSET = 18;

const KIND = {
  gondola: { hang: 11, carrierGap: 170, station: [12, 6.5, 16] },
  chair_lift: { hang: 8, carrierGap: 70, station: [9, 4.5, 9] },
  magic_carpet: { hang: 0.25, carrierGap: 0, station: [4, 2.6, 5] },
};

export class LiftSystem {
  /** obstacles 可选：传进来就把站房和塔柱登记成障碍。 */
  constructor(world, terrain, obstacles = null) {
    this.world = world;
    this.terrain = terrain;
    this.obstacles = obstacles;
    this.group = new THREE.Group();
    this.group.name = 'Lifts';
    this.rides = [];
    this.active = null;
    this.t = 0;
    this.slot = 0;
    this.dummy = new THREE.Object3D();
    for (const lift of world.lifts) this.rides.push(this.build(lift));
    // 玩家自己坐的那一个轿厢 / 吊椅，颜色和别的不一样好认
    this.playerCarriers = {
      gondola: carrierMesh('gondola', '#e2a23b'),
      chair_lift: carrierMesh('chair_lift', '#e2a23b'),
    };
    for (const carrier of Object.values(this.playerCarriers)) {
      carrier.visible = false;
      this.group.add(carrier);
    }
  }

  hideCarriers() {
    for (const carrier of Object.values(this.playerCarriers)) carrier.visible = false;
  }

  build(lift) {
    const spec = KIND[lift.kind];
    // 魔毯贴地走，取点要密；架空索道每隔一段立一座塔
    const towers = Math.max(1, Math.round(lift.length / (lift.kind === 'magic_carpet' ? 14 : TOWER_GAP)));
    const points = [];
    for (let i = 0; i <= towers; i++) {
      const t = i / towers;
      const x = THREE.MathUtils.lerp(lift.bottom.x, lift.top.x, t);
      const z = THREE.MathUtils.lerp(lift.bottom.z, lift.top.z, t);
      const end = i === 0 || i === towers;
      points.push(new THREE.Vector3(x, this.terrain.heightAt(x, z) + (end ? Math.min(spec.hang, 5) : spec.hang), z));
    }
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    const heading = Math.atan2(lift.top.x - lift.bottom.x, lift.top.z - lift.bottom.z);
    // offset：整条线的吊椅沿缆线循环走了多少（0..1）
    const ride = { lift, spec, points, lengths, total: lengths[lengths.length - 1], heading, carriers: null, count: 0, offset: 0 };

    if (lift.kind === 'magic_carpet') {
      this.group.add(carpetBelt(points));
    } else {
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#2e343b' })));
      this.addTowers(points, heading, spec.hang);
      ride.count = Math.max(2, Math.floor(ride.total / spec.carrierGap));
      ride.carriers = carrierInstances(lift.kind, ride.count);
      this.group.add(ride.carriers.group);
    }
    for (const end of [lift.bottom, lift.top]) {
      const house = stationHouse(lift.kind, spec.station);
      house.position.set(end.x, this.terrain.heightAt(end.x, end.z) - 0.3, end.z);
      house.rotation.y = heading;
      this.group.add(house);
      // 魔毯两头只是个门框，人要从中间走过去，不挡
      if (lift.kind === 'magic_carpet') continue;
      const [width, height, depth] = spec.station;
      this.obstacles?.addBox(end.x, end.z, width / 2, depth / 2, heading, height + 1.5);
    }
    return ride;
  }

  addTowers(points, heading, hang) {
    const inner = points.slice(1, -1);
    if (!inner.length) return;
    const poleGeo = new THREE.CylinderGeometry(0.28, 0.42, 1, 6).translate(0, 0.5, 0);
    const armGeo = new THREE.BoxGeometry(4.4, 0.35, 0.5);
    const mat = toonMat('#74838a');
    const poles = new THREE.InstancedMesh(poleGeo, mat, inner.length);
    const arms = new THREE.InstancedMesh(armGeo, mat, inner.length);
    inner.forEach((p, i) => {
      this.dummy.position.set(p.x, p.y - hang - 0.5, p.z);
      this.dummy.rotation.set(0, heading, 0);
      this.dummy.scale.set(1, hang + 0.9, 1);
      this.dummy.updateMatrix();
      poles.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.set(p.x, p.y + 0.3, p.z);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      arms.setMatrixAt(i, this.dummy.matrix);
      this.obstacles?.addCircle(p.x, p.z, TOWER_RADIUS, hang);
    });
    poles.computeBoundingSphere();
    arms.computeBoundingSphere();
    this.group.add(poles, arms);
  }

  /** 沿缆线按弧长取点。 */
  pointAt(ride, t, out = new THREE.Vector3()) {
    const dist = THREE.MathUtils.clamp(t, 0, 1) * ride.total;
    let i = 1;
    while (i < ride.lengths.length - 1 && ride.lengths[i] < dist) i++;
    const span = ride.lengths[i] - ride.lengths[i - 1] || 1;
    return out.lerpVectors(ride.points[i - 1], ride.points[i], (dist - ride.lengths[i - 1]) / span);
  }

  nearestBottom(x, z) {
    let best = null;
    for (const ride of this.rides) {
      const d = Math.hypot(ride.lift.bottom.x - x, ride.lift.bottom.z - z);
      if (d < BOARD_RADIUS && (!best || d < best.d)) best = { ride, d };
    }
    return best?.ride.lift ?? null;
  }

  exitPoint(lift) {
    const x = lift.top.x + Math.sin(lift.exitYaw) * EXIT_OFFSET;
    const z = lift.top.z + Math.cos(lift.exitYaw) * EXIT_OFFSET;
    return { x, z, y: this.terrain.heightAt(x, z) };
  }

  board(lift, motor) {
    const ride = this.rides.find((r) => r.lift === lift);
    this.active = ride;
    this.t = 0;
    this.slot = ride.carriers ? this.nearestSlot(ride) : 0;
    motor.mode = 'lift';
    motor.seated = lift.kind === 'chair_lift';
    motor.vx = motor.vy = motor.vz = 0;
    motor.wipeout = 0;
  }

  /** 离下站最近的那个吊椅（刚出站或马上绕回来的），上车时整条线对齐到它。 */
  nearestSlot(ride) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < ride.count; i++) {
      const t = frac(i / ride.count + ride.offset);
      const gap = Math.min(t, 1 - t);
      if (gap >= bestGap) continue;
      best = i;
      bestGap = gap;
    }
    return best;
  }

  cancel() {
    this.active = null;
    this.hideCarriers();
  }

  /** 正在坐的是不是封闭轿厢（坐进去就看不到人）。 */
  get enclosed() {
    return this.active?.lift.kind === 'gondola';
  }

  update(dt, motor, input) {
    const riding = motor.mode === 'lift' ? this.active : null;
    if (riding) this.carryPlayer(riding, dt, motor, input);
    else this.hideCarriers();
    // 玩家可能刚好到站下车了，重新取一次
    const mine = motor.mode === 'lift' ? this.active : null;
    for (const ride of this.rides) this.moveCarriers(ride, dt, ride === mine);
  }

  /** 带着玩家沿缆线往上走，到顶就放下来。 */
  carryPlayer(ride, dt, motor, input) {
    const speed = Math.max(ride.lift.speed, ride.total / MAX_RIDE_SECONDS) * (input?.forward ? FAST_FORWARD : 1);
    this.t += (dt * speed) / ride.total;
    if (this.t >= 1) {
      this.dropOff(ride.lift, motor);
      return;
    }
    const p = this.pointAt(ride, this.t);
    motor.place(p.x, p.y - SEAT_DROP[ride.lift.kind], p.z, ride.heading);
    motor.onGround = false;
    motor.speed = speed;
    const carrier = this.playerCarriers[ride.lift.kind];
    if (!carrier) return;
    carrier.visible = true;
    carrier.position.copy(p);
    carrier.rotation.y = ride.heading;
  }

  dropOff(lift, motor) {
    const exit = this.exitPoint(lift);
    motor.mode = 'ride';
    motor.onGround = true;
    motor.place(exit.x, exit.y + 0.05, exit.z, lift.exitYaw);
    motor.vx = Math.sin(lift.exitYaw) * 3;
    motor.vy = 0;
    motor.vz = Math.cos(lift.exitYaw) * 3;
    this.cancel();
  }

  /**
   * 摆好一条线上的所有吊椅 / 轿厢。
   * 玩家坐着的这条线整体跟着玩家走（包括快进），前后的吊椅才不会被追上穿过去；
   * 玩家占的那个位置由醒目的专属吊椅顶替，原来那个藏起来。
   */
  moveCarriers(ride, dt, mine) {
    if (!ride.carriers) return;
    const idle = (dt * ride.lift.speed * IDLE_SPEED) / ride.total;
    ride.offset = frac(mine ? this.t - this.slot / ride.count : ride.offset + idle);
    const p = new THREE.Vector3();
    for (let i = 0; i < ride.count; i++) {
      this.pointAt(ride, frac(i / ride.count + ride.offset), p);
      this.dummy.position.copy(p);
      this.dummy.rotation.set(0, ride.heading, 0);
      this.dummy.scale.setScalar(mine && i === this.slot ? 0 : 1);
      this.dummy.updateMatrix();
      for (const mesh of ride.carriers.meshes) mesh.setMatrixAt(i, this.dummy.matrix);
    }
    for (const mesh of ride.carriers.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}

function frac(x) {
  return x - Math.floor(x);
}

function stationHouse(kind, [width, height, depth]) {
  const group = new THREE.Group();
  if (kind === 'magic_carpet') {
    const arch = new THREE.Mesh(new THREE.BoxGeometry(width, 0.4, depth), toonMat('#4f8fb3'));
    arch.position.y = height;
    group.add(arch);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, height, 0.3), toonMat('#74838a'));
      post.position.set(side * (width / 2 - 0.2), height / 2, 0);
      group.add(post);
    }
    return group;
  }
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), toonMat('#ece6da'));
  wall.position.y = height / 2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 1.6, 0.9, depth + 1.6), toonMat(kind === 'gondola' ? '#3f7d8c' : '#b5633c'));
  roof.position.y = height + 0.45;
  const snow = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 0.5, depth + 1.2), toonMat('#f6f8f7'));
  snow.position.y = height + 1.1;
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(width * 0.55, height * 0.6, 0.4), toonMat('#3b444d'));
  mouth.position.set(0, height * 0.42, depth / 2 + 0.05);
  const mouthBack = mouth.clone();
  mouthBack.position.z = -depth / 2 - 0.05;
  group.add(wall, roof, snow, mouth, mouthBack);
  return group;
}

/** 轿厢或吊椅的零件（几何体原点在缆线上）。 */
function carrierParts(kind, bodyColor) {
  if (kind === 'gondola') {
    return [
      [new THREE.BoxGeometry(0.16, 1.7, 0.16).translate(0, -0.85, 0), toonMat('#3b444d')],
      [new THREE.BoxGeometry(2.3, 2.3, 2.5).translate(0, -2.8, 0), toonMat(bodyColor)],
      [new THREE.BoxGeometry(2.36, 0.95, 2.56).translate(0, -2.45, 0), toonMat('#2f4352')],
    ];
  }
  return [
    [new THREE.BoxGeometry(0.12, 2.4, 0.12).translate(0, -1.2, -0.4), toonMat('#3b444d')],
    [new THREE.BoxGeometry(2.2, 0.18, 0.7).translate(0, -2.4, 0), toonMat(bodyColor)],
    [new THREE.BoxGeometry(2.2, 0.8, 0.14).translate(0, -2.0, -0.35), toonMat(bodyColor)],
  ];
}

function carrierInstances(kind, count) {
  const group = new THREE.Group();
  const meshes = carrierParts(kind, kind === 'gondola' ? '#c8473c' : '#b5633c').map(([geo, mat]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  });
  return { group, meshes };
}

function carrierMesh(kind, bodyColor) {
  const group = new THREE.Group();
  for (const [geo, mat] of carrierParts(kind, bodyColor)) group.add(new THREE.Mesh(geo, mat));
  return group;
}

/** 魔毯：贴地的一条深色传送带。 */
function carpetBelt(points) {
  const positions = [];
  const indices = [];
  const half = 0.9;
  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
    const nx = -(next.z - prev.z) / len;
    const nz = (next.x - prev.x) / len;
    positions.push(p.x - nx * half, p.y, p.z - nz * half, p.x + nx * half, p.y, p.z + nz * half);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#39424b', side: THREE.DoubleSide }));
}
