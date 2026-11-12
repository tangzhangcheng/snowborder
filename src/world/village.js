import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';
import { lodge } from './dressing.js';
import { createSign } from './signs.js';
import { campCentres, isClear, mergeParts, paintFlat } from './scatter.js';

const HUT = { width: 9, depth: 7, height: 8 };
const GROOMER = { halfWidth: 2.4, halfLength: 3.3, height: 3 };
const FLAG = { pole: 6, width: 1.7, height: 1.05, sway: 0.3 };
const FLAG_COLORS = ['#d8473a', '#f0b429', '#2f7fd6', '#35a063', '#e2603a'];
/** 彩旗串：两根杆子隔多远、多高，中间垂下来多少，挂几面小旗（米）。 */
const BUNTING = { span: 9, pole: 3.6, sag: 0.9, flags: 15 };
/**
 * 营地的空地怎么找：lodge 是大木屋占的半径，reach 是离木屋最远找到哪（都是米），step 是找位置的格子大小；
 * gap 是两组摆设之间留的空，parking 是离停着的车留的空，margin 是离雪道边线留的空；rim 是一圈上查几个点。
 */
const CAMP_GROUND = { lodge: 13, reach: 42, step: 3, gap: 1.5, parking: 5, margin: 2, rim: 8 };
/** 山顶的标记在出生点周围找地方：依次试这几个距离（米），每圈试这么多个方向。 */
const SUMMIT_SEARCH = { rings: [16, 20, 24, 30, 36], steps: 16, margin: 4 };

const MAT = {
  snow: toonMat('#f6f8f9'),
  coal: toonMat('#2b2f36'),
  carrot: toonMat('#e8792b'),
  scarf: toonMat('#d8473a'),
  wood: toonMat('#8a6243'),
  twig: toonMat('#5d4636'),
  steel: toonMat('#7b8790'),
  red: toonMat('#d8473a'),
  glass: toonMat('#26323d'),
  blade: toonMat('#c9ccd1'),
  painted: toonMat('#ffffff', { vertexColors: true, side: THREE.DoubleSide }),
};

/** 在 parent 上加一个网格，放在 [x, y, z]。 */
function part(parent, geometry, material, [x, y, z]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** 雪人：三个雪球、胡萝卜鼻子、煤球眼睛、围巾、礼帽和树枝胳膊，脸朝 +z。 */
function snowman() {
  const man = new THREE.Group();
  [[0.55, 0.45], [0.4, 1.2], [0.28, 1.78]].forEach(([radius, y]) => part(man, new THREE.SphereGeometry(radius, 12, 9), MAT.snow, [0, y, 0]));
  part(man, new THREE.ConeGeometry(0.05, 0.32, 6).rotateX(Math.PI / 2), MAT.carrot, [0, 1.78, 0.4]);
  for (const side of [-1, 1]) {
    part(man, new THREE.SphereGeometry(0.035, 6, 5), MAT.coal, [side * 0.1, 1.86, 0.25]);
    part(man, new THREE.CylinderGeometry(0.02, 0.025, 0.8, 4).rotateZ(side * -1.1), MAT.twig, [side * 0.68, 1.35, 0]);
  }
  [1.05, 1.25].forEach((y) => part(man, new THREE.SphereGeometry(0.04, 6, 5), MAT.coal, [0, y, 0.39]));
  part(man, new THREE.TorusGeometry(0.27, 0.07, 6, 12).rotateX(Math.PI / 2), MAT.scarf, [0, 1.53, 0]);
  part(man, new THREE.CylinderGeometry(0.32, 0.32, 0.04, 12), MAT.coal, [0, 2.02, 0]);
  part(man, new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12), MAT.coal, [0, 2.17, 0]);
  return man;
}

/** 长椅：朝 +z 坐。 */
function bench() {
  const seat = new THREE.Group();
  part(seat, new THREE.BoxGeometry(1.8, 0.08, 0.5), MAT.wood, [0, 0.48, 0]);
  part(seat, new THREE.BoxGeometry(1.8, 0.45, 0.07), MAT.wood, [0, 0.85, -0.24]);
  part(seat, new THREE.BoxGeometry(1.7, 0.06, 0.4), MAT.snow, [0, 0.55, 0.02]);
  for (const side of [-1, 1]) part(seat, new THREE.BoxGeometry(0.08, 0.48, 0.46), MAT.twig, [side * 0.8, 0.24, 0]);
  return seat;
}

/** 旗杆和一面旗。返回的 group.userData.flag 是会随风摆的那面旗（绕着旗杆转）。 */
function flagPole(color) {
  const pole = new THREE.Group();
  part(pole, new THREE.CylinderGeometry(0.05, 0.07, FLAG.pole, 6), MAT.steel, [0, FLAG.pole / 2, 0]);
  part(pole, new THREE.SphereGeometry(0.1, 8, 6), MAT.carrot, [0, FLAG.pole + 0.05, 0]);
  // 旗面的一条边贴着旗杆，转动时才像是挂在杆上
  const cloth = new THREE.PlaneGeometry(FLAG.width, FLAG.height, 8, 1).translate(FLAG.width / 2, 0, 0);
  const pos = cloth.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 4) * 0.1 * (pos.getX(i) / FLAG.width));
  cloth.computeVertexNormals();
  pole.userData.flag = part(pole, cloth, toonMat(color, { side: THREE.DoubleSide }), [0, FLAG.pole - FLAG.height / 2 - 0.15, 0]);
  return pole;
}

/** 雪板架：一根横杆上靠着几块颜色各异的雪板。 */
function boardRack() {
  const rack = new THREE.Group();
  part(rack, new THREE.BoxGeometry(2.6, 0.08, 0.08), MAT.wood, [0, 1.05, 0]);
  for (const side of [-1, 1]) part(rack, new THREE.BoxGeometry(0.1, 1.1, 0.1), MAT.wood, [side * 1.25, 0.55, 0]);
  ['#2f7fd6', '#f0b429', '#d8473a', '#35a063', '#8e5bd0'].forEach((color, i) => {
    const board = part(rack, new THREE.BoxGeometry(0.27, 1.5, 0.04), toonMat(color), [-1 + i * 0.5, 0.74, 0.22]);
    board.rotation.x = -0.22;
  });
  return rack;
}

/** 压雪车：红车身、驾驶室、两条履带，前面一把推雪铲，后面拖着压雪器。车头朝 +z。 */
function groomer() {
  const car = new THREE.Group();
  part(car, new THREE.BoxGeometry(2.6, 1, 4.2), MAT.red, [0, 1.15, 0]);
  part(car, new THREE.BoxGeometry(2.3, 1.15, 1.9), MAT.red, [0, 2.2, 0.5]);
  part(car, new THREE.BoxGeometry(2.36, 0.62, 1.96), MAT.glass, [0, 2.3, 0.5]);
  part(car, new THREE.BoxGeometry(2.4, 0.1, 2), MAT.snow, [0, 2.82, 0.5]);
  part(car, new THREE.CylinderGeometry(0.1, 0.1, 0.18, 8), MAT.carrot, [0.7, 2.96, 0.2]);
  for (const side of [-1, 1]) part(car, new THREE.BoxGeometry(0.85, 0.7, 4.9), MAT.coal, [side * 1.55, 0.35, 0]);
  part(car, new THREE.BoxGeometry(4.6, 0.95, 0.22), MAT.blade, [0, 0.6, 3]).rotation.x = -0.25;
  part(car, new THREE.BoxGeometry(4.7, 0.45, 0.9), MAT.coal, [0, 0.3, -3.1]);
  return car;
}

/** 彩旗串：两根杆子之间拉一根垂下来的绳，挂满五色的三角小旗。沿 x 方向展开，原点在中间的地面上。 */
function bunting() {
  const line = new THREE.Group();
  for (const side of [-1, 1]) part(line, new THREE.CylinderGeometry(0.05, 0.06, BUNTING.pole, 6), MAT.steel, [side * (BUNTING.span / 2), BUNTING.pole / 2, 0]);
  const gap = BUNTING.span / BUNTING.flags;
  const flags = Array.from({ length: BUNTING.flags }, (unused, i) => {
    const x = -BUNTING.span / 2 + (i + 0.5) * gap;
    // 绳子中间垂得最低，两头挂在杆顶
    const y = BUNTING.pole - 0.1 - BUNTING.sag * (1 - (x / (BUNTING.span / 2)) ** 2);
    const flag = new THREE.BufferGeometry();
    flag.setAttribute('position', new THREE.Float32BufferAttribute([x - gap * 0.42, y, 0, x + gap * 0.42, y, 0, x, y - 0.55, 0], 3));
    flag.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
    flag.computeVertexNormals();
    return paintFlat(flag, FLAG_COLORS[i % FLAG_COLORS.length]);
  });
  line.add(new THREE.Mesh(mergeParts(flags), MAT.painted));
  return line;
}

/** 石堆：几块石头从大到小摞起来，顶上压着雪。 */
function cairn() {
  const pile = new THREE.Group();
  [[0.75, 0.5, 0.25], [0.55, 0.42, 0.68], [0.38, 0.36, 1.05]].forEach(([radius, height, y], i) => {
    part(pile, new THREE.CylinderGeometry(radius * 0.8, radius, height, 6).rotateY(i * 0.5), MAT.steel, [0, y, 0]);
  });
  part(pile, new THREE.ConeGeometry(0.32, 0.22, 6), MAT.snow, [0, 1.34, 0]);
  return pile;
}

/**
 * 营地里一组一组的摆设，排在前面的先挑位置。radius 是这一组占地的半径（米）；
 * 每件东西的 at 是相对这一组中心的 [往右, 往前]（米），“前”是朝着山脚站、也就是人来的方向。
 * turn 是在朝前的基础上再转多少；solid 是登记成障碍的矩形 [半宽, 半深, 高]；sink 是往雪里埋多深。
 */
function campSets() {
  const hut = (color) => ({ make: () => lodge(HUT.width, HUT.depth, color), at: [0, 0], solid: [HUT.width / 2 + 0.3, HUT.depth / 2 + 0.3, HUT.height], sink: 0.4 });
  return [
    { radius: 7.5, items: FLAG_COLORS.map((color, i) => ({ make: () => flagPole(color), at: [(i - 2) * 3.2, 0], turn: Math.PI / 2 })) },
    {
      radius: 5.5,
      items: [
        { make: bench, at: [-1.4, -1.2] },
        { make: bench, at: [1.4, -1.2] },
        { make: snowman, at: [-3.6, 1.2], turn: 0.3 },
        { make: snowman, at: [-2.2, 2.2], turn: -0.4, scale: 0.6 },
        { make: boardRack, at: [2.6, 1.6], turn: -0.3 },
      ],
    },
    { radius: 7, items: [hut('#a8674a')] },
    { radius: 7, items: [hut('#8f7a5c')] },
    { radius: 4.5, items: [{ make: groomer, at: [0, 0], turn: 0.5, solid: [GROOMER.halfWidth, GROOMER.halfLength, GROOMER.height] }] },
  ];
}

/**
 * 一处营地的空地。山脚是好几条雪道的终点，木屋周围哪块空着每个营地都不一样，
 * 所以不按固定的图纸摆，而是从木屋边上往外一格一格找空位，一组摆设占一个圆。
 */
class CampGround {
  constructor(ctx, centre) {
    this.ctx = ctx;
    this.centre = centre;
    // 大木屋自己先占着中间
    this.taken = [{ x: centre.x, z: centre.z, radius: CAMP_GROUND.lodge }];
  }

  /** 给半径 radius 的一组摆设找个位置，找不到返回 null。离木屋近的优先。 */
  claim(radius) {
    const reach = CAMP_GROUND.reach - radius;
    const slots = [];
    for (let dz = -reach; dz <= reach; dz += CAMP_GROUND.step) {
      for (let dx = -reach; dx <= reach; dx += CAMP_GROUND.step) slots.push({ x: this.centre.x + dx, z: this.centre.z + dz, radius, away: Math.hypot(dx, dz) });
    }
    const slot = slots.sort((a, b) => a.away - b.away).find((candidate) => this.fits(candidate));
    if (slot) this.taken.push(slot);
    return slot ?? null;
  }

  /** 这个圆里里外外都没被雪道、索道、车占着，也不压着已经摆好的东西。 */
  fits({ x, z, radius }) {
    const apart = (other, room) => Math.hypot(other.x - x, other.z - z) > radius + room;
    if (!this.taken.every((other) => apart(other, other.radius + CAMP_GROUND.gap))) return false;
    if (!this.ctx.world.vehicles.every((vehicle) => apart(vehicle, CAMP_GROUND.parking))) return false;
    const rim = Array.from({ length: CAMP_GROUND.rim }, (unused, i) => (i / CAMP_GROUND.rim) * Math.PI * 2);
    return isClear(this.ctx, x, z, CAMP_GROUND.margin) && rim.every((a) => isClear(this.ctx, x + Math.cos(a) * radius, z + Math.sin(a) * radius, CAMP_GROUND.margin));
  }
}

/** 把一组摆设在 slot 处摆开，整组朝着 facing 弧度的方向；每件东西各自落到自己脚下的地面上。 */
function placeSet(ctx, obstacles, set, slot, facing) {
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  return set.items.map((item) => {
    const [right, ahead] = item.at;
    const x = slot.x + right * cos + ahead * sin;
    const z = slot.z - right * sin + ahead * cos;
    const turn = facing + (item.turn ?? 0);
    const object = item.make();
    object.position.set(x, ctx.terrain.heightAt(x, z) - (item.sink ?? 0), z);
    object.rotation.y = turn;
    object.scale.setScalar(item.scale ?? 1);
    if (item.solid) obstacles?.addBox(x, z, item.solid[0], item.solid[1], turn, item.solid[2]);
    return object;
  });
}

/** 一处营地的全部摆设。station 是这个营地对着的山脚站，摆设都朝着它。 */
function buildCamp(ctx, obstacles, centre, station) {
  const ground = new CampGround(ctx, centre);
  const objects = [];
  for (const set of campSets()) {
    const slot = ground.claim(set.radius);
    if (!slot) continue;
    objects.push(...placeSet(ctx, obstacles, set, slot, Math.atan2(station.x - slot.x, station.z - slot.z)));
  }
  return objects;
}

/** 山顶的标记立在哪：出生点周围一圈圈往外找，要离出生点够近、又不挡雪道和索道。 */
function summitSpot(ctx) {
  const { spawn } = ctx.world;
  for (const radius of SUMMIT_SEARCH.rings) {
    for (let i = 0; i < SUMMIT_SEARCH.steps; i++) {
      const around = (i / SUMMIT_SEARCH.steps) * Math.PI * 2;
      const x = spawn.x + Math.sin(around) * radius;
      const z = spawn.z + Math.cos(around) * radius;
      if (isClear(ctx, x, z, SUMMIT_SEARCH.margin)) return { x, z };
    }
  }
  return null;
}

/** 山顶的标记：石堆、写着海拔的牌子和一串彩旗，都朝着出生点。 */
function summitMarker(ctx, obstacles) {
  const spot = summitSpot(ctx);
  const peak = ctx.world.pois.find((poi) => poi.kind === 'peak');
  if (!spot || !peak) return null;
  const marker = new THREE.Group();
  const sign = createSign({ title: peak.name, note: `海拔 ${Math.round(peak.h)} 米`, color: '#3b4a5a', shape: 'diamond' });
  const stones = cairn();
  stones.position.set(2.6, 0, 0.3);
  const flags = bunting();
  flags.position.set(0, 0, -1.6);
  marker.add(sign, stones, flags);
  const turn = Math.atan2(ctx.world.spawn.x - spot.x, ctx.world.spawn.z - spot.z);
  marker.position.set(spot.x, ctx.terrain.heightAt(spot.x, spot.z) - 0.1, spot.z);
  marker.rotation.y = turn;
  obstacles?.addBox(spot.x, spot.z, 1.6, 0.3, turn, 2.6);
  return marker;
}

/**
 * 山脚营地的小木屋、压雪车、雪人、长椅、旗杆，和山顶的标记。
 * obstacles 可选：传进来就把木屋、压雪车这些大件登记成障碍。
 * 返回 { group, update(time) }，update 让旗子摆起来。
 */
export function buildVillage(ctx, obstacles = null) {
  const group = new THREE.Group();
  group.name = 'Village';
  const flags = [];
  const stations = ctx.world.pois.filter((poi) => poi.kind === 'base');
  campCentres(ctx.world).forEach((centre, i) => {
    for (const object of buildCamp(ctx, obstacles, centre, stations[i])) {
      group.add(object);
      if (object.userData.flag) flags.push(object.userData.flag);
    }
  });
  const marker = summitMarker(ctx, obstacles);
  if (marker) group.add(marker);
  return {
    group,
    update(time) {
      flags.forEach((flag, i) => (flag.rotation.y = Math.sin(time * 1.7 + i * 1.3) * FLAG.sway));
    },
  };
}
