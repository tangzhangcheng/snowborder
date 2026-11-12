import * as THREE from 'three';

const GRADIENT = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ['#8791a3', '#c9d0da', '#ffffff', '#ffffff'].forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i, 0, 1, 1);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

export const INK = '#27313d';

export function toonMat(color, opts = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: GRADIENT,
    side: opts.side ?? THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
    map: opts.map ?? null,
  });
  if (opts.rim) addRimLight(mat, opts.rim);
  return mat;
}

/** 轮廓光跟着天光走：夜里天暗了，这一圈也要跟着暗下去，不然人像在发光。 */
export const rimLevel = { value: 1 };

/** 轮廓光：背对镜头的边缘提亮一圈冷色，角色从雪地背景里跳出来。 */
function addRimLight(mat, strength) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: strength };
    shader.uniforms.uRimLevel = rimLevel;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uRim;\nuniform float uRimLevel;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `float rimEdge = 1.0 - saturate(dot(normalize(vViewPosition), normal));
        outgoingLight += vec3(0.78, 0.9, 1.0) * smoothstep(0.6, 0.92, rimEdge) * uRim * uRimLevel;
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'toon-rim';
}

/** 背面外扩的描边材质：顶点沿法线推出去，只画背面。 */
const outlineMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    uColor: { value: new THREE.Color(INK).convertLinearToSRGB() },
    uWidth: { value: 0.014 },
  },
  vertexShader: `
    uniform float uWidth;
    void main() {
      vec3 pushed = position + normalize(normal) * uWidth;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pushed, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    void main() {
      gl_FragColor = vec4(uColor, 1.0);
    }
  `,
});

/** 给一个网格加一圈墨线描边（作为子节点，跟着一起动）。 */
export function addOutline(mesh) {
  const hull = new THREE.Mesh(mesh.geometry, outlineMat);
  hull.name = 'Outline';
  mesh.add(hull);
  return mesh;
}
