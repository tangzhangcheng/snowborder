import * as THREE from 'three';

const VIEW = {
  ride: { dist: 6.2, height: 2.6, ahead: 12 },
  walk: { dist: 5.5, height: 2.4, ahead: 8 },
  drive: { dist: 9, height: 3.6, ahead: 12 },
  lift: { dist: 13, height: 3.5, ahead: 10, swing: 0.6 },
};
const BASE_FOV = 50;
const MIN_CLEARANCE = 1.3;
/** 右键拖动转视角：每像素转多少弧度。 */
const LOOK_SENSITIVITY = 0.005;
/** 镜头仰角（从水平面往上量）的上下限，免得钻进雪里或翻过头顶。 */
const ELEVATION = [-0.1, 1.35];
/** 镜头压到最低后继续往上拖，最多还能抬头多少弧度：加上半个视野，正好够看到头顶。 */
const SKY_TILT = 1.25;
/** 松开右键后视角回到身后的快慢。 */
const LOOK_RETURN = 4;
/** 视角转开多少弧度后，镜头就完全盯着人看而不是看前方的路。 */
const LOOK_FOCUS = { yaw: 0.6, pitch: 0.35 };

/** 跟在滑行方向后面的第三人称镜头。 */
export class RideCamera {
  constructor(camera) {
    this.camera = camera;
    this.dir = new THREE.Vector3(0, 0, 1);
    this.look = new THREE.Vector3();
    this.dist = VIEW.ride.dist;
    this.height = VIEW.ride.height;
    this.roll = 0;
    this.swing = 0;
    this.ready = false;
    // 玩家按住右键转出来的视角偏移
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.looking = false;
  }

  /** 按住或松开右键。松开后视角自己回到身后。 */
  setLooking(on) {
    this.looking = on;
  }

  /**
   * 右键拖动：鼠标往右，视角往右转；鼠标往下，镜头升高俯视；
   * 鼠标往上，镜头先压低，压到底以后再往上拖就是抬头看天。
   */
  pan(dx, dy) {
    if (!this.looking) return;
    this.lookYaw = wrapAngle(this.lookYaw - dx * LOOK_SENSITIVITY);
    // 夹在上下限以内，拖到头再往回拖时马上有反应
    const base = Math.atan2(this.height, this.dist);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + dy * LOOK_SENSITIVITY, ELEVATION[0] - SKY_TILT - base, ELEVATION[1] - base);
  }

  /** 镜头已经压到最低、还继续往上拖的那一段，变成抬头的角度（弧度）。 */
  skyTilt() {
    const below = ELEVATION[0] - (Math.atan2(this.height, this.dist) + this.lookPitch);
    return THREE.MathUtils.clamp(below, 0, SKY_TILT);
  }

  update(motor, dt) {
    const view = VIEW[motor.mode] ?? VIEW.ride;
    const k = (rate) => 1 - Math.exp(-rate * Math.max(dt, 0.001));
    if (!this.looking) {
      this.lookYaw *= 1 - k(LOOK_RETURN);
      this.lookPitch *= 1 - k(LOOK_RETURN);
    }

    // 有速度时跟着行进方向走（搓雪、转体时镜头不跟着板子乱甩），慢下来再跟板头
    const speed = Math.hypot(motor.vx, motor.vz);
    const want = speed > 2.5
      ? new THREE.Vector3(motor.vx / speed, 0, motor.vz / speed)
      : new THREE.Vector3(Math.sin(motor.yaw), 0, Math.cos(motor.yaw));
    if (!this.ready) this.dir.copy(want);
    this.dir.lerp(want, k(motor.onGround ? 4.5 : 2)).setY(0);
    if (this.dir.lengthSq() < 1e-6) this.dir.copy(want);
    this.dir.normalize();

    this.dist = THREE.MathUtils.lerp(this.dist, view.dist + Math.min(2.5, motor.speed * 0.06), k(4));
    this.height = THREE.MathUtils.lerp(this.height, view.height, k(4));

    // 坐索道时镜头绕到斜后方，看得见人也看得见山
    this.swing = THREE.MathUtils.lerp(this.swing, view.swing ?? 0, k(2.5));
    const around = this.swing + this.lookYaw;
    const cos = Math.cos(around);
    const sin = Math.sin(around);
    const backX = this.dir.x * cos + this.dir.z * sin;
    const backZ = this.dir.z * cos - this.dir.x * sin;

    // 镜头在以人为球心的球面上：没转视角时正好落在原来的距离和高度
    const radius = Math.hypot(this.dist, this.height);
    const elevation = THREE.MathUtils.clamp(Math.atan2(this.height, this.dist) + this.lookPitch, ELEVATION[0], ELEVATION[1]);
    const flat = radius * Math.cos(elevation);
    const terrain = motor.terrain;
    const pos = this.camera.position;
    pos.set(motor.x - backX * flat, motor.y + radius * Math.sin(elevation), motor.z - backZ * flat);
    const floor = terrain.heightAt(pos.x, pos.z) + MIN_CLEARANCE;
    if (pos.y < floor) pos.y = floor;

    const ax = motor.x + this.dir.x * view.ahead;
    const az = motor.z + this.dir.z * view.ahead;
    const ground = motor.mode === 'lift' ? motor.y : terrain.heightAt(ax, az);
    // 腾空时看向人和落点之间，别让人飞出画面
    const target = new THREE.Vector3(ax, THREE.MathUtils.lerp(ground, motor.y, 0.45) + 1.1, az);
    // 视角转开以后改成盯着人看，不然绕到前面时人会跑到镜头背后
    target.lerp(new THREE.Vector3(motor.x, motor.y + 1.1, motor.z), this.focus());
    if (!this.ready) this.look.copy(target);
    this.look.lerp(target, k(7));
    this.ready = true;

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.camera.rotateX(this.skyTilt());
    // 压刃时镜头跟着轻轻侧倾
    this.roll = THREE.MathUtils.lerp(this.roll, motor.mode === 'ride' ? -motor.edge * 0.07 : 0, k(5));
    this.camera.rotateZ(this.roll);

    const fov = BASE_FOV + Math.min(18, motor.speed * 0.5);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, k(3));
    this.camera.updateProjectionMatrix();
  }

  /** 视角被转开的程度，0 = 正常跟随，1 = 完全盯着人。 */
  focus() {
    const turned = Math.max(Math.abs(this.lookYaw) / LOOK_FOCUS.yaw, Math.abs(this.lookPitch) / LOOK_FOCUS.pitch);
    return THREE.MathUtils.smoothstep(turned, 0, 1);
  }

  /** 标题画面：绕着滑手慢慢转。 */
  orbit(motor, time) {
    const angle = motor.yaw + Math.PI + 0.9 + Math.sin(time * 0.12) * 0.5;
    const radius = 9.5;
    const pos = this.camera.position;
    pos.set(motor.x + Math.sin(angle) * radius, motor.y + 2.6, motor.z + Math.cos(angle) * radius);
    const floor = motor.terrain.heightAt(pos.x, pos.z) + MIN_CLEARANCE;
    if (pos.y < floor) pos.y = floor;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(motor.x, motor.y + 1.1, motor.z);
    this.camera.fov = BASE_FOV - 6;
    this.camera.updateProjectionMatrix();
    this.ready = false;
  }

  snap(motor) {
    this.ready = false;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.update(motor, 1);
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
