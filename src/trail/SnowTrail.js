import * as THREE from 'three';
import { createTrailMaterial } from '../render/trailMaterial.js';

const { lerp, smoothstep } = THREE.MathUtils;

const MAX_SEGMENTS = 3200;
/** 每隔多远（米）记一截。 */
const STEP = 0.4;
/** 两次记录隔了这么远（米），说明人是被挪过去的（救援、下索道），中间不连线。 */
const MAX_GAP = 3;
/** 抬离雪面（米），避免和地形抢深度而闪烁。 */
const LIFT = 0.045;
/** 板子着地的那一段有多长、多宽（米）。板头板尾是翘起来的，不算。 */
const BOARD = { length: 1.3, width: 0.27 };
/**
 * 两种雪上立刃留下的痕迹不一样。
 * edgeCut：只剩板刃着地时吃进雪里的那一条有多宽（米）；carve：这条痕迹最多有几成像"刻出来的沟"。
 * 压实的雪上是窄窄一道利落的沟；粉雪松软，板子陷得深，只是一道一侧更陡的宽槽。
 */
const PACKED = { edgeCut: 0.085, carve: 1 };
const POWDER = { edgeCut: 0.18, carve: 0.45 };
/** 板面滚转到这么多弧度，就只剩板刃那一条着地。 */
const EDGE_ONLY_ROLL = 0.35;
/** 滚转从前者到后者（弧度），痕迹从压出来的一条变成刻出来的沟。 */
const CARVE_ROLL = [0.1, 0.4];
/** 板子和行进方向夹角的正弦从前者到后者，痕迹从顺着走的一条变成搓出来的一片。 */
const SCRAPE_SLIP = [0.12, 0.5];
/** 着地带两侧多留出的宽度（米）：平时只够画一道雪沿，走刃时弯外侧要放得下甩出去的碎雪。 */
const MARGIN = { rim: 0.08, spray: 0.45 };
/** 硬壳陡坡上板子几乎留不下印子。 */
const CRUST_FADE = 0.4;
/** 慢到这个速度（米/秒）以下，行进方向就按板头朝向算。 */
const MIN_TRAVEL_SPEED = 0.5;
/** “顺着痕迹走了多远”累计到这么多米就折回去，免得数字太大、着色器里的噪声失了精度。 */
const ALONG_WRAP = 256;

/** 每个顶点占几个数：位置 3、雪面法线 3、横向位置和着地带半宽 2、痕迹成分 4、沟壁朝向与走向 4。 */
const STRIDE = 16;
const LAYOUT = { position: [3, 0], aNormal: [3, 3], aBand: [2, 6], aMark: [4, 8], aTrack: [4, 12] };
const QUAD_VERTICES = 4;

/**
 * 雪面上的板痕：一条贴地的带子，每一截记下当时板子是怎么压在雪上的，着色器再据此画出横截面。
 * 平着滑是一条压平的浅印，立刃是板刃刻出的一道细沟外加甩到弯外侧的碎雪，
 * 横过来搓雪是一整片带擦痕的宽面，粉雪里则陷成一道槽。写满后从最旧的一截开始覆盖。
 */
export class SnowTrail {
  constructor() {
    this.data = new Float32Array(MAX_SEGMENTS * QUAD_VERTICES * STRIDE);
    this.buffer = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(this.buildGeometry(), createTrailMaterial());
    this.mesh.name = 'SnowTrail';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.cursor = 0;
    // last：上一个定下来的横截面；live：当前这一格里是不是已经写了一截还在跟着板子长的痕迹
    this.last = null;
    this.live = false;
  }

  buildGeometry() {
    const geo = new THREE.BufferGeometry();
    for (const [name, [size, offset]] of Object.entries(LAYOUT)) {
      geo.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, size, offset));
    }
    const index = new Uint32Array(MAX_SEGMENTS * 6);
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const v = i * QUAD_VERTICES;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    return geo;
  }

  clear() {
    this.data.fill(0);
    this.buffer.clearUpdateRanges();
    this.buffer.needsUpdate = true;
    this.cursor = 0;
    this.last = null;
    this.live = false;
  }

  /**
   * 每个物理步调用一次。roll 是板面此刻的滚转角（朝前刃为正），痕迹从看得见的那条板刃底下出来。
   * 最新的一截始终连到板子脚下，走够一步的距离才定下来、另起一截。
   */
  stamp(motor, roll = 0) {
    if (!motor.onGround || motor.mode !== 'ride') return this.lift();
    const now = this.section(motor, roll);
    const prev = this.last;
    const moved = prev ? Math.hypot(now.x - prev.x, now.z - prev.z) : 0;
    if (!prev || moved > MAX_GAP) {
      this.lift();
      // 一段痕迹的开头从无到有渐显，不是齐刷刷的一刀
      this.last = { ...now, fade: 0 };
      return;
    }
    now.along = prev.along + moved;
    this.write(prev, now);
    this.live = true;
    if (moved >= STEP) this.settle(now);
  }

  /** 板子离开雪面：正在长的那一截就留在原地，下次落地另起一段。 */
  lift() {
    if (this.live) this.advance();
    this.last = null;
  }

  /** 当前这一截定下来，下一截从它的末端接着画。 */
  settle(section) {
    this.advance();
    this.last = section.along > ALONG_WRAP ? { ...section, along: section.along - ALONG_WRAP } : section;
  }

  advance() {
    this.cursor = (this.cursor + 1) % MAX_SEGMENTS;
    this.live = false;
  }

  /**
   * 板子此刻压在雪上的那一条，投到垂直于行进方向的横截面上。
   * 返回横截面的朝向 (px, pz)（指向行进方向的右手边）、着地带中线的偏移和半宽、
   * 刃切出的直壁在哪一侧（1 右、-1 左），以及“刻”和“搓”各占几成。
   */
  footprint(motor, roll, normal) {
    // 板子和速度都贴在坡面上，夹角要在坡面里量；只看水平投影的话，斜着横切陡坡时会平白多出一个夹角
    const { forward, right } = motor.axes(motor.heading, normal);
    const travel = new THREE.Vector3(motor.vx, motor.vy, motor.vz);
    if (travel.length() > MIN_TRAVEL_SPEED) travel.normalize();
    else travel.copy(forward);
    const side = new THREE.Vector3().crossVectors(travel, normal).normalize();
    // 板子横过来几成、顺着走几成
    const across = Math.abs(right.dot(travel));
    const along = forward.dot(travel);
    const lean = Math.abs(roll);
    const snow = motor.surface === 'powder' ? POWDER : PACKED;
    // 板子绕着压下去的那条刃滚转，着地的部分从整个板底收窄到刃边的一条
    const contact = lerp(BOARD.width, snow.edgeCut, smoothstep(lean, 0, EDGE_ONLY_ROLL));
    const scrape = smoothstep(across, ...SCRAPE_SLIP);
    return {
      px: side.x,
      pz: side.z,
      centre: Math.sign(roll) * ((BOARD.width / 2) * Math.cos(roll) - contact / 2) * along,
      half: (BOARD.length * across + contact * Math.abs(along)) / 2,
      wall: Math.sign(roll * along),
      carve: smoothstep(lean, ...CARVE_ROLL) * (1 - scrape) * snow.carve,
      scrape,
    };
  }

  /** 这一刻的横截面：带子左右两个贴地的顶点，加上着色器要用的各项成分。 */
  section(motor, roll) {
    const terrain = motor.terrain;
    const normal = terrain.sample(motor.x, motor.z).normal;
    const print = this.footprint(motor, roll, normal);
    // across：顶点离着地带中线多远（米），右为正
    const vertex = (across) => {
      const x = motor.x + print.px * (print.centre + across);
      const z = motor.z + print.pz * (print.centre + across);
      return { x, y: terrain.heightAt(x, z) + LIFT, z, across };
    };
    const outer = lerp(MARGIN.rim, MARGIN.spray, print.carve);
    return {
      ...print,
      x: motor.x,
      z: motor.z,
      normal,
      // 直壁那一侧雪面是完好的，碎雪都甩在另一侧
      left: vertex(-print.half - (print.wall > 0 ? outer : MARGIN.rim)),
      right: vertex(print.half + (print.wall < 0 ? outer : MARGIN.rim)),
      sink: motor.surface === 'powder' ? 1 : 0,
      fade: motor.surface === 'crust' ? CRUST_FADE : 1,
      along: 0,
    };
  }

  /** 把从 from 到 to 的一截写进当前这一格，只上传改动的这一小段。 */
  write(from, to) {
    const start = this.cursor * QUAD_VERTICES * STRIDE;
    [from, to].forEach((section, i) => {
      [section.left, section.right].forEach((vertex, j) => {
        this.data.set(vertexData(section, vertex), start + (i * 2 + j) * STRIDE);
      });
    });
    this.buffer.addUpdateRange(start, QUAD_VERTICES * STRIDE);
    this.buffer.needsUpdate = true;
  }
}

/** 一个顶点的全部数据，顺序和 LAYOUT 一致。 */
function vertexData(section, vertex) {
  const { normal } = section;
  return [
    vertex.x, vertex.y, vertex.z,
    normal.x, normal.y, normal.z,
    vertex.across, section.half,
    section.carve, section.scrape, section.sink, section.fade,
    section.wall, section.along, section.px, section.pz,
  ];
}
