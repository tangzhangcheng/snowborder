import * as THREE from 'three';
import { displayColor } from '../render/snowMaterial.js';

/**
 * 一天里四个时刻的配色，按太阳高度（方向的 y 分量）在相邻两个之间插值。
 * 清晨和傍晚太阳高度一样，所以共用同一套。
 *
 * zenith / horizon / fog / cloud：天空与雾
 * sunTint / shadeTint：雪面受光面、背光面各乘的颜色
 * keyLight / keyPower：主光（白天是太阳，夜里是月亮）
 * skyLight / groundLight / fillPower：环境光
 * flat：把雪面明暗压平的程度；stars：星星亮度；shadow：云影强度
 */
const LOOKS = [
  {
    height: -0.3,
    zenith: '#0a1330',
    horizon: '#1d2c52',
    fog: '#1a2748',
    cloud: '#2a3558',
    disc: '#ff8a55',
    sunTint: '#6f86c4',
    shadeTint: '#3a4a86',
    keyLight: '#8fa6e6',
    keyPower: 0.55,
    skyLight: '#5a6ca8',
    groundLight: '#2a3050',
    fillPower: 0.55,
    flat: 0.15,
    stars: 1,
    shadow: 0.4,
  },
  {
    // 太阳刚落到地平线下：没有主光，日月在这一刻交班，雪面是一片平的蓝紫
    height: -0.08,
    zenith: '#2b3f73',
    horizon: '#a8859c',
    fog: '#8f86a6',
    cloud: '#8d83a3',
    disc: '#ff8050',
    sunTint: '#9a9ccb',
    shadeTint: '#8388c0',
    keyLight: '#7a80b8',
    keyPower: 0.05,
    skyLight: '#8088b8',
    groundLight: '#4a4a66',
    fillPower: 0.8,
    flat: 1,
    stars: 0.35,
    shadow: 0.2,
  },
  {
    height: 0.1,
    zenith: '#5b86b8',
    horizon: '#f6c9a0',
    fog: '#ecc9ae',
    cloud: '#ffd9bd',
    disc: '#ffb060',
    sunTint: '#ffd2a6',
    shadeTint: '#b9b4dc',
    keyLight: '#ffb37a',
    keyPower: 1.2,
    skyLight: '#d9c8de',
    groundLight: '#8a7f86',
    fillPower: 0.95,
    flat: 0,
    stars: 0,
    shadow: 0.8,
  },
  {
    height: 0.36,
    zenith: '#5fa8c9',
    horizon: '#dcebea',
    fog: '#d3e4e6',
    cloud: '#fafbf7',
    disc: '#fff6dc',
    sunTint: '#ffffff',
    shadeTint: '#ffffff',
    keyLight: '#fff3df',
    keyPower: 1.5,
    skyLight: '#e6f0f5',
    groundLight: '#9a9388',
    fillPower: 1.15,
    flat: 0,
    stars: 0,
    shadow: 1,
  },
].map((look) => Object.fromEntries(Object.entries(look).map(([key, value]) => [key, typeof value === 'string' ? displayColor(value) : value])));

/** 一份可以反复写入的空配色。 */
export function createLook() {
  return Object.fromEntries(Object.entries(LOOKS[0]).map(([key, value]) => [key, value.isColor ? value.clone() : value]));
}

/** 按太阳高度取配色，写进 out。 */
export function sampleLook(height, out) {
  // 比最高的那档还高就停在最后一档，比最低的还低就停在第一档
  const found = LOOKS.findIndex((look) => look.height >= height);
  const upper = found < 0 ? LOOKS.length - 1 : Math.max(1, found);
  const a = LOOKS[upper - 1];
  const b = LOOKS[upper];
  const t = THREE.MathUtils.clamp((height - a.height) / (b.height - a.height), 0, 1);
  for (const key of Object.keys(a)) {
    if (a[key].isColor) out[key].lerpColors(a[key], b[key], t);
    else out[key] = THREE.MathUtils.lerp(a[key], b[key], t);
  }
  return out;
}
