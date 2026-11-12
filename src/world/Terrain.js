import * as THREE from 'three';
import { readBinary } from './dataSource.js';

/**
 * uint16 小端高程网格，value / scale = 米。
 * 世界坐标：x 向东，z 向南；origin 是网格左上角的世界坐标（细节网格为 0，远景为负）。
 */
export class Terrain {
  constructor(buffer, meta) {
    this.w = meta.width;
    this.h = meta.height;
    this.worldSize = meta.worldSize;
    this.origin = meta.origin ?? 0;
    this.minH = meta.min;
    this.maxH = meta.max;
    this.cell = this.worldSize / (this.w - 1);
    this.samples = new Float32Array(this.w * this.h);
    const view = new DataView(buffer);
    for (let i = 0; i < this.samples.length; i++) {
      this.samples[i] = view.getUint16(i * 2, true) / meta.scale;
    }
  }

  static async load(meta) {
    return new Terrain(await readBinary(meta.file), meta);
  }

  hAt(ix, iz) {
    const x = Math.max(0, Math.min(this.w - 1, ix));
    const z = Math.max(0, Math.min(this.h - 1, iz));
    return this.samples[z * this.w + x];
  }

  heightAt(x, z) {
    const fx = THREE.MathUtils.clamp((x - this.origin) / this.cell, 0, this.w - 1);
    const fz = THREE.MathUtils.clamp((z - this.origin) / this.cell, 0, this.h - 1);
    const x0 = Math.min(this.w - 2, Math.floor(fx));
    const z0 = Math.min(this.h - 2, Math.floor(fz));
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = this.hAt(x0, z0);
    const h10 = this.hAt(x0 + 1, z0);
    const h01 = this.hAt(x0, z0 + 1);
    const h11 = this.hAt(x0 + 1, z0 + 1);
    // 与 PlaneGeometry 的三角剖分一致，脚下的高度就是看得见的坡面
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  /** 高度 + 平滑法线（中心差分跨一个网格，避免三角面折线带来的抖动）。 */
  sample(x, z) {
    const height = this.heightAt(x, z);
    const e = this.cell;
    const dhdx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dhdz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const normal = new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
    return { height, normal, slopeCos: normal.y, slope: Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1)) };
  }

  contains(x, z, inset = 0) {
    const max = this.origin + this.worldSize - inset;
    return x > this.origin + inset && z > this.origin + inset && x < max && z < max;
  }

  /**
   * 生成网格几何。sink(x, z) 返回要下沉的米数，用来把远景在细节地形范围内压到下面。
   */
  buildGeometry(sink = null) {
    const geo = new THREE.PlaneGeometry(this.worldSize, this.worldSize, this.w - 1, this.h - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const half = this.worldSize / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + half + this.origin;
      const z = pos.getZ(i) + half + this.origin;
      pos.setXYZ(i, x, this.heightAt(x, z), z);
    }
    // 法线按真实高度算，之后再下沉；否则下沉区边上的一圈会被当成陡坡染成岩石
    geo.computeVertexNormals();
    if (sink) {
      for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - sink(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}
