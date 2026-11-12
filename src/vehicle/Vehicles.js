import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';

/** 车身占的圆的半径，用来和树、房子算碰撞。 */
const BODY_RADIUS = 1.3;
/** 顶在障碍上时每秒掉多少速度（指数衰减率）。 */
const SCRAPE_DRAG = 6;

export class Vehicles {
  constructor(world, terrain, obstacles = null) {
    this.terrain = terrain;
    this.obstacles = obstacles;
    this.list = [];
    this.group = new THREE.Group();
    this.occupied = null;
    for (const spec of world.vehicles) this.spawn(spec);
  }

  spawn(spec) {
    const mesh = spec.type === 'truck' ? truck() : snowmobile();
    const y = this.terrain.heightAt(spec.x, spec.z);
    mesh.position.set(spec.x, y, spec.z);
    this.group.add(mesh);
    this.list.push({
      spec,
      mesh,
      x: spec.x,
      z: spec.z,
      yaw: 0,
      speed: 0,
    });
  }

  nearest(x, z, radius = 7) {
    let best = null;
    for (const v of this.list) {
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < radius && (!best || d < best.d)) best = { v, d };
    }
    return best?.v ?? null;
  }

  enter(v, motor) {
    this.occupied = v;
    motor.mode = 'drive';
    motor.vx = motor.vy = motor.vz = 0;
  }

  exit(motor) {
    if (!this.occupied) return;
    const v = this.occupied;
    this.occupied = null;
    motor.mode = 'ride';
    motor.onGround = true;
    const side = v.yaw + Math.PI / 2;
    motor.place(
      v.x + Math.sin(side) * 2.4,
      this.terrain.heightAt(v.x, v.z) + 0.05,
      v.z + Math.cos(side) * 2.4,
      v.yaw,
    );
    motor.vx = 0;
    motor.vz = 0;
  }

  update(dt, input, motor) {
    const v = this.occupied;
    if (!v || motor.mode !== 'drive') return;
    const turn = input.turn || input.edge;
    // yaw 减小 = 向右转，和滑行时一致
    v.yaw -= turn * dt * (1.2 + Math.min(1, v.speed / 10));
    const accel = (input.forward - input.brake) * (v.spec.type === 'snowmobile' ? 14 : 9);
    v.speed += accel * dt;
    v.speed *= 1 - dt * 0.35;
    v.speed = THREE.MathUtils.clamp(v.speed, v.spec.type === 'truck' ? -4 : 0, v.spec.type === 'snowmobile' ? 22 : 16);
    v.x += Math.sin(v.yaw) * v.speed * dt;
    v.z += Math.cos(v.yaw) * v.speed * dt;
    const inset = 40;
    v.x = THREE.MathUtils.clamp(v.x, inset, this.terrain.worldSize - inset);
    v.z = THREE.MathUtils.clamp(v.z, inset, this.terrain.worldSize - inset);
    // 撞到树或房子：推出来，车速很快掉下去，斜着的话会顺着滑开
    const hit = this.obstacles?.hit(v.x, v.z, BODY_RADIUS);
    if (hit) {
      v.x += hit.nx * hit.depth;
      v.z += hit.nz * hit.depth;
      if (Math.abs(v.speed) > 4) motor.events.push({ type: 'bump', speed: Math.abs(v.speed) });
      v.speed *= Math.exp(-SCRAPE_DRAG * dt);
    }
    const h = this.terrain.heightAt(v.x, v.z);
    v.mesh.position.set(v.x, h + 0.05, v.z);
    v.mesh.rotation.y = v.yaw;
    const sample = this.terrain.sample(v.x, v.z);
    v.mesh.rotation.z = -sample.normal.x * 0.6;
    v.mesh.rotation.x = sample.normal.z * 0.6;
    motor.place(v.x, h + 0.35, v.z, v.yaw);
    motor.speed = Math.abs(v.speed);
    motor.vx = Math.sin(v.yaw) * v.speed;
    motor.vz = Math.cos(v.yaw) * v.speed;
  }
}

function truck() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.6), toonMat('#c4473a'));
  body.position.y = 0.85;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1.6), toonMat('#e8e4dc'));
  cab.position.set(0, 1.35, 0.6);
  g.add(body, cab);
  for (const [x, z] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10), toonMat('#222'));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.38, z);
    g.add(w);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

function snowmobile() {
  const g = new THREE.Group();
  const ski = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.3), toonMat('#d9dde2'));
  ski.position.set(0, 0.2, 0.9);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 1.8), toonMat('#e07a2f'));
  hull.position.set(0, 0.5, -0.1);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.7), toonMat('#2a2d32'));
  seat.position.set(0, 0.78, -0.2);
  g.add(ski, hull, seat);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}
