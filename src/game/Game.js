import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLandscape, loadWorld } from '../world/World.js';
import { DIFFICULTY, pisteTitle } from '../world/Pistes.js';
import { Obstacles } from '../world/Obstacles.js';
import { SnowboardMotor } from '../player/SnowboardMotor.js';
import { Rider } from '../player/Rider.js';
import { SnowTrail } from '../trail/SnowTrail.js';
import { BlobShadow, SnowSpray } from '../fx/RiderFx.js';
import { Snowfall } from '../fx/Snowfall.js';
import { Sound } from '../audio/Sound.js';
import { LiftSystem } from '../lift/LiftSystem.js';
import { Vehicles } from '../vehicle/Vehicles.js';
import { RideCamera } from '../camera/RideCamera.js';
import { MapUI } from '../map/MapUI.js';
import { bindWorkshop } from '../ui/workshop.js';

const STEP = 1 / 120;
const MAX_STEPS = 8;
const MAX_CHARGE = 0.7;
const HUD_INTERVAL = 0.15;
const TOAST_SECONDS = 1.8;
/** 雾的近、远距离，以及天气对能见度的影响占几成：沙盘离得远，暴雪时也得看得见山。 */
const HAZE = { ride: [1200, 18000, 1], diorama: [9000, 70000, 0.15] };
const SURFACE_LABEL = { groomed: '压雪', powder: '粉雪', crust: '硬壳' };
const OFF_PISTE = { label: '野', color: '#9aa7b3', title: '野外' };
const MOUSE_LEFT = 0;
const MOUSE_RIGHT = 2;
/** 按一下 T 把时间往后拨几小时。 */
const TIME_SKIP_HOURS = 3;
/** 落地的冲击（米/秒）：低于 min 不出声，到 full 时最响。撞击同理。 */
const LAND_IMPACT = { min: 1.2, full: 9 };
const BUMP_FULL_SPEED = 6;
/** 进出这些状态时响一声机械的咔哒。 */
const MECHANICAL_MODES = ['lift', 'drive'];

const $ = (id) => document.getElementById(id);

export class Game {
  constructor() {
    this.phase = 'title';
    this.diorama = false;
    this.acc = 0;
    this.clock = 0;
    this.time = 0;
    this.hudClock = 0;
    this.toastClock = 0;
    this.keys = new Set();
    this.pointerEdge = 0;
    this.sound = new Sound();
    this.lastMode = 'ride';
  }

  async init() {
    const ctx = await loadWorld();
    this.world = ctx.world;
    this.terrain = ctx.terrain;
    this.pistes = ctx.pistes;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 45000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.prepend(this.renderer.domElement);

    this.obstacles = new Obstacles();
    this.landscape = buildLandscape(this.scene, { ...ctx, obstacles: this.obstacles, live: true });
    this.environment = this.landscape.environment;
    this.motor = new SnowboardMotor(this.terrain, this.pistes, this.world.spawn, this.world.bounds.inset, this.obstacles);
    this.rider = new Rider();
    this.trail = new SnowTrail();
    this.spray = new SnowSpray();
    this.shadow = new BlobShadow();
    this.lifts = new LiftSystem(this.world, this.terrain, this.obstacles);
    this.vehicles = new Vehicles(this.world, this.terrain, this.obstacles);
    this.snowfall = new Snowfall();
    this.scene.add(this.rider.root, this.trail.mesh, this.spray.mesh, this.shadow.mesh, this.lifts.group, this.vehicles.group, this.snowfall.points);
    // 雪雾不吃灯光，得跟着天光一起变暗（板痕和雪面用同一套着色，不用管）
    this.environment.follow(this.spray.mesh.material);

    this.rig = new RideCamera(this.camera);
    this.map = new MapUI(this.world, this.terrain);
    this.map.onToggle = () => this.keys.clear();
    $('map-credit').textContent = this.world.attribution;

    // 目的地方向箭头，飘在滑手头顶
    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.9, 4).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#e2603a' }),
    );
    this.arrow.visible = false;
    this.scene.add(this.arrow);

    this.overview = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 10, 60000);
    this.orbit = new OrbitControls(this.overview, this.renderer.domElement);
    this.orbit.enabled = false;
    this.orbit.maxPolarAngle = 1.35;
    this.orbit.minDistance = 600;
    this.orbit.maxDistance = 16000;
    this.beacon = new THREE.Mesh(
      new THREE.ConeGeometry(40, 130, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: '#e2603a', fog: false }),
    );
    this.beacon.visible = false;
    this.scene.add(this.beacon);

    this.bindUi();
    this.setPhase('title');
    this.onResize();
    addEventListener('resize', () => this.onResize());
    this.rider.update(this.motor, 0.016);
    this.frame(0);
  }

  get playing() {
    return this.phase === 'play' && !this.diorama && !this.map.open;
  }

  setPhase(phase) {
    this.phase = phase;
    document.body.dataset.phase = phase;
    this.keys.clear();
    if (phase === 'play') this.rig.snap(this.motor);
  }

  bindUi() {
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, select')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.sound.unlock();
      this.keys.add(e.code);
      if (e.code === 'Enter' || e.code === 'Space') {
        if (this.phase === 'title') this.setPhase('intro');
        else if (this.phase === 'intro') this.setPhase('play');
      }
      if (this.phase !== 'play') return;
      if (e.code === 'KeyM') this.map.setOpen(!this.map.open);
      if (e.code === 'Escape') {
        this.map.setOpen(false);
        this.toggleDiorama(false);
      }
      if (e.code === 'KeyB') this.toggleDiorama();
      if (!this.playing) return;
      if (e.code === 'KeyF') this.toggleWalk();
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyR') this.rescue();
      if (e.code === 'KeyT') this.skipTime();
      if (e.code === 'KeyY') this.cycleWeather();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('pointerdown', () => this.sound.unlock());
    // 点过的按钮别留着焦点，不然空格起跳会变成再点一次按钮
    addEventListener('click', (e) => e.target.closest?.('button')?.blur());

    this.bindPointer(this.renderer.domElement);

    $('begin').addEventListener('click', () => this.setPhase('intro'));
    $('drop-in').addEventListener('click', () => this.setPhase('play'));
    $('rail-map').addEventListener('click', () => this.map.setOpen(true));
    $('rail-diorama').addEventListener('click', () => this.toggleDiorama(true));
    $('rail-reset').addEventListener('click', () => this.rescue());
    $('rail-help').addEventListener('click', () => this.setPhase('intro'));
    $('rail-gear').addEventListener('click', () => this.toggleWorkshop());
    $('rail-sound').addEventListener('click', () => this.setMuted(!this.sound.muted));
    this.setMuted(this.sound.muted);
    $('workshop-close').addEventListener('click', () => this.toggleWorkshop(false));
    $('diorama-back').addEventListener('click', () => this.toggleDiorama(false));
    $('open-diorama').addEventListener('click', () => {
      this.map.setOpen(false);
      this.toggleDiorama(true);
    });
    bindWorkshop(this.rider);
  }

  /**
   * 画面上的鼠标 / 触屏：左键或手指按住左右两侧压刃，右键按住拖动转视角。
   * 沙盘视角下右键留给 OrbitControls 自己用。
   */
  bindPointer(canvas) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === MOUSE_RIGHT) {
        if (!this.playing) return;
        this.rig.setLooking(true);
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== MOUSE_LEFT) return;
      this.pointerEdge = e.clientX < innerWidth * 0.4 ? -1 : e.clientX > innerWidth * 0.6 ? 1 : 0;
    });
    canvas.addEventListener('pointermove', (e) => this.rig.pan(e.movementX, e.movementY));
    addEventListener('pointerup', (e) => {
      if (e.button === MOUSE_RIGHT) this.rig.setLooking(false);
      else this.pointerEdge = 0;
    });
    const drop = () => {
      this.rig.setLooking(false);
      this.pointerEdge = 0;
    };
    addEventListener('pointercancel', drop);
    addEventListener('blur', drop);
  }

  toggleWorkshop(force) {
    const open = $('workshop').classList.toggle('show', force);
    $('rail-gear').classList.toggle('on', open);
  }

  setMuted(muted) {
    this.sound.setMuted(muted);
    $('rail-sound').classList.toggle('off', muted);
    $('rail-sound').title = muted ? '声音：关' : '声音：开';
  }

  skipTime() {
    this.environment.skip(TIME_SKIP_HOURS);
    this.toast(`时间往后拨 ${TIME_SKIP_HOURS} 小时`);
  }

  cycleWeather() {
    this.environment.weather.cycle();
    this.toast(`天气：${this.environment.weather.label}`);
  }

  toggleWalk() {
    const motor = this.motor;
    if (motor.mode !== 'ride' && motor.mode !== 'walk') return;
    if (motor.mode === 'ride' && (!motor.onGround || motor.speed > 6)) {
      this.toast('先停下来');
      return;
    }
    motor.mode = motor.mode === 'walk' ? 'ride' : 'walk';
    motor.vx = motor.vy = motor.vz = 0;
  }

  interact() {
    const motor = this.motor;
    if (motor.mode === 'drive') {
      this.vehicles.exit(motor);
      return;
    }
    if (motor.mode === 'lift') return;
    const car = this.vehicles.nearest(motor.x, motor.z);
    if (car) {
      this.vehicles.enter(car, motor);
      return;
    }
    const lift = this.lifts.nearestBottom(motor.x, motor.z);
    if (lift) this.lifts.board(lift, motor);
  }

  rescue() {
    if (this.motor.mode === 'drive') this.vehicles.exit(this.motor);
    this.lifts.cancel();
    this.motor.reset();
    this.trail.clear();
    this.time = 0;
    this.rig.snap(this.motor);
  }

  toggleDiorama(force) {
    const next = force ?? !this.diorama;
    if (next === this.diorama || this.phase !== 'play') return;
    this.diorama = next;
    this.orbit.enabled = next;
    this.beacon.visible = next;
    document.body.dataset.view = next ? 'diorama' : 'ride';
    this.keys.clear();
    this.landscape.setHaze(...(next ? HAZE.diorama : HAZE.ride));
    if (!next) return;
    const size = this.terrain.worldSize;
    this.orbit.target.set(size / 2, (this.terrain.minH + this.terrain.maxH) / 2, size / 2);
    this.overview.position.set(size * 0.5, this.terrain.maxH + 3600, size * 1.55);
    this.beacon.position.set(this.motor.x, this.motor.y + 110, this.motor.z);
  }

  sampleInput() {
    const held = (...codes) => codes.some((code) => this.keys.has(code));
    const keyEdge = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
    const forward = held('KeyW', 'ArrowUp') ? 1 : 0;
    const brake = held('KeyS', 'ArrowDown') ? 1 : 0;
    return {
      edge: keyEdge || this.pointerEdge,
      turn: keyEdge,
      tuck: forward,
      forward,
      brake,
      run: held('ShiftLeft', 'ShiftRight'),
      jump: held('Space'),
    };
  }

  frame(dt) {
    this.clock += dt;
    if (this.playing) this.simulate(dt);
    else this.lifts.update(0, this.motor, null);

    this.landscape.update(dt);
    this.rider.update(this.motor, dt);
    this.rider.root.visible = !this.hidden();
    this.shadow.update(this.motor);
    this.spray.update(this.motor, this.playing ? dt : 0);
    this.updateArrow();
    this.updateSound(dt);

    if (this.diorama) {
      this.orbit.update();
    } else if (this.phase === 'play') {
      this.rig.update(this.motor, dt);
    } else {
      this.rig.orbit(this.motor, this.clock);
    }
    if (this.phase === 'play') this.updateHud(dt);
    const camera = this.diorama ? this.overview : this.camera;
    this.snowfall.update(dt, camera, this.environment.weather.now, this.environment.look.sunTint, this.renderer.domElement.height);
    this.renderer.render(this.scene, camera);
  }

  /** 底噪跟着滑行状态走；上下索道、上下车时响一声。 */
  updateSound(dt) {
    const motor = this.motor;
    this.sound.update(dt, {
      active: this.playing,
      mode: motor.mode,
      speed: motor.speed,
      onGround: motor.onGround,
      edge: motor.edge,
      slip: motor.slip,
      surface: motor.surface,
      gust: this.environment.weather.now.wind,
    });
    if (motor.mode === this.lastMode) return;
    if (MECHANICAL_MODES.includes(motor.mode) || MECHANICAL_MODES.includes(this.lastMode)) this.sound.play('clunk');
    this.lastMode = motor.mode;
  }

  simulate(dt) {
    const input = this.sampleInput();
    this.acc += Math.min(0.05, dt);
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.motor.step(input, STEP);
      this.lifts.update(STEP, this.motor, input);
      this.vehicles.update(STEP, input, this.motor);
      this.trail.stamp(this.motor, this.rider.roll);
      this.acc -= STEP;
      steps++;
    }
    if (this.motor.mode === 'ride' && this.motor.speed > 1) this.time += dt;
    for (const event of this.motor.events.splice(0)) this.onEvent(event);
    this.map.update(this.motor, dt);
  }

  /** 坐进轿厢或驾驶室时看不到人。 */
  hidden() {
    if (this.motor.mode === 'lift') return this.lifts.enclosed;
    return this.motor.mode === 'drive' && this.vehicles.occupied?.spec.type === 'truck';
  }

  onEvent(event) {
    this.playEvent(event);
    if (event.type === 'edge') this.toast('到雪场边界了 · 按 R 回山顶');
    if (event.type === 'crash') this.toast('撞上了！');
    if (event.type !== 'land') return;
    if (this.motor.wipeout > 0) {
      this.toast('摔了！');
      return;
    }
    const spin = Math.round(event.spin / 180) * 180;
    const stance = event.switch ? ' · 反脚' : '';
    if (spin >= 180) this.toast(event.clean ? `${spin}° 转体${stance}` : `${spin}° 没站稳`);
    else if (event.air > 0.9) this.toast(`腾空 ${event.air.toFixed(1)} 秒`);
    if (spin >= 180 && event.clean) this.sound.play('trick');
  }

  /** 雪板那边报上来的事件各配一个音效。 */
  playEvent(event) {
    if (event.type === 'jump') this.sound.play('jump', event.power);
    if (event.type === 'crash') this.sound.play('crash');
    if (event.type === 'bump') this.sound.play('bump', event.speed / BUMP_FULL_SPEED);
    if (event.type === 'touch' && event.impact > LAND_IMPACT.min) this.sound.play('land', event.impact / LAND_IMPACT.full);
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    this.toastClock = TOAST_SECONDS;
  }

  updateArrow() {
    const dest = this.map.destination;
    this.arrow.visible = Boolean(dest) && this.playing && !this.hidden();
    if (!this.arrow.visible) return;
    const next = this.map.route?.points.at(-1) ?? dest;
    const y = this.motor.y + 2.5 + Math.sin(this.clock * 3) * 0.08;
    this.arrow.position.set(this.motor.x, y, this.motor.z);
    this.arrow.lookAt(next.x, y, next.z);
  }

  updateHud(dt) {
    if (this.toastClock > 0) {
      this.toastClock -= dt;
      if (this.toastClock <= 0) $('toast').classList.remove('show');
    }
    const motor = this.motor;
    const charge = motor.mode === 'ride' ? motor.charge / MAX_CHARGE : 0;
    $('charge').classList.toggle('show', charge > 0.05);
    $('charge').firstElementChild.style.width = `${Math.round(charge * 100)}%`;

    this.hudClock -= dt;
    if (this.hudClock > 0) return;
    this.hudClock = HUD_INTERVAL;
    $('speed').textContent = String(Math.round(motor.speed * 3.6));
    $('alt').textContent = String(Math.round(motor.y));
    const minutes = Math.floor(this.time / 60);
    $('time').textContent = `${minutes}:${String(Math.floor(this.time % 60)).padStart(2, '0')}`;
    $('clock').textContent = this.environment.clockLabel;
    $('weather').textContent = this.environment.weather.label;
    this.updateRunTag();
    $('prompt').innerHTML = this.promptText();
    const route = this.map.route;
    $('gps').textContent = route ? `${route.hint} · ${formatDistance(route.distance)}` : '';
  }

  updateRunTag() {
    const motor = this.motor;
    const hit = this.pistes.locate(motor.x, motor.z, 4);
    const level = hit ? DIFFICULTY[hit.piste.difficulty] : OFF_PISTE;
    const badge = $('run-badge');
    badge.textContent = level.label;
    badge.style.background = level.color;
    $('run-name').textContent = hit ? pisteTitle(hit.piste) : OFF_PISTE.title;
    const state = {
      lift: this.lifts.active?.lift.name,
      drive: this.vehicles.occupied?.spec.name,
      walk: '步行',
    }[motor.mode];
    $('run-sub').textContent = state ?? (hit ? `${level.label}道 · ${SURFACE_LABEL[motor.surface]}` : SURFACE_LABEL[motor.surface]);
  }

  promptText() {
    const motor = this.motor;
    const key = (k, text) => `<kbd>${k}</kbd>${text}`;
    if (motor.mode === 'drive') return key('E', '下车');
    if (motor.mode === 'lift') return key('W', '按住快进');
    if (motor.mode === 'walk') return key('F', '上板');
    if (motor.speed > 9) return '';
    const car = this.vehicles.nearest(motor.x, motor.z);
    if (car) return key('E', `开${car.spec.name}`);
    const lift = this.lifts.nearestBottom(motor.x, motor.z);
    if (lift) return key('E', `乘坐${lift.name}`);
    return '';
  }

  onResize() {
    for (const camera of [this.camera, this.overview]) {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    }
    this.renderer.setSize(innerWidth, innerHeight);
  }
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
}
