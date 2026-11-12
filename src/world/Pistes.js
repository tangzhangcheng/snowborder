import * as THREE from 'three';

/** 国内雪场惯例：初级绿、中级蓝、高级黑；野雪道用橙色。 */
export const DIFFICULTY = {
  easy: { label: '初级', color: '#35a063', shape: 'circle' },
  intermediate: { label: '中级', color: '#2f7fd6', shape: 'square' },
  advanced: { label: '高级', color: '#23272e', shape: 'diamond' },
  expert: { label: '野雪', color: '#d9622b', shape: 'double' },
};

const HASH_CELL = 48;
const MASK_SIZE = 2048;
/** 着色贴图里，覆盖度从雪道边线往里、往外各渐变这么多米。 */
const EDGE_RAMP = 3;
/** 画贴图前把中线加密到大约这么长一段（米），弯道上的边线和压纹才是顺的，不会一折一折。 */
const SMOOTH_STEP = 3;

/**
 * 雪道查询与着色贴图。
 * - locate(x, z)：脚下是哪条雪道
 * - buildTextures()：雪道覆盖与压纹相位
 */
export class Pistes {
  constructor(world) {
    this.list = world.pistes;
    this.worldSize = world.heightmap.worldSize;
    this.buckets = new Map();
    this.list.forEach((piste, index) => {
      piste.index = index;
      piste.points.forEach(([x, z], k) => {
        const key = this.key(x, z);
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push(index, k);
      });
    });
  }

  key(x, z) {
    return Math.floor(x / HASH_CELL) * 4096 + Math.floor(z / HASH_CELL);
  }

  /** 返回 { piste, dist, k } 或 null。margin 是雪道半宽之外的容差。 */
  locate(x, z, margin = 0) {
    let best = null;
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.buckets.get((cx + dx) * 4096 + cz + dz);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 2) {
          const piste = this.list[bucket[i]];
          const p = piste.points[bucket[i + 1]];
          const dist = Math.hypot(p[0] - x, p[1] - z);
          if (dist > piste.width / 2 + margin) continue;
          if (!best || dist < best.dist) best = { piste, dist, k: bucket[i + 1] };
        }
      }
    }
    return best;
  }

  /**
   * 着色用的两张贴图：
   * - mask（RGBA8）：R 压雪覆盖、B 野雪道覆盖。0.5 正好在雪道边线上，
   *   往里往外各 edgeRamp 米线性渐变，着色器可以反算出到边线的距离
   * - lateral（RG32F）：R 到雪道中线的带符号距离（米），压纹的相位靠它；
   *   G 这个距离在地面上朝哪个方向增大（弧度，从 +x 转向 +z）。
   *   压纹只有十几厘米一道，精度要到毫米，所以单独用浮点存
   */
  buildTextures() {
    const size = MASK_SIZE;
    const data = new Uint8Array(size * size * 4);
    const offsets = new Float32Array(size * size * 2);
    const canvas = { size, texel: this.worldSize / size, data, offsets, nearest: new Float32Array(size * size).fill(Infinity) };

    for (const piste of this.list) {
      const line = smoothLine(piste.points, SMOOTH_STEP);
      const last = line.length - 1;
      for (let k = 1; k <= last; k++) paintSegment(canvas, piste, line[k - 1], line[k], { start: k === 1, end: k === last });
    }
    for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255;

    return { ...this.wrapTextures(data, offsets, size), edgeRamp: EDGE_RAMP };
  }

  wrapTextures(data, offsets, size) {
    const mask = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    mask.minFilter = THREE.LinearMipmapLinearFilter;
    mask.generateMipmaps = true;
    mask.magFilter = THREE.LinearFilter;
    // 显卡自带的双线性插值只有 8 位小数精度，画不了厘米级的细纹；
    // 这张图不开过滤，由着色器取四个格子自己插值
    const lateral = new THREE.DataTexture(offsets, size, size, THREE.RGFormat, THREE.FloatType);
    lateral.minFilter = lateral.magFilter = THREE.NearestFilter;
    for (const tex of [mask, lateral]) {
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
    }
    return { mask, lateral };
  }

  /** 压雪道两侧的标志杆，杆头颜色是难度。 */
  buildPoles(terrain) {
    const spots = [];
    for (const piste of this.list) {
      if (!piste.groomed) continue;
      const pts = piste.points;
      for (let k = 2; k < pts.length - 1; k += 4) {
        const prev = pts[k - 1];
        const next = pts[k + 1];
        const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
        const nx = -(next[1] - prev[1]) / len;
        const nz = (next[0] - prev[0]) / len;
        for (const side of [-1, 1]) {
          const x = pts[k][0] + nx * side * (piste.width / 2 + 1.5);
          const z = pts[k][1] + nz * side * (piste.width / 2 + 1.5);
          // 交汇处会落进别的雪道里，跳过
          if (this.locate(x, z, -2)) continue;
          spots.push({ x, y: terrain.heightAt(x, z), z, color: DIFFICULTY[piste.difficulty].color });
        }
      }
    }
    const geo = new THREE.CylinderGeometry(0.07, 0.07, 1.7, 5);
    geo.translate(0, 0.85, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), spots.length);
    mesh.name = 'PistePoles';
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(s.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

/**
 * 把折线加密成一条顺滑的曲线（Catmull-Rom，经过原来的每个点），每段大约 step 米。
 * @param {number[][]} points [x, z] 列表
 */
function smoothLine(points, step) {
  if (points.length < 3) return points;
  const at = (i) => points[Math.min(points.length - 1, Math.max(0, i))];
  const line = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const pieces = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let n = 1; n <= pieces; n++) line.push([0, 1].map((axis) => catmullRom(p0[axis], p1[axis], p2[axis], p3[axis], n / pieces)));
  }
  return line;
}

function catmullRom(p0, p1, p2, p3, t) {
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
}

/**
 * 把中线上的一小段 a→b 画进贴图：这一段够得着的每个格子，
 * 如果它比之前画过的中线都近，就记下覆盖度和带符号的距离。
 * open：这一段是不是雪道的头或尾。头尾之外压纹要照直延伸出去，
 * 不能绕着端点画成一圈一圈的同心圆。
 */
function paintSegment(canvas, piste, a, b, open) {
  const { size, texel } = canvas;
  const reach = piste.width / 2 + EDGE_RAMP * 2;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const segment = { ax: a[0], az: a[1], dx, dz, length: Math.hypot(dx, dz) || 1e-3, reach, open };
  const range = (from, to) => [Math.max(0, Math.floor((Math.min(from, to) - reach) / texel)), Math.min(size - 1, Math.floor((Math.max(from, to) + reach) / texel))];
  const [x0, x1] = range(a[0], b[0]);
  const [z0, z1] = range(a[1], b[1]);
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) paintCell(canvas, piste, segment, ix, iz);
  }
}

/** 贴图上的一格：离这一段比离之前画过的都近，才改写。 */
function paintCell({ size, texel, data, offsets, nearest }, piste, segment, ix, iz) {
  const { dx, dz, length, open } = segment;
  const px = (ix + 0.5) * texel - segment.ax;
  const pz = (iz + 0.5) * texel - segment.az;
  // 格子中心到这一段的最近点
  const raw = (px * dx + pz * dz) / (length * length);
  const along = THREE.MathUtils.clamp(raw, 0, 1);
  const fromX = px - dx * along;
  const fromZ = pz - dz * along;
  const dist = Math.hypot(fromX, fromZ);
  const cell = iz * size + ix;
  if (dist > segment.reach || dist >= nearest[cell]) return;
  nearest[cell] = dist;

  const cover = Math.round(THREE.MathUtils.clamp((piste.width / 2 + EDGE_RAMP - dist) / (EDGE_RAMP * 2), 0, 1) * 255);
  data[cell * 4] = piste.groomed ? cover : 0;
  data[cell * 4 + 2] = piste.groomed ? 0 : cover;

  // 垂直于这一段的带符号距离，朝这一段的法线方向增大；
  // 拐角外侧改用到拐点的距离（朝背离拐点的方向增大），压纹顺着弯绕过去
  const across = (pz * dx - px * dz) / length;
  const side = across < 0 ? -1 : 1;
  const beyond = dist > 1e-3 && ((raw < 0 && !open.start) || (raw > 1 && !open.end));
  offsets[cell * 2] = beyond ? side * dist : across;
  offsets[cell * 2 + 1] = beyond ? Math.atan2(side * fromZ, side * fromX) : Math.atan2(dx, -dz);
}

/** 名牌与地图上的显示名，如 “N9 云霄峰道”。 */
export function pisteTitle(piste) {
  return piste.ref ? `${piste.ref} ${piste.name}` : piste.name;
}
