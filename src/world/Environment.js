import * as THREE from 'three';
import { skyUniforms, snowUniforms } from '../render/snowMaterial.js';
import { rimLevel } from '../render/Toon.js';
import { createLook, sampleLook } from './skyPalette.js';
import { Weather } from './Weather.js';

const START_HOUR = 10;
const SUNRISE = 7;
const SUNSET = 19;
/** 现实里过一秒，游戏里过多少小时：白天一分钟一小时，夜里快三倍，免得一直摸黑。 */
const DAY_RATE = 1 / 60;
const NIGHT_RATE = 1 / 20;
/** 手动拨快时间时每秒走几小时，天色是滑过去的而不是跳过去的。 */
const SKIP_RATE = 3;
/** 正午太阳、午夜月亮的仰角（弧度）。 */
const SUN_PEAK = 0.75;
const MOON_PEAK = 0.6;
/** 太阳落到这个高度以下，主光交给月亮；配色表在这一刻正好没有主光，看不出交班。 */
const SWITCH_HEIGHT = -0.08;
/** 主光再低也按这个高度打，不然日出日落时整座山都在背光里。 */
const MIN_KEY_HEIGHT = 0.25;
/** 雪场的纬度（弧度）：北天极在正北、仰角等于纬度的地方，星空绕着它一天转一圈。 */
const LATITUDE = THREE.MathUtils.degToRad(48);
const STAR_AXIS = new THREE.Vector3(0, 0, 1);
/** 把北天极（世界里 -z 是北）摆到星空坐标系的 z 轴上。 */
const POLE_TO_AXIS = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, Math.sin(LATITUDE), -Math.cos(LATITUDE)), STAR_AXIS);
const LIGHT_DISTANCE = 100;
const DAY_FILL_POWER = 1.15;
const DEFAULT_HAZE = [1200, 18000];
/** 阴到头时，天和雾的亮度、雪面的亮度各剩几成。 */
const OVERCAST_SKY = 0.8;
const OVERCAST_SNOW = 0.88;

/**
 * 时间、昼夜和天气：算出此刻的日月位置和配色，写进灯光、雾、雪面和天空。
 * live 为 false 时停在上午的晴天（独立沙盘页用）。
 */
export class Environment {
  constructor(scene, { live = false } = {}) {
    this.scene = scene;
    this.live = live;
    this.hour = START_HOUR;
    this.pending = 0;
    this.weather = new Weather();
    this.look = createLook();
    this.haze = { near: DEFAULT_HAZE[0], far: DEFAULT_HAZE[1], share: 1 };
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.keyDir = new THREE.Vector3();
    this.grey = new THREE.Color();
    this.tint = new THREE.Color();
    this.starSpin = new THREE.Quaternion();
    this.starTurn = new THREE.Matrix4();
    this.unlit = [];

    this.key = new THREE.DirectionalLight('#ffffff', 1);
    this.fill = new THREE.HemisphereLight('#ffffff', '#ffffff', 1);
    scene.add(this.key, this.fill);
    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog('#ffffff', ...DEFAULT_HAZE);
    this.apply();
  }

  get night() {
    return this.hour < SUNRISE || this.hour >= SUNSET;
  }

  get clockLabel() {
    const minutes = Math.floor(this.hour * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  /** 把时间往后拨几小时。 */
  skip(hours) {
    this.pending += hours;
  }

  /** 不受光照的材质（雪雾）登记进来，夜里跟着一起暗下去。 */
  follow(material) {
    this.unlit.push({ material, base: material.color.clone() });
  }

  /** share：天气对能见度的影响占几成。沙盘离得远，暴雪时也得看得见山。 */
  setHaze(near, far, share = 1) {
    this.haze = { near, far, share };
  }

  update(dt) {
    if (this.live) {
      this.tick(dt);
      this.weather.update(dt);
    }
    this.apply();
  }

  tick(dt) {
    const skipped = Math.min(this.pending, SKIP_RATE * dt);
    this.pending -= skipped;
    this.hour = (this.hour + (this.night ? NIGHT_RATE : DAY_RATE) * dt + skipped) % 24;
  }

  apply() {
    this.placeSunAndMoon();
    sampleLook(this.sunDir.y, this.look);
    this.look.glow = 1;
    this.shadeByWeather(this.look, this.weather.now);
    this.pushSnow(this.look);
    this.pushSky(this.look);
    this.pushLights(this.look);
    this.pushHaze();
  }

  /** 太阳白天从东经南到西，夜里绕到地平线下面；月亮正好反过来。 */
  placeSunAndMoon() {
    const span = SUNSET - SUNRISE;
    const day = (this.hour - SUNRISE) / span;
    const dark = ((this.hour - SUNSET + 24) % 24) / (24 - span);
    arc(this.sunDir, this.night ? 1 + dark : day, SUN_PEAK);
    arc(this.moonDir, this.night ? dark : 1 + day, MOON_PEAK);
    this.keyDir.copy(this.sunDir.y > SWITCH_HEIGHT ? this.sunDir : this.moonDir);
    this.keyDir.y = Math.max(this.keyDir.y, MIN_KEY_HEIGHT);
    this.keyDir.normalize();
  }

  /** 阴天、下雪：天和雾发灰，主光变弱，雪面明暗被压平，日月星星都看不见。 */
  shadeByWeather(look, { gloom }) {
    const grey = toGrey(this.grey.copy(look.fog));
    look.fog.lerp(grey, gloom * 0.7);
    look.horizon.lerp(look.fog, gloom);
    look.zenith.lerp(grey.multiplyScalar(0.88), gloom * 0.9);
    look.cloud.lerp(grey, gloom * 0.6);
    const even = this.tint.lerpColors(look.shadeTint, look.sunTint, 0.5).multiplyScalar(OVERCAST_SNOW);
    look.sunTint.lerp(even, gloom);
    look.shadeTint.lerp(even, gloom * 0.6);
    look.keyPower *= 1 - 0.75 * gloom;
    look.flat = Math.max(look.flat, gloom * 0.8);
    look.stars *= 1 - gloom;
    look.shadow *= 1 - gloom;
    look.glow = 1 - gloom;
  }

  pushSnow(look) {
    snowUniforms.uLight.value.copy(this.keyDir);
    snowUniforms.uFog.value.copy(look.fog);
    snowUniforms.uSunTint.value.copy(look.sunTint);
    snowUniforms.uShadeTint.value.copy(look.shadeTint);
    snowUniforms.uFlat.value = look.flat;
    snowUniforms.uCloudShadow.value = look.shadow;
  }

  pushSky(look) {
    skyUniforms.uZenith.value.copy(look.zenith);
    skyUniforms.uHorizon.value.copy(look.horizon);
    skyUniforms.uCloud.value.copy(look.cloud);
    skyUniforms.uSunColor.value.copy(look.disc);
    skyUniforms.uSunDir.value.copy(this.sunDir);
    skyUniforms.uMoonDir.value.copy(this.moonDir);
    skyUniforms.uCover.value = this.weather.now.cover;
    skyUniforms.uStars.value = look.stars;
    skyUniforms.uGlow.value = look.glow;
    this.turnStars();
  }

  /** 星空跟着钟点绕北天极转：和太阳一样东升西落，一天一圈。 */
  turnStars() {
    this.starSpin.setFromAxisAngle(STAR_AXIS, (this.hour / 24) * Math.PI * 2).multiply(POLE_TO_AXIS);
    skyUniforms.uSkyTurn.value.setFromMatrix4(this.starTurn.makeRotationFromQuaternion(this.starSpin));
  }

  /** 配色表里存的是显示色，交给 three 的灯和雾之前要转回线性空间。 */
  pushLights(look) {
    this.key.position.copy(this.keyDir).multiplyScalar(LIGHT_DISTANCE);
    this.key.intensity = look.keyPower;
    this.fill.intensity = look.fillPower;
    toLinear(this.key.color, look.keyLight);
    toLinear(this.fill.color, look.skyLight);
    toLinear(this.fill.groundColor, look.groundLight);
    toLinear(this.scene.fog.color, look.fog);
    toLinear(this.scene.background, look.horizon);
    // 轮廓光是叠加上去的，身上暗了它就格外显眼，所以比天光暗得更快
    rimLevel.value = (look.fillPower / DAY_FILL_POWER) ** 3;
    toLinear(this.tint, this.tint.lerpColors(look.shadeTint, look.sunTint, 0.65));
    for (const { material, base } of this.unlit) material.color.copy(base).multiply(this.tint);
  }

  pushHaze() {
    const { near, far, share } = this.haze;
    const scale = THREE.MathUtils.lerp(1, this.weather.now.visibility, share);
    snowUniforms.uFogNear.value = near * scale;
    snowUniforms.uFogFar.value = far * scale;
    this.scene.fog.near = near * scale;
    this.scene.fog.far = far * scale;
  }
}

/** 天上的一道弧：progress 0 在东边地平线，0.5 在正南最高处，1 在西边地平线，再往后转到地下。 */
function arc(out, progress, peak) {
  const around = Math.PI * progress;
  const lift = Math.sin(around) * peak;
  return out.set(Math.cos(around) * Math.cos(lift), Math.sin(lift), Math.sin(around) * Math.cos(lift));
}

/** 阴天的雾色：比原来暗一档的冷灰，白色的雪花才衬得出来。 */
function toGrey(color) {
  const light = (color.r * 0.3 + color.g * 0.59 + color.b * 0.11) * OVERCAST_SKY;
  return color.setRGB(light * 0.96, light * 0.985, light * 1.02);
}

function toLinear(target, display) {
  return target.copy(display).convertSRGBToLinear();
}
