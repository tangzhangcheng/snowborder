import * as THREE from 'three';

export const SKY = {
  zenith: '#5fa8c9',
  horizon: '#dcebea',
  fog: '#d3e4e6',
};

/**
 * 压纹一道垄加一道沟的宽度（米）。真的只有三四厘米，照实画的话几米外就糊成一片，
 * 放宽到镜头里看得清一道一道、又不至于像宽色带。
 */
const CORDUROY_PERIOD = 0.14;
const CORDUROY_FREQ = (Math.PI * 2) / CORDUROY_PERIOD;
/** 压雪车一趟压出来的宽度（米）。 */
const LANE_WIDTH = 4.2;
/** 一整道垄沟里，暗的沟平均占多宽的比例。条纹远到看不清时就按这个比例收成均匀的一片，亮度不跳。 */
const GROOVE_SHARE = 0.32;
/** 沟底相对垄顶暗到几成（0 = 和垄顶一样亮，1 = 完全是沟底的颜色），决定整片压雪面的平均颜色。 */
const GROOVE_DEPTH = 0.8;
/** 相邻几格推算出的"到中线距离"相差超过这么多米，就当作两条雪道的交界。 */
const SEAM_SPREAD = 1;

export const NOISE = `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise(p);
      p = p * 2.03 + 17.0;
      amp *= 0.5;
    }
    return sum;
  }
`;

/**
 * 雪的受光和配色，地形和板痕共用：同一处的雪不管是谁画的，明暗、云影、雾都对得上。
 * 用到 vWorld、snowUniforms 和上面的噪声函数。
 */
export const SNOW_SHADING = `
  uniform float uTime;
  uniform vec3 uLight;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uSunTint;
  uniform vec3 uShadeTint;
  uniform float uFlat;
  uniform float uCloudShadow;

  // 法线为 n 的雪面受光几成。轻微分层，保留一点手绘感又不出现硬边
  float snowTone(vec3 n) {
    float lit = smoothstep(-0.2, 0.6, dot(n, uLight));
    float tone = mix(lit, floor(lit * 4.0 + 0.5) / 4.0, 0.3);
    return mix(tone, 0.55, uFlat);
  }

  // 没人动过的松雪
  vec3 looseSnow(float tone) {
    vec3 sunSnow = vec3(1.0, 0.972, 0.925);
    vec3 shadeSnow = vec3(0.70, 0.79, 0.90);
    return mix(shadeSnow, sunSnow, tone) * (0.955 + fbm(vWorld.xz * 0.03) * 0.08);
  }

  // 压实的雪的底色：shade 为 0 时像压纹的垄顶那么亮，为 1 时像沟底那么暗
  vec3 packedTint(float shade) {
    return mix(vec3(1.0, 0.992, 0.968), vec3(0.79, 0.86, 0.955), shade);
  }

  // 压实的雪面是平的，受光多少对亮度的影响比松雪小
  float packedLight(float tone) {
    return 0.84 + 0.17 * tone;
  }

  // 天光染色、缓慢移动的云影、远处的雾
  vec3 snowAir(vec3 color, float tone) {
    color *= mix(uShadeTint, uSunTint, tone);
    float cloud = fbm(vWorld.xz * 0.0009 + vec2(uTime * 0.010, uTime * 0.006));
    float shadow = smoothstep(0.50, 0.66, cloud) * uCloudShadow;
    color *= mix(vec3(1.0), vec3(0.74, 0.82, 0.93), shadow);
    float fog = smoothstep(uFogNear, uFogFar, distance(vWorld, cameraPosition));
    return mix(color, uFog, fog * 0.92);
  }

  // 一条半宽 radius 米的细线，away 是到线中心的距离，pixel 是一个像素盖住多少米。
  // 线比像素还细时不能糊成一条宽带，而是按它占像素的比例变淡
  float thinLine(float away, float radius, float pixel) {
    float soft = max(pixel, 0.02);
    return (1.0 - smoothstep(radius, radius + soft, away)) * (radius * 2.0) / (radius * 2.0 + soft);
  }
`;

/** 机压雪道的画法。用到 vWorld 和上面两段。 */
const GROOMING = `
  // 贴图上的一格按它自己记的方向，推算出当前像素到中线的距离。
  // away 是像素相对这一格中心的位移（格）。返回 (距离, 距离增大的方向)
  vec3 groomFrom(ivec2 cell, vec2 away, float texel) {
    vec2 stored = texelFetch(uLateral, clamp(cell, ivec2(0), textureSize(uLateral, 0) - 1), 0).rg;
    vec2 dir = vec2(cos(stored.g), sin(stored.g));
    return vec3(stored.r + dot(dir, away) * texel, dir);
  }

  // 当前像素到雪道中线的距离和它增大的方向。贴图 3.5 米一格，压纹却只有十几厘米一道：
  // 周围四格各自推算一遍再混合，直道上分毫不差，弯道上也是顺的。
  // 四格对不上，说明这里是两条雪道的交界，取离中线近的那条——交界是一条利落的线，
  // 就像两趟压雪车斜着搭在一起，而不是糊成一片
  vec3 groomAt(vec2 uv) {
    float cells = float(textureSize(uLateral, 0).x);
    vec2 p = uv * cells - 0.5;
    ivec2 cell = ivec2(floor(p));
    vec2 f = fract(p);
    float texel = uWorld / cells;
    vec3 a = groomFrom(cell, f, texel);
    vec3 b = groomFrom(cell + ivec2(1, 0), f - vec2(1.0, 0.0), texel);
    vec3 c = groomFrom(cell + ivec2(0, 1), f - vec2(0.0, 1.0), texel);
    vec3 d = groomFrom(cell + ivec2(1, 1), f - vec2(1.0, 1.0), texel);

    float spread = max(max(a.x, b.x), max(c.x, d.x)) - min(min(a.x, b.x), min(c.x, d.x));
    if (spread < ${SEAM_SPREAD.toFixed(2)}) {
      vec3 blended = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      return vec3(blended.x, normalize(blended.yz + 1e-6));
    }
    vec3 best = a;
    if (abs(b.x) < abs(best.x)) best = b;
    if (abs(c.x) < abs(best.x)) best = c;
    if (abs(d.x) < abs(best.x)) best = d;
    return best;
  }

  // groom 是 groomAt 的结果：(到中线的距离, 距离增大的方向)
  vec3 groomedSnow(vec3 groom, float tone) {
    float lateral = groom.x;
    // 太阳在压纹的哪一侧：横着照过来明暗最分明，顺着照就只剩沟底一点暗
    float sunSide = dot(groom.yz, normalize(uLight.xz + 1e-5));

    float phase = lateral * ${CORDUROY_FREQ.toFixed(3)};
    // 条纹细到快一像素一道时收成均匀的一片
    float detail = 1.0 - smoothstep(0.35, 1.3, fwidth(phase));
    // 垄的两个侧面，朝着太阳的为正
    float flank = -cos(phase) * sunSide;
    // 太阳斜照时暗的那一段往背光面偏；除一下，让沟的宽窄不跟着压纹的朝向变
    float wave = (sin(phase) + flank * 0.9) / sqrt(1.0 + 0.81 * sunSide * sunSide);
    float groove = smoothstep(-0.2, -0.9, wave);
    groove *= 0.9 + 0.2 * valueNoise(vWorld.xz * 2.5);
    groove = mix(${GROOVE_SHARE.toFixed(2)}, groove, detail);
    // 压纹朝向、远近、阴晴只改明暗的反差，不改整片的平均颜色——
    // 不然同一片雪道里朝向不同、离镜头远近不同的地方会一块深一块浅
    float contrast = mix(0.65, 1.0, abs(sunSide)) * (1.0 - 0.6 * uFlat);
    float shade = ${(GROOVE_SHARE * GROOVE_DEPTH).toFixed(3)} + (groove - ${GROOVE_SHARE.toFixed(2)}) * contrast;
    vec3 snow = packedTint(shade);
    snow *= 1.0 + flank * 0.05 * detail * (1.0 - uFlat);

    // 压雪车一趟一趟压过去，两趟之间留一道细细的接缝。各趟的底色是一样的：
    // 给相邻两趟分深浅的话，雪道交汇、压纹换方向的地方会变成一块一块的色斑
    float lane = lateral / ${LANE_WIDTH.toFixed(2)};
    float laneDetail = 1.0 - smoothstep(0.15, 0.5, fwidth(lane));
    float seam = abs(fract(lane) - 0.5) * ${LANE_WIDTH.toFixed(2)};
    snow = mix(snow, vec3(0.74, 0.83, 0.95), thinLine(seam, 0.04, fwidth(lateral)) * 0.5 * laneDetail);

    return snow * packedLight(tone);
  }

  // 雪道边线：近处是一道细细的阴影，外侧一圈被推出来的碎雪；远处换成一条宽的淡蓝带，远看也分得出走向
  vec3 pisteEdge(vec3 color, float cover, float inside, float blur, float dist) {
    float distant = smoothstep(40.0, 200.0, dist);
    float band = smoothstep(0.08, 0.45, cover) * (1.0 - smoothstep(0.45, 0.9, cover));
    color = mix(color, vec3(0.60, 0.72, 0.88), band * 0.55 * distant);
    float crumbs = 1.0 - smoothstep(0.0, 0.45, abs(inside + 0.35));
    color *= 1.0 + (valueNoise(vWorld.xz * 7.0) - 0.45) * 0.22 * crumbs * (1.0 - distant);
    return mix(color, vec3(0.66, 0.77, 0.92), thinLine(abs(inside), 0.05, blur) * 0.55 * (1.0 - distant));
  }
`;

/** 着色器里直接按显示色混合，所以把十六进制色转回 sRGB 数值再传进去。 */
export function displayColor(hex) {
  return new THREE.Color(hex).convertLinearToSRGB();
}

/** 所有雪面共用同一个时间与光照，云影才对得上。昼夜和天气只改这里的值。 */
export const snowUniforms = {
  uTime: { value: 0 },
  uLight: { value: new THREE.Vector3(-0.45, 0.72, 0.52).normalize() },
  uFog: { value: displayColor(SKY.fog) },
  uFogNear: { value: 1200 },
  uFogFar: { value: 18000 },
  // 受光面和背光面各乘一个颜色：白天都是白，黄昏偏暖，夜里偏蓝
  uSunTint: { value: new THREE.Color(1, 1, 1) },
  uShadeTint: { value: new THREE.Color(1, 1, 1) },
  // 阴天或天光交替时没有明确的受光方向，把明暗压平
  uFlat: { value: 0 },
  uCloudShadow: { value: 1 },
};

/** 天空共用的一组值：云量、星星、日月的位置。 */
export const skyUniforms = {
  uTime: snowUniforms.uTime,
  uZenith: { value: displayColor(SKY.zenith) },
  uHorizon: { value: displayColor(SKY.horizon) },
  uCloud: { value: new THREE.Color(0.98, 0.985, 0.97) },
  uCover: { value: 0 },
  uStars: { value: 0 },
  uSunDir: { value: snowUniforms.uLight.value.clone() },
  uSunColor: { value: new THREE.Color(1, 0.96, 0.86) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uGlow: { value: 1 },
  // 把视线方向转到星空自己的坐标系里（z 轴指向北天极），星空跟着时间绕北天极转
  uSkyTurn: { value: new THREE.Matrix3() },
};

/**
 * 几层星星，从又密又暗到又稀又亮。scale：把天球切成多细的格子；density：多大比例的格子里有星；
 * size：星的半径（格）；gain：亮度；crowd：银河正中再多出多大比例。第一层只在银河里有，是银河里的星尘。
 */
const STAR_LAYERS = [
  { scale: 230, density: 0, size: 0.12, gain: 1.2, crowd: 0.24 },
  { scale: 150, density: 0.12, size: 0.14, gain: 1.7, crowd: 0.15 },
  { scale: 80, density: 0.07, size: 0.17, gain: 2.2, crowd: 0.03 },
  { scale: 36, density: 0.06, size: 0.16, gain: 2.8, crowd: 0 },
];
/** 星星在格子里偏离中心的幅度：太小看得出是排在格子上的，太大会被格子边切掉一块。 */
const STAR_JITTER = 0.6;
/** 星星再小也画这么多像素宽，不然镜头一动就一闪一闪地丢。 */
const STAR_MIN_PIXELS = 1.1;
/** 银河：亮带的半宽（弧度）和亮度。 */
const GALAXY = { width: 0.17, glow: 0.42 };
/** 流星：每隔 every 秒有 chance 的机会划一颗，持续 lasts 秒，划过 path 弧度，尾巴长 tail 弧度。 */
const METEOR = { every: 6, chance: 0.6, lasts: 0.9, path: 0.42, tail: 0.16, width: 0.0022 };
/** 月亮圆盘的角半径（弧度）。比真的大好几倍，远看才是个月亮而不是一个点。 */
const MOON_RADIUS = 0.036;

const glsl = (value) => value.toFixed(4);
const starLayerCalls = STAR_LAYERS.map(
  ({ scale, density, size, gain, crowd }, i) =>
    `light += starLayer(sky * ${glsl(scale)} + ${glsl(i * 37)}, pixel * ${glsl(scale)}, ${glsl(density)} + ${glsl(crowd)} * galaxy.a, ${glsl(size)}) * ${glsl(gain)};`,
).join('\n        ');

/** 夜空：星星、银河、流星。用到 uTime、uSkyTurn 和 NOISE 里的噪声函数。 */
const NIGHT_SKY = `
  float hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  // 一层星星：p 落在哪个小格里，那一格有没有星、偏在哪、多亮、什么颜色都由格子编号定。
  // pixel 是一个像素有多少格宽
  vec3 starLayer(vec3 p, float pixel, float density, float size) {
    vec3 cell = floor(p);
    float pick = hash31(cell);
    if (pick >= density) return vec3(0.0);
    vec3 jitter = vec3(hash31(cell + 11.7), hash31(cell + 47.3), hash31(cell + 83.1)) - 0.5;
    float away = length(p - cell - 0.5 - jitter * ${glsl(STAR_JITTER)});
    // 亮星少、暗星多
    float rank = pick / density;
    float bright = mix(0.45, 1.0, rank * rank);
    float radius = size * (0.55 + 0.45 * bright);
    // 比一个像素还小的星画成一个像素、相应变暗，而不是时有时无
    float drawn = max(radius, pixel * ${glsl(STAR_MIN_PIXELS)});
    float core = smoothstep(drawn, 0.0, away);
    float twinkle = 0.78 + 0.22 * sin(uTime * (1.5 + 3.0 * (jitter.x + 0.5)) + pick * 700.0);
    // 大多数偏蓝白，少数偏暖黄
    vec3 tint = mix(vec3(0.78, 0.87, 1.0), vec3(1.0, 0.86, 0.68), smoothstep(0.55, 0.95, jitter.y + 0.5));
    // 中心一个亮点，外面一小圈柔光
    return tint * (core * core + 0.35 * core) * bright * twinkle * sqrt(radius / drawn);
  }

  // 银河：斜跨天球的一条亮带，星云明暗不匀，中间有几道暗的尘埃带。
  // sky 是星空坐标系里的方向。返回 (颜色, 离亮带中心有多近)
  vec4 milkyWay(vec3 sky) {
    // 银河面的法线离北天极 63 度；经度从亮带最靠北的一点量起，接缝正好落在永远升不上来的那一头
    float lat = dot(sky, vec3(0.891, 0.0, 0.454));
    float lon = atan(-sky.y, dot(sky, vec3(-0.454, 0.0, 0.891)));
    vec2 q = vec2(lon, lat);
    // 大块的明暗定亮带的宽窄，小团的星云让它不是均匀的一条
    float bulge = fbm(q * vec2(2.0, 3.0) + 3.0);
    float clumps = fbm(q * 9.0 + 11.0);
    float width = ${glsl(GALAXY.width)} * (0.6 + 0.8 * bulge);
    float band = exp(-lat * lat / (width * width));
    // 沿着亮带中间弯弯曲曲、断断续续的一道暗尘埃
    float rift = lat - (fbm(vec2(lon * 2.5, 7.0)) - 0.5) * 0.14;
    float dust = exp(-rift * rift / 0.0014) * smoothstep(0.3, 0.55, fbm(q * vec2(5.0, 12.0) + 9.0));
    float glow = band * (0.35 + 0.65 * bulge) * (0.5 + clumps) * (1.0 - 0.65 * dust);
    // 边上偏蓝紫，越往中间越偏暖白
    vec3 tint = mix(vec3(0.44, 0.46, 0.95), vec3(1.0, 0.86, 0.80), band * bulge);
    return vec4(tint * glow * ${glsl(GALAXY.glow)}, band * (1.0 - 0.6 * dust));
  }

  // 流星：隔一阵从天上随机一点斜着往下划，头亮、尾巴渐细渐暗。pixel 是一个像素的角宽度
  float meteor(vec3 dir, float pixel) {
    float slot = floor(uTime / ${glsl(METEOR.every)});
    float life = (uTime - slot * ${glsl(METEOR.every)}) / ${glsl(METEOR.lasts)};
    if (life > 1.0 || hash21(vec2(slot, 3.7)) > ${glsl(METEOR.chance)}) return 0.0;
    float around = hash21(vec2(slot, 1.3)) * 6.2832;
    float lift = mix(0.35, 0.95, hash21(vec2(slot, 7.9)));
    vec3 from = vec3(cos(around) * cos(lift), sin(lift), sin(around) * cos(lift));
    vec3 side = normalize(cross(from, vec3(0.0, 1.0, 0.0)));
    vec3 travel = normalize(cross(from, side) + side * (hash21(vec2(slot, 5.1)) - 0.5) * 1.6);
    vec3 head = normalize(from + travel * ${glsl(METEOR.path)} * life);
    // 都摊到流星头所在的切面上量：直接在球面上量的话，离头稍远一点就偏出这条线了
    vec3 heading = normalize(travel - head * dot(travel, head));
    vec3 rel = dir - head;
    rel -= head * dot(rel, head);
    float behind = -dot(rel, heading);
    float across = length(rel + heading * behind);
    float tail = step(0.0, behind) * step(0.0, dot(dir, head)) * (1.0 - smoothstep(0.0, ${glsl(METEOR.tail)}, behind));
    float line = 1.0 - smoothstep(0.0, max(${glsl(METEOR.width)} * tail, pixel), across);
    float fade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.6, 1.0, life));
    return tail * tail * line * fade;
  }

  vec3 nightSky(vec3 dir, float pixel) {
    vec3 sky = uSkyTurn * dir;
    vec4 galaxy = milkyWay(sky);
    vec3 light = galaxy.rgb;
    ${starLayerCalls}
    return light + vec3(0.85, 0.92, 1.0) * meteor(dir, pixel);
  }
`;

/** 太阳和月亮。用到 uSunDir、uSunColor、uMoonDir 和 NOISE。 */
const SUN_AND_MOON = `
  // 太阳：圆盘 + 一圈光晕
  vec3 sunDisc(vec3 dir) {
    float s = max(dot(dir, uSunDir), 0.0);
    return uSunColor * (smoothstep(0.9990, 0.9994, s) + pow(s, 90.0) * 0.45 + pow(s, 10.0) * 0.12);
  }

  // 月亮周围的一圈冷光
  vec3 moonHalo(vec3 dir) {
    float m = max(dot(dir, uMoonDir), 0.0);
    return vec3(0.72, 0.80, 1.0) * (pow(m, 220.0) * 0.26 + pow(m, 24.0) * 0.07);
  }

  // 月面：带几块月海暗斑的圆盘，边缘略暗。返回 (颜色, 圆盘盖住几成)
  vec4 moonFace(vec3 dir) {
    if (dot(dir, uMoonDir) < 0.9) return vec4(0.0);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir) + vec3(1e-5, 0.0, 0.0));
    vec3 top = cross(uMoonDir, right);
    vec2 q = vec2(dot(dir, right), dot(dir, top)) / ${glsl(MOON_RADIUS)};
    float r = length(q);
    float seas = smoothstep(0.42, 0.68, fbm(q * 1.6 + 4.0));
    vec3 face = mix(vec3(0.98, 0.97, 0.92), vec3(0.66, 0.72, 0.84), seas * 0.8) * (1.0 - 0.2 * r * r);
    return vec4(face, 1.0 - smoothstep(0.92, 1.0, r));
  }
`;

/**
 * 雪面着色：暖白受光、冷蓝背光、陡坡露岩、云影缓慢移动；
 * 有 mask 时在压雪道上画沿雪道方向的压纹。
 */
export function createSnowMaterial({ mask = null, lateral = null, edgeRamp = 1, worldSize = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...snowUniforms,
      uMask: { value: mask },
      uLateral: { value: lateral },
      uUseMask: { value: mask ? 1 : 0 },
      uEdgeRamp: { value: edgeRamp },
      uWorld: { value: worldSize },
    },
    vertexShader: `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      varying vec3 vNormal;
      uniform sampler2D uMask;
      uniform sampler2D uLateral;
      uniform float uUseMask;
      uniform float uWorld;
      uniform float uEdgeRamp;
      ${NOISE}
      ${SNOW_SHADING}
      ${GROOMING}

      void main() {
        vec3 n = normalize(vNormal);
        float tone = snowTone(n);
        vec3 snow = looseSnow(tone);

        float ragged = (fbm(vWorld.xz * 0.018) - 0.5) * 0.16;
        float steep = smoothstep(0.80, 0.68, n.y + ragged);
        vec3 rock = mix(vec3(0.40, 0.36, 0.35), vec3(0.60, 0.54, 0.49), fbm(vWorld.xz * 0.11));
        rock *= 0.72 + 0.4 * tone;
        vec3 color = mix(snow, rock, steep * 0.92);

        float dist = distance(vWorld, cameraPosition);
        if (uUseMask > 0.5) {
          vec2 uv = vWorld.xz / uWorld;
          vec4 m = texture2D(uMask, uv);
          vec3 groom = groomAt(uv);
          // 到雪道边线的距离（米），里面为正；边线带一点毛边，不是刀切的一条线
          float inside = (m.r * 2.0 - 1.0) * uEdgeRamp + (valueNoise(vWorld.xz * 0.9) - 0.5) * 0.3;
          float edgeBlur = max(0.1, fwidth(inside));
          float groomed = smoothstep(-edgeBlur, edgeBlur, inside);
          float wild = smoothstep(0.3, 0.7, m.b);

          color = mix(color, groomedSnow(groom, tone), groomed);
          color = mix(color, snow * 1.02, wild * 0.85);
          color = pisteEdge(color, m.r, inside, edgeBlur, dist);
        }

        gl_FragColor = vec4(snowAir(color, tone), 1.0);
      }
    `,
  });
}

/** 渐变天空 + 缓慢流动的云，太阳和月亮；夜里有星星、银河和流星。 */
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 pos = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = pos.xyww;
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform float uTime;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uCloud;
      uniform float uCover;
      uniform float uStars;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uMoonDir;
      uniform float uGlow;
      uniform mat3 uSkyTurn;
      ${NOISE}
      ${NIGHT_SKY}
      ${SUN_AND_MOON}

      void main() {
        vec3 dir = normalize(vDir);
        // 一个像素大约多少弧度宽；要在所有分支外面求
        float pixel = length(fwidth(dir)) * 0.7;
        float up = clamp(dir.y, 0.0, 1.0);
        vec3 color = mix(uHorizon, uZenith, pow(up, 0.55));
        // 贴着地平线的一小段空气厚，星光淡下去；滑行时镜头里看到的正是低处这片天，不能淡得太高
        if (uStars > 0.01) color += nightSky(dir, pixel) * uStars * smoothstep(-0.01, 0.1, dir.y);
        color += (sunDisc(dir) + moonHalo(dir)) * uGlow;
        vec4 moon = moonFace(dir);
        color = mix(color, moon.rgb, moon.a * uGlow);
        // 把方向投到高空平面上取噪声，云在地平线附近自然压扁；云量越大门槛越低
        vec2 plane = dir.xz / max(dir.y + 0.12, 0.05);
        float cloud = fbm(plane * 0.55 + vec2(uTime * 0.008, uTime * 0.004));
        float body = smoothstep(mix(0.50, 0.12, uCover), mix(0.72, 0.42, uCover), cloud) * smoothstep(0.0, 0.18, dir.y);
        color = mix(color, uCloud, body * mix(0.85, 1.0, uCover));
        color = mix(color, uHorizon, smoothstep(0.06, -0.04, dir.y));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  sky.name = 'Sky';
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}
