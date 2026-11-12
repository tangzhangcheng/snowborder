/**
 * 生成 public/data 下的 detail.u16 / backdrop.u16 / world.json。
 *
 * 数据来源（均为公开数据，独立获取）：
 * - 高程：AWS Terrain Tiles（Terrarium 编码）
 * - 雪道与索道：OpenStreetMap（scripts/fetch-osm.mjs 写入 scripts/cache/osm.json，ODbL）
 *
 * --if-missing：三个输出文件都已存在则跳过。
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/data');
const cacheDir = resolve(here, 'cache');
const tileDir = resolve(cacheDir, 'tiles');
const osmFile = resolve(cacheDir, 'osm.json');
const args = new Set(process.argv.slice(2));
const OUTPUTS = ['detail.u16', 'backdrop.u16', 'world.json'];

if (args.has('--if-missing') && OUTPUTS.every((f) => existsSync(resolve(outDir, f)))) {
  console.log('gen-terrain: 数据已存在，跳过');
  process.exit(0);
}

/** 雪场中心（吉克普林）与世界尺寸。x 向东，z 向南，单位米。 */
const CENTER = { lat: 48.607, lon: 87.5555 };
const WORLD = 7200;
const N = 513;
const DETAIL_ZOOM = 13;
const BACK_WORLD = 28800;
const BACK_N = 257;
const BACK_ZOOM = 11;
const SCALE = 10; // uint16 = 米 * 10
const M_LAT = 111194;
const M_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);
const STITCH_WIDTH = 220; // 细节地形边缘向远景高度过渡的宽度（米）
const PISTE_STEP = 12;
const SPAWN_OFFSET = 18; // 出生点离上站站房的距离，与 LiftSystem 的 EXIT_OFFSET 一致

const DIFFICULTY = {
  easy: { label: '初级', width: 40, groomed: true },
  intermediate: { label: '中级', width: 34, groomed: true },
  advanced: { label: '高级', width: 28, groomed: true },
  expert: { label: '野雪', width: 22, groomed: false },
};
const LIFT_KIND = {
  gondola: { label: '厢式索道', speed: 16 },
  chair_lift: { label: '吊椅', speed: 11 },
  magic_carpet: { label: '魔毯', speed: 5 },
};

const round = (n) => Math.round(n * 10) / 10;
const toWorld = (lat, lon) => ({
  x: (lon - CENTER.lon) * M_LON + WORLD / 2,
  z: (CENTER.lat - lat) * M_LAT + WORLD / 2,
});
const toGeo = (x, z) => ({
  lat: CENTER.lat - (z - WORLD / 2) / M_LAT,
  lon: CENTER.lon + (x - WORLD / 2) / M_LON,
});

/** Terrarium 瓦片拼接采样器。 */
class Dem {
  constructor(zoom) {
    this.zoom = zoom;
    this.size = 256 * 2 ** zoom;
    this.tiles = new Map();
  }

  pixel(lat, lon) {
    const rad = (lat * Math.PI) / 180;
    return {
      px: ((lon + 180) / 360) * this.size,
      py: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * this.size,
    };
  }

  async cover(corners) {
    const pix = corners.map((c) => this.pixel(c.lat, c.lon));
    const x0 = Math.floor(Math.min(...pix.map((p) => p.px)) / 256) - 1;
    const x1 = Math.floor(Math.max(...pix.map((p) => p.px)) / 256) + 1;
    const y0 = Math.floor(Math.min(...pix.map((p) => p.py)) / 256) - 1;
    const y1 = Math.floor(Math.max(...pix.map((p) => p.py)) / 256) + 1;
    const jobs = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
    console.log(`gen-terrain: z${this.zoom} 需要 ${jobs.length} 张瓦片`);
    const queue = jobs.slice();
    const worker = async () => {
      while (queue.length) {
        const [tx, ty] = queue.pop();
        this.tiles.set(`${tx}/${ty}`, await this.load(tx, ty));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  async load(tx, ty) {
    const file = resolve(tileDir, `${this.zoom}-${tx}-${ty}.png`);
    let buf;
    if (existsSync(file)) {
      buf = readFileSync(file);
    } else {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${this.zoom}/${tx}/${ty}.png`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`瓦片 ${this.zoom}/${tx}/${ty} HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
    }
    return PNG.sync.read(buf).data;
  }

  texel(gx, gy) {
    const tx = Math.floor(gx / 256);
    const ty = Math.floor(gy / 256);
    const data = this.tiles.get(`${tx}/${ty}`);
    if (!data) throw new Error(`缺少瓦片 ${this.zoom}/${tx}/${ty}`);
    const i = ((gy - ty * 256) * 256 + (gx - tx * 256)) * 4;
    return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
  }

  sample(lat, lon) {
    const { px, py } = this.pixel(lat, lon);
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = this.texel(x0, y0) * (1 - tx) + this.texel(x0 + 1, y0) * tx;
    const bottom = this.texel(x0, y0 + 1) * (1 - tx) + this.texel(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }
}

/** 在世界坐标的正方形范围内采样一张 n×n 高程网格。 */
async function sampleGrid(zoom, n, origin, span) {
  const dem = new Dem(zoom);
  const far = origin + span;
  await dem.cover([toGeo(origin, origin), toGeo(far, origin), toGeo(origin, far), toGeo(far, far)]);
  const grid = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const geo = toGeo(origin + (ix / (n - 1)) * span, origin + (iz / (n - 1)) * span);
      grid[iz * n + ix] = dem.sample(geo.lat, geo.lon);
    }
  }
  return grid;
}

/** 可分离 [1,2,1]/4 模糊，返回新数组。 */
function blur(src, n, passes) {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const l = a[z * n + Math.max(0, x - 1)];
        const r = a[z * n + Math.min(n - 1, x + 1)];
        b[z * n + x] = (l + 2 * a[z * n + x] + r) / 4;
      }
    }
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const u = b[Math.max(0, z - 1) * n + x];
        const d = b[Math.min(n - 1, z + 1) * n + x];
        a[z * n + x] = (u + 2 * b[z * n + x] + d) / 4;
      }
    }
  }
  return a;
}

/**
 * 让细节地形在边缘一圈逐渐过渡到远景的高度，接缝处两层网格完全重合，
 * 不会露出裂缝或台阶。
 */
function stitchEdges(detail, backdrop, backOrigin) {
  const cell = BACK_WORLD / (BACK_N - 1);
  const backAt = (x, z) => {
    const fx = Math.min(BACK_N - 1.001, (x - backOrigin) / cell);
    const fz = Math.min(BACK_N - 1.001, (z - backOrigin) / cell);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const row = z0 * BACK_N + x0;
    const top = backdrop[row] * (1 - tx) + backdrop[row + 1] * tx;
    const bottom = backdrop[row + BACK_N] * (1 - tx) + backdrop[row + BACK_N + 1] * tx;
    return top * (1 - tz) + bottom * tz;
  };
  const step = WORLD / (N - 1);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const edge = Math.min(ix, iz, N - 1 - ix, N - 1 - iz) * step;
      if (edge >= STITCH_WIDTH) continue;
      const t = edge / STITCH_WIDTH;
      const keep = t * t * (3 - 2 * t);
      const i = iz * N + ix;
      detail[i] = backAt(ix * step, iz * step) * (1 - keep) + detail[i] * keep;
    }
  }
}

function makeHeightAt(grid) {
  return (x, z) => {
    const fx = Math.max(0, Math.min(N - 1.001, (x / WORLD) * (N - 1)));
    const fz = Math.max(0, Math.min(N - 1.001, (z / WORLD) * (N - 1)));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = grid[z0 * N + x0];
    const h10 = grid[z0 * N + x0 + 1];
    const h01 = grid[(z0 + 1) * N + x0];
    const h11 = grid[(z0 + 1) * N + x0 + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };
}

/** Catmull-Rom 加密折线，间距约 step 米。 */
function smoothLine(points, step) {
  if (points.length < 2) return points.slice();
  const out = [];
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const count = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step));
    for (let k = 0; k < count; k++) {
      const t = k / count;
      const t2 = t * t;
      const t3 = t2 * t;
      const blend = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: blend(p0.x, p1.x, p2.x, p3.x), z: blend(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

function lineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return total;
}

function buildPistes(osm, heightAt) {
  const pistes = [];
  for (const way of osm.elements) {
    if (way.type !== 'way' || way.tags?.['piste:type'] !== 'downhill' || !way.geometry) continue;
    const difficulty = DIFFICULTY[way.tags['piste:difficulty']] ? way.tags['piste:difficulty'] : 'intermediate';
    const spec = DIFFICULTY[difficulty];
    let raw = way.geometry.map((g) => toWorld(g.lat, g.lon));
    if (heightAt(raw[0].x, raw[0].z) < heightAt(raw[raw.length - 1].x, raw[raw.length - 1].z)) raw = raw.reverse();
    const points = smoothLine(raw, PISTE_STEP);
    const top = heightAt(points[0].x, points[0].z);
    const bottom = heightAt(points[points.length - 1].x, points[points.length - 1].z);
    pistes.push({
      id: 'p' + way.id,
      ref: way.tags['piste:ref'] ?? '',
      name: way.tags.name ?? `${spec.label}雪道`,
      difficulty,
      groomed: spec.groomed,
      width: spec.width,
      length: Math.round(lineLength(points)),
      top: Math.round(top),
      bottom: Math.round(bottom),
      points: points.map((p) => [round(p.x), round(p.z)]),
    });
  }
  pistes.sort((a, b) => b.length - a.length);
  return pistes;
}

/** 把雪道走廊内的高程往平滑版本靠，压掉 30 米 DEM 的毛刺。 */
function groomTerrain(grid, pistes) {
  const cell = WORLD / (N - 1);
  const mask = new Float32Array(N * N);
  for (const piste of pistes) {
    const half = piste.width / 2;
    const reach = half + 24;
    const span = Math.ceil(reach / cell);
    for (const [px, pz] of piste.points) {
      const cx = Math.round(px / cell);
      const cz = Math.round(pz / cell);
      for (let dz = -span; dz <= span; dz++) {
        for (let dx = -span; dx <= span; dx++) {
          const ix = cx + dx;
          const iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
          const dist = Math.hypot(ix * cell - px, iz * cell - pz);
          const t = Math.max(0, Math.min(1, (reach - dist) / 24));
          const weight = t * t * (3 - 2 * t);
          if (weight > mask[iz * N + ix]) mask[iz * N + ix] = weight;
        }
      }
    }
  }
  const smooth = blur(grid, N, 3);
  for (let i = 0; i < grid.length; i++) grid[i] += (smooth[i] - grid[i]) * mask[i];
}

function station(p, heightAt) {
  return { x: round(p.x), z: round(p.z), h: round(heightAt(p.x, p.z)) };
}

/** 下站点附近最近的雪道起点方向；找不到就沿最陡下坡。 */
function exitYawFor(top, pistes, heightAt) {
  let best = null;
  for (const piste of pistes) {
    const [sx, sz] = piste.points[0];
    const dist = Math.hypot(sx - top.x, sz - top.z);
    if (dist < 320 && (!best || dist < best.dist)) best = { piste, dist };
  }
  if (best) {
    const [ax, az] = best.piste.points[Math.min(6, best.piste.points.length - 1)];
    if (Math.hypot(ax - top.x, az - top.z) > 8) return Math.atan2(ax - top.x, az - top.z);
  }
  const e = 20;
  const gx = heightAt(top.x + e, top.z) - heightAt(top.x - e, top.z);
  const gz = heightAt(top.x, top.z + e) - heightAt(top.x, top.z - e);
  return Math.atan2(-gx, -gz);
}

function buildLifts(osm, pistes, heightAt) {
  const lifts = [];
  let carpet = 0;
  for (const way of osm.elements) {
    if (way.type !== 'way' || !LIFT_KIND[way.tags?.aerialway] || !way.geometry) continue;
    const kind = way.tags.aerialway;
    const a = toWorld(way.geometry[0].lat, way.geometry[0].lon);
    const b = toWorld(way.geometry[way.geometry.length - 1].lat, way.geometry[way.geometry.length - 1].lon);
    const [low, high] = heightAt(a.x, a.z) <= heightAt(b.x, b.z) ? [a, b] : [b, a];
    const top = station(high, heightAt);
    lifts.push({
      id: 'l' + way.id,
      name: way.tags.name ?? `魔毯${++carpet}`,
      kind,
      kindLabel: LIFT_KIND[kind].label,
      bottom: station(low, heightAt),
      top,
      speed: LIFT_KIND[kind].speed,
      length: round(Math.hypot(high.x - low.x, high.z - low.z)),
      exitYaw: Math.round(exitYawFor(top, pistes, heightAt) * 1000) / 1000,
    });
  }
  lifts.sort((p, q) => p.name.localeCompare(q.name, 'zh-Hans-CN', { numeric: true }));
  return lifts;
}

/** 山脚：低处的索道下站按 600 米聚类，自西向东命名。 */
function buildBases(lifts) {
  const main = lifts.filter((l) => l.kind !== 'magic_carpet');
  const lowest = Math.min(...main.map((l) => l.bottom.h));
  const clusters = [];
  for (const lift of main) {
    if (lift.bottom.h > lowest + 140) continue;
    const near = clusters.find((c) => Math.hypot(c.x - lift.bottom.x, c.z - lift.bottom.z) < 600);
    if (near) {
      near.members.push(lift);
      near.x = near.members.reduce((s, m) => s + m.bottom.x, 0) / near.members.length;
      near.z = near.members.reduce((s, m) => s + m.bottom.z, 0) / near.members.length;
    } else {
      clusters.push({ x: lift.bottom.x, z: lift.bottom.z, members: [lift] });
    }
  }
  clusters.sort((a, b) => a.x - b.x);
  const names = { 1: ['山脚大厅'], 2: ['西区山脚', '东区山脚'], 3: ['西区山脚', '中区山脚', '东区山脚'] }[clusters.length];
  return clusters.map((c, i) => ({ x: c.x, z: c.z, name: names ? names[i] : `山脚 ${i + 1}` }));
}

function quantize(grid) {
  const raw = Buffer.alloc(grid.length * 2);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const h = grid[i];
    if (h < min) min = h;
    if (h > max) max = h;
    raw.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(h * SCALE))), i * 2);
  }
  return { raw, min, max };
}

if (!existsSync(osmFile)) {
  console.error('gen-terrain: 缺少 scripts/cache/osm.json，先运行 npm run terrain:osm');
  process.exit(1);
}
mkdirSync(tileDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
const osm = JSON.parse(readFileSync(osmFile, 'utf8'));

const detail = blur(await sampleGrid(DETAIL_ZOOM, N, 0, WORLD), N, 1);
const backOrigin = -(BACK_WORLD - WORLD) / 2;
const backdrop = await sampleGrid(BACK_ZOOM, BACK_N, backOrigin, BACK_WORLD);
stitchEdges(detail, backdrop, backOrigin);

const pistes = buildPistes(osm, makeHeightAt(detail));
groomTerrain(detail, pistes);
const heightAt = makeHeightAt(detail);
for (const piste of pistes) {
  const first = piste.points[0];
  const last = piste.points[piste.points.length - 1];
  piste.top = Math.round(heightAt(first[0], first[1]));
  piste.bottom = Math.round(heightAt(last[0], last[1]));
}
const lifts = buildLifts(osm, pistes, heightAt);
const bases = buildBases(lifts);

const summitLift = lifts.reduce((best, l) => (l.top.h > best.top.h ? l : best), lifts[0]);
const pois = [
  { id: 'summit', name: '山顶', kind: 'peak', ...summitLift.top },
  ...bases.map((b, i) => ({ id: 'base-' + i, name: b.name, kind: 'base', ...station(b, heightAt) })),
  ...lifts.flatMap((l) => [
    { id: l.id + '-bottom', name: `${l.name}下站`, kind: 'station', lift: l.id, ...l.bottom },
    { id: l.id + '-top', name: `${l.name}上站`, kind: 'station', lift: l.id, ...l.top },
  ]),
];
const home = bases[0];
const vehicles = [
  { id: 'truck', type: 'truck', name: '红色皮卡', ...station({ x: home.x + 34, z: home.z + 26 }, heightAt) },
  { id: 'sled', type: 'snowmobile', name: '雪地摩托', ...station({ x: home.x - 30, z: home.z + 30 }, heightAt) },
];

const detailQ = quantize(detail);
const backQ = quantize(backdrop);
const world = {
  name: '山谷雪场',
  subtitle: '阿勒泰 · 吉克普林一带',
  attribution: '高程：AWS Terrain Tiles · 雪道与索道：© OpenStreetMap 贡献者（ODbL）',
  geo: { ...CENTER, metersPerDegLat: M_LAT, metersPerDegLon: round(M_LON) },
  heightmap: {
    file: 'detail.u16',
    width: N,
    height: N,
    scale: SCALE,
    worldSize: WORLD,
    min: round(detailQ.min),
    max: round(detailQ.max),
  },
  backdrop: {
    file: 'backdrop.u16',
    width: BACK_N,
    height: BACK_N,
    scale: SCALE,
    worldSize: BACK_WORLD,
    origin: backOrigin,
    min: round(backQ.min),
    max: round(backQ.max),
  },
  spawn: {
    ...station(
      {
        x: summitLift.top.x + Math.sin(summitLift.exitYaw) * SPAWN_OFFSET,
        z: summitLift.top.z + Math.cos(summitLift.exitYaw) * SPAWN_OFFSET,
      },
      heightAt,
    ),
    yaw: summitLift.exitYaw,
  },
  bounds: { inset: 60 },
  pois,
  lifts,
  vehicles,
  pistes,
};

writeFileSync(resolve(outDir, 'detail.u16'), detailQ.raw);
writeFileSync(resolve(outDir, 'backdrop.u16'), backQ.raw);
writeFileSync(resolve(outDir, 'world.json'), JSON.stringify(world));

const km = (pistes.reduce((s, p) => s + p.length, 0) / 1000).toFixed(1);
console.log(`gen-terrain: 高程 ${detailQ.min.toFixed(0)}–${detailQ.max.toFixed(0)} m，远景 ${backQ.min.toFixed(0)}–${backQ.max.toFixed(0)} m`);
console.log(`gen-terrain: 雪道 ${pistes.length} 条共 ${km} km，索道 ${lifts.length} 条，山脚 ${bases.map((b) => b.name).join('、')}`);
console.log(`gen-terrain: 出生点 ${summitLift.name}上站 ${summitLift.top.h} m`);
for (const l of lifts) console.log(`  ${l.name} ${l.kindLabel} ${l.bottom.h}→${l.top.h} m 长 ${l.length} m`);
