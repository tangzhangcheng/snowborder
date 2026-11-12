import * as THREE from 'three';

const PUFFS = 360;
const PUFF_LIFE = 0.6;
const G = 9.81;
/** 每秒最多扬起多少粒，再多池子就不够用了。 */
const MAX_RATE = 300;
/** 雪粒半径（米）：基础值、随机浮动、速度带来的加成上限。 */
const PUFF_SIZE = { base: 0.022, jitter: 0.04, fast: 0.022 };

/**
 * 板刃扬起的雪：一大片细碎的雪粒，鼓一下就散掉。
 * 走刃时往弯外侧甩，搓雪时往前喷。
 */
export class SnowSpray {
  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial(), PUFFS);
    this.mesh.name = 'SnowSpray';
    this.mesh.frustumCulled = false;
    // 白和淡蓝混着来，一团雪才有层次
    const tint = new THREE.Color();
    for (let i = 0; i < PUFFS; i++) this.mesh.setColorAt(i, tint.set(i % 3 === 0 ? '#dce8f3' : '#ffffff'));
    this.puffs = Array.from({ length: PUFFS }, () => ({ life: 0, span: PUFF_LIFE, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0 }));
    this.cursor = 0;
    this.debt = 0;
    this.dummy = new THREE.Object3D();
    this.write();
  }

  /** 这一帧该扬多少雪（每秒粒数）。 */
  rate(motor) {
    if (motor.mode !== 'ride' || !motor.onGround || motor.speed < 3) return 0;
    const carve = Math.max(0, Math.abs(motor.edge) - 0.35) * motor.speed * 9;
    const scrape = motor.slip * 20;
    const loose = motor.surface === 'powder' ? 1.5 : 1;
    return Math.min(MAX_RATE, (carve + scrape) * loose);
  }

  /** 板子此刻的朝向和雪面，一帧里所有新雪粒共用。 */
  boardFrame(motor) {
    const normal = motor.terrain.sample(motor.x, motor.z).normal;
    const { forward, right } = motor.axes(motor.yaw + motor.skid, normal);
    return { normal, forward, right, out: -Math.sign(motor.edge || 1), braking: Math.abs(motor.skid) > 0.3 };
  }

  emit(motor, { normal, forward, right, out, braking }) {
    const puff = this.puffs[this.cursor];
    this.cursor = (this.cursor + 1) % PUFFS;
    puff.span = PUFF_LIFE * (0.6 + Math.random() * 0.6);
    puff.life = puff.span;
    puff.size = PUFF_SIZE.base + Math.random() * PUFF_SIZE.jitter + Math.min(PUFF_SIZE.fast, motor.speed * 0.001);
    puff.pos
      .set(motor.x, motor.y, motor.z)
      .addScaledVector(forward, (Math.random() - 0.5) * 1.3)
      .addScaledVector(right, out * (0.08 + Math.random() * 0.1));
    puff.vel.set(motor.vx, motor.vy, motor.vz).multiplyScalar(braking ? 0.75 : 0.3);
    // 速度散得开一些，雪粒才是一片扇面而不是一条线
    puff.vel
      .addScaledVector(right, out * (braking ? Math.random() - 0.5 : 0.8 + Math.random() * 3.4))
      .addScaledVector(forward, (Math.random() - 0.5) * 1.6)
      .addScaledVector(normal, 0.6 + Math.random() * 3);
  }

  update(motor, dt) {
    this.debt += this.rate(motor) * dt;
    if (this.debt >= 1) {
      const frame = this.boardFrame(motor);
      for (; this.debt >= 1; this.debt -= 1) this.emit(motor, frame);
    }
    for (const puff of this.puffs) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      puff.vel.y -= G * 0.45 * dt;
      puff.vel.multiplyScalar(Math.exp(-2.2 * dt));
      puff.pos.addScaledVector(puff.vel, dt);
    }
    this.write();
  }

  write() {
    this.puffs.forEach((puff, i) => {
      // left：剩余寿命占比。刚扬起时一下鼓出来，之后一路缩小，飘到镜头跟前时已经很细了
      const left = Math.max(0, puff.life) / puff.span;
      const scale = puff.size * Math.min(1, (1 - left) * 7) * left ** 0.8 * 1.3;
      this.dummy.position.copy(puff.pos);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** 脚下的一团软影子，离地越高越淡越小。 */
export class BlobShadow {
  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: '#31506b',
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.mesh.name = 'BlobShadow';
    this.mesh.renderOrder = 2;
    this.up = new THREE.Vector3(0, 1, 0);
  }

  update(motor) {
    const sample = motor.terrain.sample(motor.x, motor.z);
    const height = Math.max(0, motor.y - sample.height);
    const fade = 1 / (1 + height * 0.35);
    this.mesh.visible = motor.mode !== 'lift';
    this.mesh.position.set(motor.x, sample.height + 0.06, motor.z);
    this.mesh.quaternion.setFromUnitVectors(this.up, sample.normal);
    const heading = motor.yaw + (motor.skid ?? 0);
    this.mesh.rotateY(heading);
    // 踩着板时影子是长条的，下了板就是脚下一小团
    const [wide, long] = motor.mode === 'ride' ? [0.42, 0.82] : [0.32, 0.32];
    this.mesh.scale.set(wide * fade + 0.1, 1, long * fade + 0.1);
    this.mesh.material.opacity = 0.3 * fade;
  }
}
