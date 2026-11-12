import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';
import { mergeParts, paintFlat } from './scatter.js';

/** 球囊分成几瓣上色；吊篮挂在球囊口下面多少米。 */
const GORES = 12;
const BASKET_DROP = 3.4;
/** 球囊的剖面：[半径, 高度]（米），从底下的开口到顶。 */
const PROFILE = [[2.2, 0], [4.6, 4], [8, 9], [10.4, 14], [11, 18], [10, 22], [7, 24.8], [3.5, 26], [0.01, 26.4]];
/** 飞行：离航线上最高的山头至少多少米，上下浮动多少米、多快（弧度/秒）。 */
const FLIGHT = { clearance: 170, bob: 7, bobRate: 0.35, samples: 24 };
/** 比真的热气球大一倍多：它们总在一两公里外，按真实大小只剩一个小点。 */
const SIZE = 2.4;
/**
 * 每只热气球绕着一个圈慢慢飘。centre 是圆心占地图边长的比例，radius 是半径（米），
 * period 是飘一圈要多少秒，colors 是球囊一瓣一瓣轮着上的颜色。
 */
const ROUTES = [
  { centre: [0.36, 0.72], radius: 700, period: 560, colors: ['#d8473a', '#f6f1e4'] },
  { centre: [0.62, 0.46], radius: 900, period: 720, colors: ['#f0b429', '#2f7fd6'] },
  { centre: [0.45, 0.2], radius: 600, period: 640, colors: ['#e2603a', '#f6f1e4', '#35a063'] },
  { centre: [0.3, 0.42], radius: 800, period: 680, colors: ['#8e5bd0', '#f0b429'] },
  { centre: [0.55, 0.78], radius: 650, period: 600, colors: ['#2f7fd6', '#f6f1e4', '#d8473a'] },
];

/** 球囊：按剖面旋出来的水滴形，一瓣一瓣轮着上色。 */
function envelopeGeometry(colors) {
  const geo = new THREE.LatheGeometry(PROFILE.map(([radius, y]) => new THREE.Vector2(radius, y)), GORES).toNonIndexed();
  const pos = geo.attributes.position;
  const palette = colors.map((color) => new THREE.Color(color));
  const paintWork = new Float32Array(pos.count * 3);
  // 按三角形上色：三个顶点取同一瓣的颜色，瓣和瓣之间才有清楚的分界
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2);
    const z = pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2);
    const gore = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * GORES) % GORES;
    const color = palette[gore % palette.length];
    for (let v = 0; v < 3; v++) paintWork.set([color.r, color.g, color.b], (i + v) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(paintWork, 3));
  return geo;
}

/** 吊篮和四根吊绳。 */
function basketGeometry() {
  const basket = paintFlat(new THREE.BoxGeometry(1.9, 1.4, 1.9).translate(0, -BASKET_DROP, 0), '#8a6243');
  const ropes = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => paintFlat(new THREE.BoxGeometry(0.06, BASKET_DROP - 0.6, 0.06).translate(sx * 0.9, -(BASKET_DROP - 0.6) / 2, sz * 0.9), '#3d3a37')),
  );
  return mergeParts([basket, ...ropes]);
}

/** 这条航线该飞多高：沿着圈看一遍，比最高的山头再高出一截。 */
function cruiseHeight(terrain, x, z, radius) {
  let top = -Infinity;
  for (let i = 0; i < FLIGHT.samples; i++) {
    const around = (i / FLIGHT.samples) * Math.PI * 2;
    top = Math.max(top, terrain.heightAt(x + Math.cos(around) * radius, z + Math.sin(around) * radius));
  }
  return top + FLIGHT.clearance;
}

/** 天上慢慢飘着的几只热气球，给一片白的远景添点颜色。 */
export class Balloons {
  constructor(terrain) {
    this.group = new THREE.Group();
    this.group.name = 'Balloons';
    this.time = 0;
    const mat = toonMat('#ffffff', { vertexColors: true });
    const basket = basketGeometry();
    this.fleet = ROUTES.map((route, i) => {
      const x = route.centre[0] * terrain.worldSize;
      const z = route.centre[1] * terrain.worldSize;
      const mesh = new THREE.Mesh(mergeParts([envelopeGeometry(route.colors), basket]), mat);
      mesh.scale.setScalar(SIZE);
      this.group.add(mesh);
      // 各从圈上不同的地方出发
      return { mesh, x, z, route, height: cruiseHeight(terrain, x, z, route.radius), phase: i * 2.1 };
    });
    this.update(0);
  }

  update(dt) {
    this.time += dt;
    for (const { mesh, x, z, route, height, phase } of this.fleet) {
      const around = phase + (this.time / route.period) * Math.PI * 2;
      const bob = Math.sin(this.time * FLIGHT.bobRate + phase) * FLIGHT.bob;
      mesh.position.set(x + Math.cos(around) * route.radius, height + bob, z + Math.sin(around) * route.radius);
    }
  }
}
