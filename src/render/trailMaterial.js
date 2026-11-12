import * as THREE from 'three';
import { NOISE, SNOW_SHADING, snowUniforms } from './snowMaterial.js';

/** 刃切出的那道直壁画多宽（米，半宽）。 */
const WALL_LINE = 0.008;
/** 平板压过的雪盖住底下压纹几成：垄只是被压矮了，还隐约看得见。 */
const GLIDE_COVER = 0.6;
/** 搓过或陷进粉雪的一片盖住底下几成。 */
const WORN_COVER = 0.92;
/** 甩到弯外侧的碎雪，离沟多远（米）就薄到原来的三成多。 */
const SPRAY_FALLOFF = 0.14;
/** 碎雪最厚的地方盖住底下压纹几成：薄薄一层，垄沟还透得出来。 */
const SPRAY_COVER = 0.8;
/** 搓雪带和粉雪槽两边推出来的雪沿有多宽（米）。 */
const RIM_WIDTH = 0.07;
/** 刻出来的沟最深处有多暗。比压纹的沟底（1）还暗得多，远看才是一道清楚的线。 */
const TRENCH_SHADE = 1.9;
/** 堆起来的碎雪有多亮（数值含义同 packedTint 的 shade：0 最亮，1 像压纹的沟底）。 */
const LOOSE_SHADE = 0.12;
/** 比压纹的沟底更深的地方照不到天光，往这个灰蓝色暗下去，而不是越来越艳的蓝。 */
const DEEP_SHADOW = 'vec3(0.56, 0.68, 0.87)';

const VERTEX = `
  attribute vec3 aNormal;
  attribute vec2 aBand;
  attribute vec4 aMark;
  attribute vec4 aTrack;
  uniform vec3 uLight;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vBand;
  varying vec4 vMark;
  varying vec3 vTrack;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = aNormal;
    vBand = aBand;
    vMark = aMark;
    // 太阳在痕迹的哪一侧：沟壁朝着它的亮，背着它的暗
    vTrack = vec3(aTrack.xy, dot(aTrack.zw, normalize(uLight.xz + 1e-5)));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * 几种痕迹各自的明暗，数值和 packedTint 的 shade 一个意思：0 最亮，1 像压纹的沟底。
 * x 是横向位置（米，从着地带的中线算起），along 是顺着痕迹走了多远（米）。
 */
const MARKS = `
  // 痕迹的底色：shade 在 0–1 之间和压纹同一套颜色，超过 1 的部分继续往深影里暗
  vec3 markTint(float shade) {
    return mix(packedTint(min(shade, 1.0)), ${DEEP_SHADOW}, clamp(shade - 1.0, 0.0, 1.0));
  }

  // 平板压过的一条：垄被压平，两条板边各留一道浅印
  float glideShade(float inside) {
    return 0.2 + 0.3 * (1.0 - smoothstep(0.0, 0.025, inside));
  }

  // 横着搓过的一片：顺着滑动方向一道道的擦痕，加一点板子颤出来的深浅
  float scrapeShade(float x, float along, float pixel) {
    float fine = 1.0 - smoothstep(0.4, 1.2, pixel * 60.0);
    float streaks = (valueNoise(vec2(x * 18.0, along * 0.5)) - 0.5) * 0.45;
    streaks += (valueNoise(vec2(x * 60.0, along * 0.9)) - 0.5) * 0.3 * fine;
    float chatter = (valueNoise(vec2(along * 2.4, x * 2.0)) - 0.5) * 0.16;
    return 0.26 + streaks + chatter;
  }

  // 粉雪里陷下去的槽：槽底压实了略暗，两侧的壁朝着太阳的亮、背着的暗
  float troughShade(float x, float inside, float sun) {
    float wall = 1.0 - smoothstep(0.0, 0.07, inside);
    return 0.2 + wall * (0.2 + 0.6 * sign(x) * sun);
  }

  // 立刃刻出的沟：刃切出一道直壁，板底压出一个斜面。lit 是斜面朝着太阳几成（-1..1）
  float trenchShade(float fromWall, float width, float lit, float pixel) {
    // 斜面越靠近直壁陷得越深、越暗，到另一头和雪面齐平，颜色接上甩出来的碎雪
    float deep = 1.0 - clamp(fromWall / width, 0.0, 1.0);
    float slope = mix(${LOOSE_SHADE.toFixed(2)}, ${TRENCH_SHADE.toFixed(2)}, pow(deep, 0.8)) - 0.3 * lit * (1.0 - deep);
    // 直壁和斜面朝向相反：斜面受光时壁在沟底投一道深影，斜面背光时壁自己是一条亮线
    float wall = mix(0.0, ${(TRENCH_SHADE * 1.25).toFixed(2)}, smoothstep(-0.3, 0.3, lit));
    return mix(slope, wall, thinLine(fromWall, ${WALL_LINE.toFixed(3)}, pixel));
  }

  // 甩到弯外侧的碎雪：贴着沟的地方厚厚一层，往外越来越薄、越来越碎
  float sprayCover(float outside, float x, float along) {
    float reach = exp(-outside / ${SPRAY_FALLOFF.toFixed(2)});
    float clumps = 0.65 * valueNoise(vec2(along * 8.0, x * 20.0)) + 0.35 * valueNoise(vec2(along * 23.0, x * 51.0));
    return smoothstep(0.0, 0.6, reach * (0.5 + 0.9 * clumps) - 0.15) * ${SPRAY_COVER.toFixed(2)};
  }

  // 搓雪带、粉雪槽两边推出来的一道雪沿
  float rimCover(float outside, float x, float along) {
    float crumbs = 0.55 + 0.45 * valueNoise(vec2(along * 7.0, x * 9.0));
    return (1.0 - smoothstep(0.0, ${RIM_WIDTH.toFixed(2)}, outside)) * crumbs;
  }
`;

const FRAGMENT = `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vBand;
  varying vec4 vMark;
  varying vec3 vTrack;
  ${NOISE}
  ${SNOW_SHADING}
  ${MARKS}

  void main() {
    float x = vBand.x;
    float halfWidth = vBand.y;
    float carve = vMark.x;
    float scrape = vMark.y;
    float sink = vMark.z;
    float wall = vTrack.x;
    float along = vTrack.y;
    float sun = vTrack.z * (1.0 - uFlat);
    float pixel = fwidth(x);
    // 到着地带边缘的距离，里面为正
    float inside = halfWidth - abs(x);

    // 板子压到的那一条。刻出来的边是利落的，搓出来的边是毛的；比一个像素还窄时按比例变淡
    float ragged = (valueNoise(vec2(along * 3.0, x * 4.0)) - 0.5) * 0.06 * scrape;
    float feather = max(pixel, mix(0.012, 0.035, scrape) * (1.0 - carve));
    float pressed = smoothstep(-feather, feather, inside + ragged) * min(1.0, 2.0 * halfWidth / max(pixel, 1e-4));

    float worn = mix(glideShade(inside), scrapeShade(x, along, pixel), scrape);
    worn = mix(worn, troughShade(x, inside, sun) + (worn - 0.2) * 0.5, sink);
    float shade = mix(worn, trenchShade(halfWidth - wall * x, 2.0 * halfWidth, wall * sun, pixel), carve);
    float cover = mix(mix(${GLIDE_COVER.toFixed(2)}, ${WORN_COVER.toFixed(2)}, max(scrape, sink)), 1.0, carve);

    // 板子没压到的两边：走刃时碎雪只往弯外侧甩，搓雪和粉雪则两边各推出一道雪沿
    float outside = max(0.0, -inside);
    float spray = carve * step(0.0, -wall * x) * sprayCover(outside, x, along);
    float rim = max(sink, scrape * 0.6) * (1.0 - carve) * rimCover(outside, x, along);
    float loose = max(spray, rim) * (1.0 - pressed);
    // 堆起来的雪是亮的，粉雪里的雪沿背着太阳的那面略暗
    float lumps = (valueNoise(vec2(along * 9.0, x * 22.0)) - 0.5) * 0.2;
    float looseShade = ${LOOSE_SHADE.toFixed(2)} + lumps - 0.25 * sink * sign(x) * sun;
    shade = mix(looseShade, shade, pressed);

    float tone = snowTone(normalize(vNormal));
    vec3 packed = markTint(shade) * packedLight(tone);
    // 松雪按同样的比例压暗，粉雪里的痕迹和压雪道上的是一个色调
    vec3 powder = looseSnow(tone) * markTint(shade) / markTint(0.0);
    float alpha = max(pressed * cover, loose) * vMark.w;
    gl_FragColor = vec4(snowAir(mix(packed, powder, sink), tone), alpha);
  }
`;

/**
 * 板痕的着色：把横截面画成有起伏的雪——刻出的沟、搓平的面、甩出去的碎雪，
 * 受光、云影、雾都和雪面用同一套算法，所以昼夜阴晴不用另外管。
 */
export function createTrailMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: snowUniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
