import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';
import { DIFFICULTY } from './Pistes.js';
import { BOARD, createSign } from './signs.js';
import { instanceByChunk, isFree, mergeParts, paintFlat } from './scatter.js';

/** 雪道边上的东西互相至少隔这么多米，不挤在一堆。 */
const ELBOW_ROOM = 7;
/**
 * 雪道入口的指示牌：够长的雪道才立；starts 是依次试着立在离起点多远的地方（米），
 * 起点常在别的雪道里，立不下就往下挪；gap 是离雪道边线多远；turnIn 是牌面朝雪道中间偏多少。
 */
const SIGN = { minLength: 250, starts: [14, 40, 70], gap: 2.5, turnIn: 0.35, height: 2.6 };
/** 造雪机：只摆在够长的初级、中级压雪道边上，每隔 spacing 米一台，左右交替。 */
const GUN = { minLength: 400, levels: ['easy', 'intermediate'], start: 60, spacing: 130, gap: 4.5, radius: 0.8, height: 3, tilt: 0.35 };
/**
 * 夜场灯：海拔 line 米以下的压雪道才有。height 是灯杆高，arm 是伸向雪道的横臂长，
 * pool 是地上那圈光的半径，reach 是光圈中心在雪道边线以内多远。
 */
const LAMP = { line: 1700, start: 25, spacing: 70, gap: 3, height: 8, arm: 2.2, radius: 0.3, pool: 15, reach: 6 };
/** 灯光的颜色：灯罩没亮、亮了，以及打在雪上的光。 */
const LIGHT = { off: '#9aa3ab', on: '#fff0c2', pool: '#ffbe52', strength: 0.62, halo: 6 };
/** 地上的光圈：一圈分几瓣、从里到外分几圈、亮度按距离的几次方衰减，以及浮在雪面上多高。 */
const POOL_SHAPE = { segments: 16, rings: 5, falloff: 1.7, lift: 0.12 };

/**
 * 沿雪道中线每隔 spacing 米取一个点，从离起点 start 米处开始。
 * 给出 { x, z, dx, dz }，(dx, dz) 是下滑方向的单位向量。
 */
function* alongPiste(piste, spacing, start) {
  let next = start;
  let walked = 0;
  const pts = piste.points;
  for (let k = 1; k < pts.length; k++) {
    const [ax, az] = pts[k - 1];
    const [bx, bz] = pts[k];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    for (; next <= walked + len; next += spacing) {
      const t = (next - walked) / len;
      yield { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len };
    }
    walked += len;
  }
}

/**
 * 雪道边线外 gap 米处的一个位置（gap 为负就是边线以内）。side：下滑方向的左手边 1，右手边 -1。
 * 返回的 (inX, inZ) 是从这里指向雪道中间的单位向量。
 */
function beside(piste, at, side, gap) {
  const off = side * (piste.width / 2 + gap);
  return { x: at.x + at.dz * off, z: at.z - at.dx * off, inX: -at.dz * side, inZ: at.dx * side, dx: at.dx, dz: at.dz };
}

/** 记着雪道边上已经摆了东西的位置，新来的要是挨得太近、或者落在别的雪道和索道下面，就不摆。 */
class Roadside {
  constructor(ctx) {
    this.ctx = ctx;
    this.taken = [];
  }

  claim(spot) {
    if (!isFree(this.ctx, spot.x, spot.z, 1)) return false;
    if (this.taken.some((other) => Math.hypot(other.x - spot.x, other.z - spot.z) < ELBOW_ROOM)) return false;
    this.taken.push(spot);
    return true;
  }
}

/** 一条雪道入口的指示牌该立在哪：两边、几个距离挨个试，都立不下就不立。 */
function signSpot(piste, roadside) {
  for (const start of SIGN.starts) {
    const at = alongPiste(piste, Infinity, start).next().value;
    if (!at) return null;
    for (const side of [-1, 1]) {
      const spot = beside(piste, at, side, SIGN.gap);
      if (roadside.claim(spot)) return spot;
    }
  }
  return null;
}

/** 每条够长的雪道入口立一块牌子：难度色块、编号和名字，牌面迎着滑下来的人。 */
function buildSigns(ctx, roadside, obstacles) {
  const group = new THREE.Group();
  group.name = 'PisteSigns';
  for (const piste of ctx.pistes.list) {
    if (piste.length < SIGN.minLength) continue;
    const spot = signSpot(piste, roadside);
    if (!spot) continue;
    const level = DIFFICULTY[piste.difficulty];
    const sign = createSign({ title: piste.name, note: [piste.ref, level.label].filter(Boolean).join(' · '), color: level.color, shape: level.shape });
    const yaw = Math.atan2(-spot.dx + spot.inX * SIGN.turnIn, -spot.dz + spot.inZ * SIGN.turnIn);
    sign.position.set(spot.x, ctx.terrain.heightAt(spot.x, spot.z) - 0.1, spot.z);
    sign.rotation.y = yaw;
    group.add(sign);
    obstacles?.addBox(spot.x, spot.z, BOARD.width / 2, 0.2, yaw, SIGN.height);
  }
  return group;
}

/** 一台风扇式造雪机：雪橇底座、立柱，上面架着一个朝斜上方的黄色炮筒。炮口朝 +z。 */
function gunGeometry() {
  const skid = paintFlat(new THREE.BoxGeometry(1.3, 0.2, 1.8).translate(0, 0.1, 0), '#474d55');
  const column = paintFlat(new THREE.CylinderGeometry(0.13, 0.17, 1.9, 6).translate(0, 1.1, 0), '#7b8790');
  const barrel = paintFlat(new THREE.CylinderGeometry(0.56, 0.5, 1.4, 12), '#f0b429');
  const rim = paintFlat(new THREE.CylinderGeometry(0.6, 0.6, 0.14, 12).translate(0, 0.7, 0), '#2f353b');
  const fan = paintFlat(new THREE.CylinderGeometry(0.52, 0.52, 0.1, 12).translate(0, -0.72, 0), '#2f353b');
  // 炮筒本来竖着，放倒到朝前、再抬起一点
  const cannon = mergeParts([barrel, rim, fan]).rotateX(Math.PI / 2 - GUN.tilt).translate(0, 2.35, 0);
  return mergeParts([skid, column, cannon]);
}

/** 沿一条雪道左右交替地取路边的位置，占得下的才留。 */
function roadsideSpots(piste, roadside, { start, spacing, gap }, keep = () => true) {
  const spots = [];
  let side = 1;
  for (const at of alongPiste(piste, spacing, start)) {
    side = -side;
    const spot = beside(piste, at, side, gap);
    if (keep(spot) && roadside.claim(spot)) spots.push(spot);
  }
  return spots;
}

/** 造雪机：守在初级、中级雪道边上，炮口朝着雪道斜下方。 */
function buildSnowGuns(ctx, roadside, obstacles) {
  const spots = [];
  for (const piste of ctx.pistes.list) {
    if (!piste.groomed || piste.length < GUN.minLength || !GUN.levels.includes(piste.difficulty)) continue;
    for (const spot of roadsideSpots(piste, roadside, GUN)) {
      spots.push({ x: spot.x, y: ctx.terrain.heightAt(spot.x, spot.z), z: spot.z, turn: Math.atan2(spot.inX + spot.dx * 0.6, spot.inZ + spot.dz * 0.6) });
      obstacles?.addCircle(spot.x, spot.z, GUN.radius, GUN.height);
    }
  }
  const group = instanceByChunk(spots, gunGeometry(), toonMat('#ffffff', { vertexColors: true }), ctx.terrain.worldSize);
  group.name = 'SnowGuns';
  return group;
}

/** 灯杆、横臂和灯头，横臂伸向 +z。 */
function lampGeometry() {
  const pole = paintFlat(new THREE.CylinderGeometry(0.08, 0.13, LAMP.height, 6).translate(0, LAMP.height / 2, 0), '#59636b');
  const arm = paintFlat(new THREE.BoxGeometry(0.1, 0.1, LAMP.arm).translate(0, LAMP.height - 0.1, LAMP.arm / 2), '#59636b');
  const head = paintFlat(new THREE.BoxGeometry(0.55, 0.18, 0.95).translate(0, LAMP.height - 0.12, LAMP.arm), '#2f353b');
  return mergeParts([pole, arm, head]);
}

/** 灯头底下发光的灯罩。 */
function lensGeometry() {
  return new THREE.BoxGeometry(0.45, 0.06, 0.82).translate(0, LAMP.height - 0.24, LAMP.arm);
}

/** 夜场灯立在哪：低处的压雪道两边交替着立，灯头伸向雪道。 */
function lampSpots(ctx, roadside, obstacles) {
  const spots = [];
  const low = (spot) => ctx.terrain.heightAt(spot.x, spot.z) < LAMP.line;
  for (const piste of ctx.pistes.list) {
    if (!piste.groomed) continue;
    for (const spot of roadsideSpots(piste, roadside, LAMP, low)) {
      const y = ctx.terrain.heightAt(spot.x, spot.z);
      // 光圈打在灯头前面的雪道上
      const reach = LAMP.gap + LAMP.reach;
      spots.push({ x: spot.x, y, z: spot.z, turn: Math.atan2(spot.inX, spot.inZ), inX: spot.inX, inZ: spot.inZ, poolX: spot.x + spot.inX * reach, poolZ: spot.z + spot.inZ * reach });
      obstacles?.addCircle(spot.x, spot.z, LAMP.radius, LAMP.height);
    }
  }
  return spots;
}

/**
 * 所有灯打在雪上的光圈，并成一个网格。每个光圈是贴着地形铺开的一张圆饼：
 * 亮度存在顶点色里，中心最亮、边上到零，叠加到雪面上。
 */
function poolGeometry(terrain, spots) {
  const positions = [];
  const colors = [];
  const indices = [];
  const light = new THREE.Color(LIGHT.pool);
  const push = (x, z, level) => {
    positions.push(x, terrain.heightAt(x, z) + POOL_SHAPE.lift, z);
    colors.push(light.r * level, light.g * level, light.b * level);
  };
  for (const spot of spots) {
    const first = positions.length / 3;
    push(spot.poolX, spot.poolZ, 1);
    poolRings(spot, push);
    indices.push(...poolFaces(first));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

/** 一个光圈从里到外的几圈顶点。亮度按离中心的距离平方衰减，边上淡得看不出边界。 */
function poolRings(spot, push) {
  const { segments, rings, falloff } = POOL_SHAPE;
  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      push(spot.poolX + Math.cos(angle) * LAMP.pool * t, spot.poolZ + Math.sin(angle) * LAMP.pool * t, (1 - t) ** falloff);
    }
  }
}

/** 一个光圈的三角面：最里面是绕着中心的一圈扇形，往外每两圈之间是一圈四边形。first 是中心顶点的编号。 */
function poolFaces(first) {
  const { segments, rings } = POOL_SHAPE;
  const faces = [];
  const at = (ring, i) => first + 1 + (ring - 1) * segments + (i % segments);
  for (let i = 0; i < segments; i++) {
    faces.push(first, at(1, i + 1), at(1, i));
    for (let ring = 1; ring < rings; ring++) {
      faces.push(at(ring, i), at(ring, i + 1), at(ring + 1, i + 1), at(ring, i), at(ring + 1, i + 1), at(ring + 1, i));
    }
  }
  return faces;
}

/** 一团柔和的圆光，远看每盏灯就是这样一个亮点。 */
function haloTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const fade = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fade.addColorStop(0, 'rgba(255, 255, 255, 1)');
  fade.addColorStop(0.25, 'rgba(255, 255, 255, 0.55)');
  fade.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** 每盏灯灯头处的一个光点。 */
function haloPoints(spots) {
  const positions = spots.flatMap((spot) => [spot.x + spot.inX * LAMP.arm, spot.y + LAMP.height - 0.3, spot.z + spot.inZ * LAMP.arm]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ map: haloTexture(), color: LIGHT.on, size: LIGHT.halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  return new THREE.Points(geo, mat);
}

/**
 * 夜场灯：灯杆是实体，灯罩、灯头的光点和雪上的光圈跟着天色亮起来。
 * 返回 { group, setGlow(glow) }，glow 是灯亮了几成（0–1）。
 */
function buildLamps(ctx, roadside, obstacles) {
  const spots = lampSpots(ctx, roadside, obstacles);
  const size = ctx.terrain.worldSize;
  const lens = new THREE.MeshBasicMaterial({ color: LIGHT.off });
  const pools = new THREE.Mesh(
    poolGeometry(ctx.terrain, spots),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  const halos = haloPoints(spots);
  // 光圈和光点铺满整座山，包围球没有意义，不做剔除
  pools.frustumCulled = halos.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'Lamps';
  group.add(instanceByChunk(spots, lampGeometry(), toonMat('#ffffff', { vertexColors: true }), size), instanceByChunk(spots, lensGeometry(), lens, size), pools, halos);
  group.userData.count = spots.length;

  const off = new THREE.Color(LIGHT.off);
  const on = new THREE.Color(LIGHT.on);
  const setGlow = (glow) => {
    lens.color.lerpColors(off, on, glow);
    pools.material.opacity = glow * LIGHT.strength;
    halos.material.opacity = glow;
    pools.visible = halos.visible = glow > 0.01;
  };
  setGlow(0);
  return { group, setGlow };
}

/**
 * 雪道边上的设施：入口指示牌、造雪机、夜场灯。obstacles 可选：传进来就都登记成障碍。
 * 返回 { group, setGlow(glow) }。
 */
export function buildPisteProps(ctx, obstacles = null) {
  const roadside = new Roadside(ctx);
  // 先到先得：入口的牌子位置最要紧，其次是造雪机，灯往空处补
  const signs = buildSigns(ctx, roadside, obstacles);
  const guns = buildSnowGuns(ctx, roadside, obstacles);
  const lamps = buildLamps(ctx, roadside, obstacles);
  const group = new THREE.Group();
  group.name = 'PisteProps';
  group.add(signs, guns, lamps.group);
  return { group, setGlow: lamps.setGlow };
}
