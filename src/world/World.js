import * as THREE from 'three';
import { Terrain } from './Terrain.js';
import { Pistes } from './Pistes.js';
import { Environment } from './Environment.js';
import { buildLodges, buildTrees } from './dressing.js';
import { buildBirches, buildRocks, buildShrubs } from './nature.js';
import { buildPisteProps } from './pisteProps.js';
import { buildVillage } from './village.js';
import { Balloons } from './Balloons.js';
import { readJson } from './dataSource.js';
import { createSky, createSnowMaterial, snowUniforms } from '../render/snowMaterial.js';

/** 远景在细节地形范围内下沉的米数，避免两层地形互相穿插。 */
const BACKDROP_SINK = 220;
/** 太阳的高度（方向向量的 y）从前者降到后者，夜场灯从全灭到全亮：天擦黑就开灯。 */
const LAMPS_ON = [0.14, -0.02];

/** 夜场灯此刻亮了几成（0–1）。 */
function lampGlow(environment) {
  return 1 - THREE.MathUtils.smoothstep(environment.sunDir.y, LAMPS_ON[1], LAMPS_ON[0]);
}

export async function loadWorld() {
  const world = await readJson('world.json');
  const [terrain, backdrop] = await Promise.all([Terrain.load(world.heightmap), Terrain.load(world.backdrop)]);
  return { world, terrain, backdrop, pistes: new Pistes(world) };
}

/**
 * 往场景里放山体、远山、天空、树、标志杆、山脚木屋和各种点缀，灯光和雾交给 Environment。
 * live 为 true 时时间和天气会自己走。返回 { environment, update(dt), setHaze }。
 */
export function buildLandscape(scene, { world, terrain, backdrop, pistes, obstacles = null, live = false }) {
  const environment = new Environment(scene, { live });

  const ground = new THREE.Mesh(
    terrain.buildGeometry(),
    createSnowMaterial({ ...pistes.buildTextures(), worldSize: terrain.worldSize }),
  );
  ground.name = 'Terrain';
  scene.add(ground);

  const inside = (v) => v > backdrop.cell * 0.5 && v < terrain.worldSize - backdrop.cell * 0.5;
  const far = new THREE.Mesh(
    backdrop.buildGeometry((x, z) => (inside(x) && inside(z) ? BACKDROP_SINK : 0)),
    createSnowMaterial(),
  );
  far.name = 'Backdrop';
  scene.add(far);

  scene.add(
    createSky(),
    pistes.buildPoles(terrain),
    buildTrees(terrain, pistes, world, obstacles),
    buildLodges(terrain, world, obstacles),
  );

  // 点缀：山上的石头、白桦和红柳，雪道边的牌子、造雪机和夜场灯，山脚的营地，天上的热气球
  const ctx = { terrain, pistes, world };
  const props = buildPisteProps(ctx, obstacles);
  const village = buildVillage(ctx, obstacles);
  const balloons = new Balloons(terrain);
  scene.add(buildRocks(ctx, obstacles), buildBirches(ctx, obstacles), buildShrubs(ctx), props.group, village.group, balloons.group);

  return {
    environment,
    update(dt) {
      snowUniforms.uTime.value += dt;
      environment.update(dt);
      props.setGlow(lampGlow(environment));
      village.update(snowUniforms.uTime.value);
      balloons.update(dt);
    },
    /** 调整雾的远近：沙盘视角离得远，要把雾推开才看得清。 */
    setHaze(near, far, weatherShare = 1) {
      environment.setHaze(near, far, weatherShare);
    },
  };
}
