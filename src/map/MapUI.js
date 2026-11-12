import { DIFFICULTY, pisteTitle } from '../world/Pistes.js';
import { planRoute } from './route.js';

const RELIEF_SIZE = 1024;
const CONTOUR_STEP = 100;
const TREELINE = 2280;
const MINI_RANGE = 520; // 小地图半径对应的米数
const MINI_INTERVAL = 0.08;
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 14;
const PICK_RADIUS = 16; // 像素
const INK = '#27313d';
const LIFT_COLOR = '#4b5661';
const ROUTE_COLOR = '#e2603a';

/**
 * 小地图与大地图。北朝上：画布 x = 世界 x，画布 y = 世界 z。
 * view = { cx, cz, scale }，scale 是每米多少像素。
 */
export class MapUI {
  constructor(world, terrain) {
    this.world = world;
    this.terrain = terrain;
    this.size = terrain.worldSize;
    this.destination = null;
    this.route = null;
    this.open = false;
    this.onToggle = null;
    this.mini = document.getElementById('minimap');
    this.full = document.getElementById('map-canvas');
    this.modal = document.getElementById('map-modal');
    this.info = document.getElementById('map-info');
    this.clearButton = document.getElementById('map-clear');
    this.zoom = 1;
    this.center = { x: this.size / 2, z: this.size / 2 };
    this.drag = null;
    this.motor = null;
    this.miniClock = 0;
    this.relief = this.paintRelief();
    for (const piste of world.pistes) piste.box = bounds(piste.points);
    this.bind();
    this.paintLegend();
  }

  bind() {
    this.mini.addEventListener('click', () => this.setOpen(true));
    document.getElementById('map-close').addEventListener('click', () => this.setOpen(false));
    this.clearButton.addEventListener('click', () => this.setDestination(null));
    document.getElementById('zoom-in').addEventListener('click', () => this.zoomBy(1.4));
    document.getElementById('zoom-out').addEventListener('click', () => this.zoomBy(1 / 1.4));
    this.full.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, center: { ...this.center }, moved: false };
      this.full.setPointerCapture(e.pointerId);
    });
    this.full.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
      if (!this.drag.moved) return;
      const scale = this.fullView().scale / this.pixelRatio();
      this.center.x = this.drag.center.x - dx / scale;
      this.center.z = this.drag.center.z - dy / scale;
      this.draw();
    });
    this.full.addEventListener('pointerup', (e) => {
      if (!this.drag) return;
      const moved = this.drag.moved;
      this.drag = null;
      if (!moved) this.pick(e);
    });
    this.full.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY > 0 ? 1 / 1.2 : 1.2, e);
    }, { passive: false });
    addEventListener('resize', () => this.open && this.draw());
  }

  pixelRatio() {
    return Math.min(devicePixelRatio || 1, 2);
  }

  /** 山体底图：坡向阴影 + 林线以下偏绿 + 等高线。 */
  paintRelief() {
    const n = RELIEF_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(n, n);
    const step = this.size / n;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = this.terrain.heightAt((i + 0.5) * step, (j + 0.5) * step);
    }
    const at = (i, j) => heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = at(i, j);
        // 光从西北来
        const slopeX = (at(i + 1, j) - at(i - 1, j)) / (2 * step);
        const slopeZ = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
        const shade = Math.min(1, Math.max(0, 0.72 + (slopeX + slopeZ) * 0.42));
        const forest = Math.min(1, Math.max(0, (TREELINE - h) / 260)) * 0.5;
        const r = 250 - forest * 62;
        const g = 251 - forest * 30;
        const b = 252 - forest * 50;
        const contour = Math.floor(h / CONTOUR_STEP) !== Math.floor(at(i + 1, j) / CONTOUR_STEP)
          || Math.floor(h / CONTOUR_STEP) !== Math.floor(at(i, j + 1) / CONTOUR_STEP);
        const light = (0.62 + 0.38 * shade) * (contour ? 0.9 : 1);
        const o = (j * n + i) * 4;
        img.data[o] = r * light;
        img.data[o + 1] = g * light;
        img.data[o + 2] = Math.min(255, b * (light + 0.04));
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  paintLegend() {
    const list = document.getElementById('map-legend');
    for (const level of Object.values(DIFFICULTY)) {
      const item = document.createElement('li');
      item.innerHTML = `<i style="background:${level.color}"></i>${level.label}`;
      list.append(item);
    }
    const lift = document.createElement('li');
    lift.innerHTML = '<i class="dash"></i>索道';
    list.append(lift);
  }

  setOpen(open) {
    if (this.open === open) return;
    this.open = open;
    this.modal.classList.toggle('show', open);
    if (open) {
      if (this.motor) this.center = { x: this.motor.x, z: this.motor.z };
      this.zoom = 2.2;
      this.draw();
    }
    this.onToggle?.(open);
  }

  setDestination(dest) {
    this.destination = dest;
    this.route = null;
    this.refreshRoute();
    this.clearButton.disabled = !dest;
    this.info.textContent = dest
      ? `目的地：${dest.name} · 海拔 ${Math.round(dest.h)} m${this.route?.via ? ` · ${this.route.hint}` : ''}`
      : '点一下地图上的位置设为目的地，滚轮缩放，拖动平移。';
    if (this.open) this.draw();
  }

  refreshRoute() {
    if (!this.destination || !this.motor) {
      this.route = null;
      return;
    }
    const from = { x: this.motor.x, z: this.motor.z, h: this.terrain.heightAt(this.motor.x, this.motor.z) };
    this.route = planRoute(this.world, from, this.destination);
    this.route.distance = Math.hypot(this.destination.x - from.x, this.destination.z - from.z);
  }

  /** 每帧调用：刷新路线，小地图按固定间隔重画。 */
  update(motor, dt) {
    this.motor = motor;
    this.miniClock -= dt;
    if (this.miniClock > 0) return;
    this.miniClock = MINI_INTERVAL;
    this.refreshRoute();
    if (this.route && this.route.distance < 30) this.setDestination(null);
    this.drawMini();
  }

  drawMini() {
    const canvas = this.mini;
    const ctx = canvas.getContext('2d');
    const view = { cx: this.motor.x, cz: this.motor.z, scale: canvas.width / (MINI_RANGE * 2), w: canvas.width, h: canvas.height };
    ctx.clearRect(0, 0, view.w, view.h);
    this.paint(ctx, view, { labels: false, unit: canvas.width / 176 });
  }

  fullView() {
    const canvas = this.full;
    const fit = Math.min(canvas.width, canvas.height) / this.size;
    return { cx: this.center.x, cz: this.center.z, scale: fit * this.zoom, w: canvas.width, h: canvas.height };
  }

  draw() {
    const canvas = this.full;
    const ratio = this.pixelRatio();
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const half = this.size / 2 / this.zoom;
    this.center.x = clamp(this.center.x, Math.min(half, this.size / 2), Math.max(this.size - half, this.size / 2));
    this.center.z = clamp(this.center.z, Math.min(half, this.size / 2), Math.max(this.size - half, this.size / 2));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#dfe8ec';
    ctx.fillRect(0, 0, width, height);
    this.paint(ctx, this.fullView(), { labels: true, unit: ratio });
  }

  zoomBy(factor, event) {
    const before = event ? this.toWorld(event) : null;
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (before) {
      // 以光标所在位置为中心缩放
      const after = this.toWorld(event);
      this.center.x += before.x - after.x;
      this.center.z += before.z - after.z;
    }
    this.draw();
  }

  toWorld(event) {
    const rect = this.full.getBoundingClientRect();
    const view = this.fullView();
    const ratio = this.full.width / rect.width;
    return {
      x: view.cx + ((event.clientX - rect.left) * ratio - view.w / 2) / view.scale,
      z: view.cz + ((event.clientY - rect.top) * ratio - view.h / 2) / view.scale,
    };
  }

  pick(event) {
    const at = this.toWorld(event);
    if (at.x < 0 || at.z < 0 || at.x > this.size || at.z > this.size) return;
    const reach = (PICK_RADIUS * this.pixelRatio()) / this.fullView().scale;
    let best = null;
    for (const poi of this.world.pois) {
      const d = Math.hypot(poi.x - at.x, poi.z - at.z);
      if (d < reach && (!best || d < best.d)) best = { poi, d };
    }
    if (best) {
      this.setDestination(best.poi);
      return;
    }
    const hit = this.world.pistes.find((p) => inBox(p.box, at, p.width) && nearLine(p.points, at, p.width / 2 + reach * 0.5));
    this.setDestination({
      id: 'pin',
      name: hit ? pisteTitle(hit) : '地图标记',
      x: at.x,
      z: at.z,
      h: this.terrain.heightAt(at.x, at.z),
    });
  }

  /** 把地图画进任意画布。unit 是 1 个 CSS 像素对应的画布像素。 */
  paint(ctx, view, { labels, unit }) {
    const px = (x) => (x - view.cx) * view.scale + view.w / 2;
    const py = (z) => (z - view.cz) * view.scale + view.h / 2;
    const visible = (box, pad) => box.maxX + pad > view.cx - view.w / 2 / view.scale
      && box.minX - pad < view.cx + view.w / 2 / view.scale
      && box.maxZ + pad > view.cz - view.h / 2 / view.scale
      && box.minZ - pad < view.cz + view.h / 2 / view.scale;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.relief, px(0), py(0), this.size * view.scale, this.size * view.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 雪道：先铺一层白底，再画难度色的中线
    const shown = this.world.pistes.filter((p) => visible(p.box, p.width));
    const trace = (points) => {
      ctx.beginPath();
      points.forEach(([x, z], i) => (i ? ctx.lineTo(px(x), py(z)) : ctx.moveTo(px(x), py(z))));
    };
    for (const piste of shown) {
      if (!piste.groomed) continue;
      trace(piste.points);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(3.5 * unit, piste.width * view.scale);
      ctx.stroke();
    }
    for (const piste of shown) {
      trace(piste.points);
      ctx.strokeStyle = DIFFICULTY[piste.difficulty].color;
      ctx.lineWidth = Math.max(1.6 * unit, Math.min(4 * unit, piste.width * view.scale * 0.3));
      ctx.setLineDash(piste.groomed ? [] : [5 * unit, 4 * unit]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const lift of this.world.lifts) {
      ctx.beginPath();
      ctx.moveTo(px(lift.bottom.x), py(lift.bottom.z));
      ctx.lineTo(px(lift.top.x), py(lift.top.z));
      ctx.strokeStyle = LIFT_COLOR;
      ctx.lineWidth = 1.8 * unit;
      ctx.setLineDash([7 * unit, 4 * unit]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const end of [lift.bottom, lift.top]) {
        ctx.beginPath();
        ctx.rect(px(end.x) - 3 * unit, py(end.z) - 3 * unit, 6 * unit, 6 * unit);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = LIFT_COLOR;
        ctx.lineWidth = 1.6 * unit;
        ctx.stroke();
      }
    }

    if (labels) this.paintLabels(ctx, view, px, py, shown, unit);
    if (this.route && this.destination) this.paintRoute(ctx, px, py, unit);
    if (this.motor) this.paintPlayer(ctx, px(this.motor.x), py(this.motor.z), unit);
  }

  paintLabels(ctx, view, px, py, shown, unit) {
    const text = (label, x, y, size, color = INK) => {
      ctx.font = `600 ${size * unit}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5 * unit;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);
    };
    const detail = view.scale / unit; // 每米多少 CSS 像素
    if (detail > 0.16) {
      for (const piste of shown) {
        if (piste.length * detail < 90) continue;
        const [x, z] = piste.points[Math.floor(piste.points.length / 2)];
        text(detail > 0.3 ? pisteTitle(piste) : piste.ref || piste.name, px(x), py(z), 11, DIFFICULTY[piste.difficulty].color);
      }
    }
    for (const lift of this.world.lifts) {
      if (lift.length * detail < 70) continue;
      text(lift.name, px((lift.bottom.x + lift.top.x) / 2), py((lift.bottom.z + lift.top.z) / 2) - 9 * unit, 11, LIFT_COLOR);
    }
    for (const poi of this.world.pois) {
      if (poi.kind === 'station') continue;
      const x = px(poi.x);
      const y = py(poi.z);
      ctx.beginPath();
      if (poi.kind === 'peak') {
        ctx.moveTo(x, y - 7 * unit);
        ctx.lineTo(x + 6 * unit, y + 4 * unit);
        ctx.lineTo(x - 6 * unit, y + 4 * unit);
        ctx.closePath();
      } else {
        ctx.arc(x, y, 5 * unit, 0, Math.PI * 2);
      }
      ctx.fillStyle = INK;
      ctx.fill();
      text(`${poi.name} ${Math.round(poi.h)} m`, x, y + 16 * unit, 12);
    }
  }

  paintRoute(ctx, px, py, unit) {
    const dest = this.destination;
    ctx.beginPath();
    this.route.points.forEach((p, i) => (i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z))));
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = 2.2 * unit;
    ctx.setLineDash([3 * unit, 5 * unit]);
    ctx.stroke();
    ctx.setLineDash([]);
    const x = px(dest.x);
    const y = py(dest.z);
    ctx.beginPath();
    ctx.arc(x, y - 9 * unit, 6 * unit, Math.PI * 0.85, Math.PI * 0.15);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = ROUTE_COLOR;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - 9 * unit, 2.2 * unit, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  paintPlayer(ctx, x, y, unit) {
    const yaw = this.motor.yaw;
    ctx.save();
    ctx.translate(x, y);
    // 前进方向 (sin yaw, cos yaw) 在画布上就是 (x, y)
    ctx.rotate(Math.atan2(Math.cos(yaw), Math.sin(yaw)) + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -9 * unit);
    ctx.lineTo(6.5 * unit, 7 * unit);
    ctx.lineTo(0, 3.5 * unit);
    ctx.lineTo(-6.5 * unit, 7 * unit);
    ctx.closePath();
    ctx.fillStyle = ROUTE_COLOR;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * unit;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function bounds(points) {
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const [x, z] of points) {
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minZ = Math.min(box.minZ, z);
    box.maxZ = Math.max(box.maxZ, z);
  }
  return box;
}

function inBox(box, at, pad) {
  return at.x > box.minX - pad && at.x < box.maxX + pad && at.z > box.minZ - pad && at.z < box.maxZ + pad;
}

function nearLine(points, at, reach) {
  return points.some(([x, z]) => Math.hypot(x - at.x, z - at.z) < reach);
}
