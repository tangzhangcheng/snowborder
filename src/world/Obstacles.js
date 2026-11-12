const CELL = 32;

/**
 * 场景里撞得到的东西：树干、塔柱是圆，站房、木屋是带朝向的矩形。
 * 按网格分桶，查询时只看脚下附近几格。
 */
export class Obstacles {
  constructor() {
    this.cells = new Map();
    this.count = 0;
  }

  /** 圆柱形障碍：圆心、半径、离地高度（跳得比它高就能飞过去）。 */
  addCircle(x, z, radius, height) {
    this.insert({ x, z, radius, height, reach: radius });
  }

  /** 矩形障碍：中心、半宽（局部 x）、半深（局部 z）、绕竖轴的朝向。 */
  addBox(x, z, halfWidth, halfDepth, yaw, height) {
    const box = { x, z, halfWidth, halfDepth, cos: Math.cos(yaw), sin: Math.sin(yaw), height };
    this.insert({ ...box, reach: Math.hypot(halfWidth, halfDepth) });
  }

  insert(item) {
    this.count++;
    const x0 = Math.floor((item.x - item.reach) / CELL);
    const x1 = Math.floor((item.x + item.reach) / CELL);
    const z0 = Math.floor((item.z - item.reach) / CELL);
    const z1 = Math.floor((item.z + item.reach) / CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = cx + cz * 4096;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(item);
      }
    }
  }

  /**
   * 半径 radius 的圆放在 (x, z)、离地 above 米时压进了哪个障碍。
   * 返回压得最深的那个：{ nx, nz, depth }，法线指向障碍外侧；没碰到返回 null。
   */
  hit(x, z, radius, above = 0) {
    let best = null;
    const x0 = Math.floor((x - radius) / CELL);
    const x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL);
    const z1 = Math.floor((z + radius) / CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const item of this.cells.get(cx + cz * 4096) ?? []) {
          if (above > item.height) continue;
          const contact = item.radius ? circleContact(item, x, z, radius) : boxContact(item, x, z, radius);
          if (contact && (!best || contact.depth > best.depth)) best = contact;
        }
      }
    }
    return best;
  }
}

function circleContact(item, x, z, radius) {
  const dx = x - item.x;
  const dz = z - item.z;
  const dist = Math.hypot(dx, dz);
  const depth = item.radius + radius - dist;
  if (depth <= 0) return null;
  // 正好站在圆心上时随便挑个方向推出去
  if (dist < 1e-6) return { nx: 1, nz: 0, depth };
  return { nx: dx / dist, nz: dz / dist, depth };
}

function boxContact(item, x, z, radius) {
  // 转到矩形自己的坐标里：局部 x 沿宽、局部 z 沿深
  const dx = x - item.x;
  const dz = z - item.z;
  const lx = dx * item.cos - dz * item.sin;
  const lz = dx * item.sin + dz * item.cos;
  const cx = Math.max(-item.halfWidth, Math.min(item.halfWidth, lx));
  const cz = Math.max(-item.halfDepth, Math.min(item.halfDepth, lz));
  let nx = lx - cx;
  let nz = lz - cz;
  let depth;
  const dist = Math.hypot(nx, nz);
  if (dist > 1e-6) {
    depth = radius - dist;
    if (depth <= 0) return null;
    nx /= dist;
    nz /= dist;
  } else {
    // 圆心已经在矩形里面：从最近的那面墙推出去
    const gapX = item.halfWidth - Math.abs(lx);
    const gapZ = item.halfDepth - Math.abs(lz);
    nx = gapX < gapZ ? Math.sign(lx) || 1 : 0;
    nz = gapX < gapZ ? 0 : Math.sign(lz) || 1;
    depth = Math.min(gapX, gapZ) + radius;
  }
  return { nx: nx * item.cos + nz * item.sin, nz: -nx * item.sin + nz * item.cos, depth };
}
