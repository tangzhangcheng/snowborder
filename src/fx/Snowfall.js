import * as THREE from 'three';

const FLAKES = 18000;
/** 雪花只铺在镜头周围这么大的一个方盒里（米），出了盒子从另一头绕回来。 */
const BOX = 32;
/** 雪花落下的速度、风最大时横着飘的速度（米/秒）。 */
const FALL_SPEED = 1.7;
const WIND_SPEED = 7;
/** 风往哪边吹（水平方向，单位向量）。 */
const WIND_DIR = new THREE.Vector2(0.8, 0.6);
/** 一片雪花的直径（米），以及画到屏幕上最小、最大多少像素。 */
const FLAKE_SIZE = 0.055;
const PIXELS = [1.5, 16];

/**
 * 飘雪：一盒跟着镜头走的点。位置在顶点着色器里按盒子取模，
 * 所以镜头怎么动雪花都留在原地，不会跟着镜头平移。
 */
export class Snowfall {
  constructor() {
    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(FLAKES * 3).map(() => Math.random());
    const ranks = new Float32Array(FLAKES).map(() => Math.random());
    geo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
    this.uniforms = {
      uCenter: { value: new THREE.Vector3() },
      uDrift: { value: new THREE.Vector3() },
      uDensity: { value: 0 },
      uScale: { value: 1 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(1, 1, 1) },
    };
    this.points = new THREE.Points(geo, this.material());
    this.points.name = 'Snowfall';
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
  }

  material() {
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aRank;
        uniform vec3 uCenter;
        uniform vec3 uDrift;
        uniform float uDensity;
        uniform float uScale;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          // 先算出雪花在世界里的位置，再按盒子取模折回镜头周围
          vec3 local = mod(position * ${BOX.toFixed(1)} + uDrift - uCenter, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          local.x += sin(uTime * 1.3 + aRank * 40.0) * 0.25;
          vec4 view = viewMatrix * vec4(uCenter + local, 1.0);
          gl_Position = projectionMatrix * view;
          float dist = length(local);
          // 排名靠后的雪花只有雪下大了才出现；盒子边上的淡出，免得看见一堵墙
          float shown = step(aRank, uDensity);
          vAlpha = shown * smoothstep(${(BOX / 2).toFixed(1)}, ${(BOX * 0.38).toFixed(1)}, dist) * (0.55 + 0.45 * fract(aRank * 7.0));
          gl_PointSize = shown * clamp(uScale * ${FLAKE_SIZE} / max(-view.z, 0.1), ${PIXELS[0].toFixed(1)}, ${PIXELS[1].toFixed(1)});
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float soft = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5));
          if (soft * vAlpha < 0.01) discard;
          gl_FragColor = vec4(uColor, soft * vAlpha);
        }
      `,
    });
  }

  /**
   * @param {number} dt
   * @param {THREE.PerspectiveCamera} camera 正在用的那台镜头
   * @param {{snow: number, wind: number}} weather 此刻的天气数值
   * @param {THREE.Color} tint 天光颜色（显示色），夜里雪花也要暗下来
   * @param {number} viewHeight 画布高度（像素）
   */
  update(dt, camera, weather, tint, viewHeight) {
    const u = this.uniforms;
    u.uDensity.value = weather.snow;
    this.points.visible = weather.snow > 0.005;
    if (!this.points.visible) return;
    u.uTime.value += dt;
    u.uCenter.value.copy(camera.position);
    u.uColor.value.copy(tint);
    // 一米在一米远处占多少像素，用来把雪花的大小换算成像素
    u.uScale.value = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const wind = weather.wind * WIND_SPEED * dt;
    const drift = u.uDrift.value;
    drift.x = wrap(drift.x + WIND_DIR.x * wind);
    drift.y = wrap(drift.y - FALL_SPEED * dt);
    drift.z = wrap(drift.z + WIND_DIR.y * wind);
  }
}

/** 飘移量只在一个盒子的范围里打转，数值不会越滚越大。 */
function wrap(value) {
  return ((value % BOX) + BOX) % BOX;
}
