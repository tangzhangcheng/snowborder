import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';
import { FOREST_EDGE, TREELINE, forestDensity } from './dressing.js';
import { hash, instanceByChunk, isFree, jitteredGrid, mergeParts, paint, valueNoise } from './scatter.js';

const SNOW = new THREE.Color('#f1f5f6');
const smooth = THREE.MathUtils.smoothstep;

/**
 * 石头。spacing 是候选点的间距（米）；clearance 是离雪道边线至少多远；
 * squash 把圆球压扁成卧着的石头；sink 是埋进雪里的深度占石头大小的几成；
 * solid 是多大的石头才撞得到（小的半埋在雪里，板子直接压过去）。
 */
const ROCK = { spacing: 34, clearance: 7, squash: 0.7, sink: 0.12, solid: 1.1 };
/** 石头在各处出现的机会：到处都有零星几块，陡坡上、林线以上的乱石滩里成片。 */
const ROCK_CHANCE = { anywhere: 0.015, steep: 0.5, alpine: 0.3, field: 0.12 };
/** 石头的大小（米）：最小的，和最大的比它再大多少；多数是小的，偶尔一块大的。 */
const ROCK_SIZE = { min: 0.8, extra: 3.4 };
/** 坡度（弧度）从前者到后者，陡坡上的石头从没有到最多。 */
const ROCK_SLOPE = [0.42, 0.75];

/** 白桦：只长在这个海拔（米）以下、针叶林的边上。 */
const BIRCH = { spacing: 27, clearance: 8, line: 1900, maxSlope: 0.5, fringe: 0.09, chance: 0.55, trunkRadius: 0.22, height: 6 };
/** 红柳丛：长在低处平缓的林间空地里，一丛一丛的。 */
const SHRUB = { spacing: 17, clearance: 3, line: 2000, maxSlope: 0.42, thicket: 0.6, chance: 0.7, stems: 11 };

/** 一块石头：把二十面体的每个角推进推出一点，朝上的面盖着雪。 */
function rockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    // 按位置取随机数：同一个角上的几个顶点挪到同一处，石头才不会裂开
    const bump = 0.72 + 0.5 * hash(Math.round(p.x * 50) + Math.round(p.y * 50) * 131, Math.round(p.z * 50));
    pos.setXYZ(i, p.x * bump, p.y * bump * ROCK.squash, p.z * bump);
  }
  geo.computeVertexNormals();
  const dark = new THREE.Color('#454b55');
  const light = new THREE.Color('#7b7f85');
  const stone = new THREE.Color();
  return paint(geo, (at, normal) => {
    // 只有朝天的那几个面积得住雪，侧面露着石头，远远地才看得出来
    if (normal.y > 0.74) return SNOW;
    return stone.lerpColors(dark, light, hash(Math.round(normal.x * 9), Math.round(normal.z * 9)));
  });
}

/** 这个点出石头的机会（0–1）。 */
function rockChance(x, z, sample) {
  const steep = smooth(sample.slope, ...ROCK_SLOPE);
  const alpine = smooth(sample.height, TREELINE - 150, TREELINE + 250);
  const field = valueNoise(x * 0.006 + 31, z * 0.006 + 17);
  return ROCK_CHANCE.anywhere + ROCK_CHANCE.steep * steep + ROCK_CHANCE.alpine * alpine * smooth(field, 0.45, 0.7) + ROCK_CHANCE.field * smooth(field, 0.62, 0.8);
}

/** 一块石头的摆放：大小不一、长宽也不一样，稍微埋进雪里。 */
function rockSpot(terrain, x, z, size, roll) {
  const scale = [size * (0.8 + roll(5) * 0.6), size * (0.7 + roll(6) * 0.6), size * (0.8 + roll(7) * 0.6)];
  return { x, y: terrain.heightAt(x, z) + size * ROCK.sink, z, turn: roll(8) * Math.PI * 2, scale, size };
}

/** 一处石头：一块大的，旁边可能再滚落一两块小的。 */
function rockCluster(ctx, x, z, roll) {
  const size = ROCK_SIZE.min + roll(3) ** 2 * ROCK_SIZE.extra;
  const rocks = [rockSpot(ctx.terrain, x, z, size, roll)];
  const mates = Math.floor(roll(4) * 3);
  for (let i = 1; i <= mates; i++) {
    const around = roll(9 + i) * Math.PI * 2;
    const away = size * (1.1 + roll(12 + i) * 1.4);
    const next = (n) => roll(n + i * 11);
    rocks.push(rockSpot(ctx.terrain, x + Math.cos(around) * away, z + Math.sin(around) * away, size * (0.35 + roll(15 + i) * 0.4), next));
  }
  return rocks.filter((rock) => isFree(ctx, rock.x, rock.z, ROCK.clearance));
}

/** 散在山上的石头。obstacles 可选：传进来就把大块的登记成障碍。 */
export function buildRocks(ctx, obstacles = null) {
  const spots = [];
  for (const { x, z, roll } of jitteredGrid(ctx.terrain.worldSize, ROCK.spacing, 101)) {
    if (roll(2) > rockChance(x, z, ctx.terrain.sample(x, z))) continue;
    spots.push(...rockCluster(ctx, x, z, roll));
  }
  for (const rock of spots) {
    if (rock.size >= ROCK.solid) obstacles?.addCircle(rock.x, rock.z, rock.size * 0.8, rock.size * 0.7);
  }
  const group = instanceByChunk(spots, rockGeometry(), toonMat('#ffffff', { vertexColors: true }), ctx.terrain.worldSize);
  group.name = 'Rocks';
  return group;
}

/** 一棵白桦：白树干上带黑斑，枝头还挂着没落尽的金黄叶子，叶子上压着雪。 */
function birchGeometry() {
  const bark = new THREE.Color('#ece9e1');
  const scar = new THREE.Color('#3d3a37');
  const trunk = paint(new THREE.CylinderGeometry(0.07, 0.17, 5.6, 6, 7, true).translate(0, 2.8, 0), (at) =>
    hash(Math.round(at.y * 2.2), Math.round(Math.atan2(at.z, at.x) * 2)) < 0.24 ? scar : bark,
  );
  const amber = new THREE.Color('#c58a2c');
  const gold = new THREE.Color('#ecbf4e');
  const leaf = new THREE.Color();
  // 树冠是一小团一小团的叶子，绕着树干错落着往上收：[离树干多远, 高度, 半径]
  const clumps = [
    [1.15, 3.3, 0.62],
    [1.0, 3.7, 0.68],
    [1.2, 4.1, 0.6],
    [0.85, 4.5, 0.7],
    [0.9, 4.9, 0.62],
    [0.55, 5.3, 0.66],
    [0.5, 5.7, 0.55],
    [0, 6.1, 0.6],
  ].map(([away, y, radius], i) => {
    // 每团比上一团多转一个黄金角，从哪边看都不会排成一列
    const around = i * 2.4;
    const clump = new THREE.IcosahedronGeometry(radius, 0).scale(1, 0.72, 1).rotateY(i).translate(Math.cos(around) * away, y, Math.sin(around) * away);
    return paint(clump, (at, normal) => {
      if (normal.y > 0.6) return SNOW;
      return leaf.lerpColors(amber, gold, hash(Math.round(normal.x * 7) + i, Math.round(normal.z * 7)));
    });
  });
  return mergeParts([trunk, ...clumps]);
}

/** 白桦林：长在低处针叶林的边上，给一片墨绿添点暖色。obstacles 可选：传进来就把树干登记成障碍。 */
export function buildBirches(ctx, obstacles = null) {
  const spots = [];
  for (const { x, z, roll } of jitteredGrid(ctx.terrain.worldSize, BIRCH.spacing, 211)) {
    if (Math.abs(forestDensity(x, z) - FOREST_EDGE) > BIRCH.fringe || roll(2) > BIRCH.chance) continue;
    const sample = ctx.terrain.sample(x, z);
    const line = BIRCH.line + (valueNoise(x * 0.002 + 5, z * 0.002 + 9) - 0.5) * 300;
    if (sample.height > line || sample.slope > BIRCH.maxSlope || !isFree(ctx, x, z, BIRCH.clearance)) continue;
    const scale = 0.8 + roll(3) * 0.7;
    spots.push({ x, y: sample.height - 0.1, z, turn: roll(4) * Math.PI * 2, scale: [scale, scale * (0.9 + roll(5) * 0.3), scale] });
    obstacles?.addCircle(x, z, BIRCH.trunkRadius * scale, BIRCH.height * scale);
  }
  const group = instanceByChunk(spots, birchGeometry(), toonMat('#ffffff', { vertexColors: true }), ctx.terrain.worldSize);
  group.name = 'Birches';
  return group;
}

/** 一丛红柳：十来根红褐色的枝条从雪里朝四面散开，越到梢头越红。 */
function shrubGeometry() {
  const root = new THREE.Color('#5a2321');
  const tip = new THREE.Color('#d2573b');
  const twig = new THREE.Color();
  const stems = Array.from({ length: SHRUB.stems }, (unused, i) => {
    const height = 1.1 + hash(i, 3) * 0.7;
    const lean = 0.15 + hash(i, 5) * 0.55;
    const stem = new THREE.ConeGeometry(0.05, height, 4, 1, true).translate(0, height / 2, 0);
    paint(stem, (at) => twig.lerpColors(root, tip, at.y / height));
    return stem.rotateZ(lean).rotateY((i / SHRUB.stems) * Math.PI * 2 + hash(i, 7));
  });
  return mergeParts(stems);
}

/** 红柳丛：成片长在低处平缓的空地上，板子可以直接穿过去。 */
export function buildShrubs(ctx) {
  const spots = [];
  for (const { x, z, roll } of jitteredGrid(ctx.terrain.worldSize, SHRUB.spacing, 307)) {
    if (valueNoise(x * 0.011 + 90, z * 0.011 + 55) < SHRUB.thicket || roll(2) > SHRUB.chance) continue;
    if (forestDensity(x, z) > FOREST_EDGE + 0.06) continue;
    const sample = ctx.terrain.sample(x, z);
    if (sample.height > SHRUB.line || sample.slope > SHRUB.maxSlope || !isFree(ctx, x, z, SHRUB.clearance)) continue;
    spots.push({ x, y: sample.height, z, turn: roll(3) * Math.PI * 2, scale: 0.8 + roll(4) * 0.9 });
  }
  const group = instanceByChunk(spots, shrubGeometry(), toonMat('#ffffff', { vertexColors: true, side: THREE.DoubleSide }), ctx.terrain.worldSize);
  group.name = 'Shrubs';
  return group;
}
