import { burst, humLayer, noiseBuffer, noiseLayer, tone } from './synth.js';

const MUTE_KEY = 'valley-snow:muted';
const MASTER_VOLUME = 0.7;
/** 持续声层的音量、音色追上目标值的快慢（秒），太快会咔哒响。 */
const SMOOTH = 0.08;
/** 滑到这个速度（米/秒）时风声开到最大。 */
const TOP_SPEED = 28;
/** 步行时每走这么远（米）响一声脚步。 */
const STRIDE = 0.8;
/** 板底擦过不同雪面的声音：压雪沙沙的，粉雪闷，硬壳又尖又响。 */
const GLIDE = {
  groomed: { gain: 0.3, frequency: 1900 },
  powder: { gain: 0.24, frequency: 650 },
  crust: { gain: 0.36, frequency: 2600 },
};
/**
 * 风声分两层，音色都和板底的沙沙声错开，才不会被它盖住：
 * body 是耳边呼呼的一大片低频，howl 是窄窄一条、音高飘来飘去的呼啸。
 * base：没风站着不动时的底噪；gust：天气的风最大时加多少；speed：滑到最快时加多少；
 * tone：音色从慢到快滑过的频率（赫兹）；wander：呼啸的音高上下飘多少赫兹。
 */
const WIND = {
  body: { base: 0.05, gust: 0.3, speed: 1.45, tone: [320, 1000] },
  howl: { base: 0, gust: 0.3, speed: 1.3, tone: [620, 1150], wander: 180 },
};
/** 风声随速度涨的指数：越大越要冲到很快才听得见，取小一点让中等速度也有风。 */
const RUSH_CURVE = 1.3;
/** 风是一阵一阵的：音量按这个幅度起伏。 */
const FLUTTER = 0.28;
const RUSHING_MODES = ['ride', 'drive'];
/** 板刃刮雪声：压刃、搓雪各自的音量系数，以及总的上限。 */
const EDGE_GAIN = { carve: 0.26, slip: 0.02, max: 0.24 };

/** 一次性的音效。gap：同一种音效最短隔多久才能再响，撞墙蹭着走时不会连成一片。 */
const SHOTS = {
  jump: {
    gap: 0.15,
    voice: (sound, power) => sound.burst({ type: 'highpass', frequency: 900, sweep: 2600, gain: 0.22 * power, decay: 0.16 }),
  },
  land: {
    gap: 0.12,
    voice: (sound, power) => {
      sound.tone({ from: 110, to: 45, gain: 0.5 * power, decay: 0.2 });
      sound.burst({ frequency: 1400, sweep: 500, gain: 0.3 * power, decay: 0.22 });
    },
  },
  crash: {
    gap: 0.3,
    voice: (sound) => {
      sound.tone({ from: 95, to: 35, gain: 0.8, decay: 0.35 });
      sound.burst({ frequency: 2200, sweep: 300, gain: 0.55, decay: 0.45 });
    },
  },
  bump: {
    gap: 0.25,
    voice: (sound, power) => {
      sound.tone({ from: 150, to: 60, gain: 0.4 * power, decay: 0.12 });
      sound.burst({ frequency: 900, sweep: 500, gain: 0.2 * power, decay: 0.1 });
    },
  },
  trick: {
    gap: 0.3,
    voice: (sound) => {
      sound.tone({ type: 'triangle', from: 784, gain: 0.12, decay: 0.25 });
      sound.tone({ type: 'triangle', from: 1175, gain: 0.12, decay: 0.3, delay: 0.09 });
    },
  },
  clunk: {
    gap: 0.2,
    voice: (sound) => {
      sound.tone({ type: 'square', from: 120, to: 70, gain: 0.16, decay: 0.09 });
      sound.burst({ type: 'bandpass', frequency: 2000, gain: 0.15, decay: 0.04 });
    },
  },
  step: {
    gap: 0.1,
    voice: (sound) => sound.burst({ frequency: 1100, sweep: 600, gain: 0.16, decay: 0.07 }),
  },
};

/**
 * 游戏里所有的声音：几层一直响着、跟着滑行状态变的底噪，加上起跳落地这类一次性音效。
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.last = {};
    this.stride = 0;
    this.clock = 0;
  }

  /** 浏览器要等用户点过或按过键才允许出声，所以第一次操作时才真正建起来。 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
      return;
    }
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    this.ctx = new Context();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    // 几层声音叠起来可能过载，过一道压限再出去
    this.master.connect(this.ctx.createDynamicsCompressor()).connect(this.ctx.destination);
    this.noise = noiseBuffer(this.ctx);
    this.layers = this.buildLayers();
    document.addEventListener('visibilitychange', () => (document.hidden ? this.ctx.suspend() : this.ctx.resume()));
  }

  buildLayers() {
    const { ctx, master, noise } = this;
    return {
      wind: noiseLayer(ctx, master, noise, { type: 'lowpass', frequency: WIND.body.tone[0] }),
      howl: noiseLayer(ctx, master, noise, { type: 'bandpass', frequency: WIND.howl.tone[0], q: 4 }),
      glide: noiseLayer(ctx, master, noise, { type: 'bandpass', frequency: 1900, q: 0.8 }),
      edge: noiseLayer(ctx, master, noise, { type: 'highpass', frequency: 2400 }),
      lift: humLayer(ctx, master, { frequency: 58, cutoff: 220 }),
      engine: humLayer(ctx, master, { frequency: 46, cutoff: 420 }),
    };
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    this.master?.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, SMOOTH);
  }

  /**
   * 每帧调用，按此刻的状态调各层底噪。
   * @param {number} dt
   * @param {{active: boolean, mode: string, speed: number, onGround: boolean, edge: number, slip: number, surface: string, gust: number}} state
   */
  update(dt, state) {
    if (!this.ctx) return;
    this.clock += dt;
    const now = this.ctx.currentTime;
    for (const [name, level] of Object.entries(levels(state, this.clock))) {
      this.layers[name].gain.setTargetAtTime(level.gain, now, SMOOTH);
      this.layers[name].tone.setTargetAtTime(level.tone, now, SMOOTH);
    }
    this.footsteps(dt, state);
  }

  footsteps(dt, state) {
    if (!state.active || state.mode !== 'walk') return;
    this.stride += state.speed * dt;
    if (this.stride < STRIDE) return;
    this.stride = 0;
    this.play('step');
  }

  /** 响一个一次性音效。power 0~1，撞得越狠越响。 */
  play(name, power = 1) {
    if (!this.ctx || this.muted) return;
    const shot = SHOTS[name];
    const now = this.ctx.currentTime;
    if (now - (this.last[name] ?? -Infinity) < shot.gap) return;
    this.last[name] = now;
    shot.voice(this, Math.min(1, Math.max(0.2, power)));
  }

  burst(options) {
    burst(this.ctx, this.master, this.noise, options);
  }

  tone(options) {
    tone(this.ctx, this.master, options);
  }
}

/** 阵风的起伏：几个互不成倍数的慢波叠起来，听不出重复。返回 -1 ~ 1。 */
function sway(clock, pace) {
  const t = clock * pace;
  return (Math.sin(t) + 0.6 * Math.sin(t * 2.3 + 1.7) + 0.3 * Math.sin(t * 5.1 + 0.4)) / 1.9;
}

/** 风的一层此刻的音量和音色。rush：迎面的风有多大（0~1）；swell：此刻阵风的起伏（-1~1）。 */
function windLayer({ base, gust, speed, tone }, state, rush, swell) {
  const force = state.gust ** 2 * gust + rush ** RUSH_CURVE * speed;
  return {
    gain: base + force * (1 + FLUTTER * swell),
    tone: tone[0] + (tone[1] - tone[0]) * Math.max(rush, state.gust * 0.5),
  };
}

/** 各层底噪此刻该多响（gain）、音色多高（tone，赫兹）。 */
function levels(state, clock) {
  const fast = Math.min(1, state.speed / TOP_SPEED);
  const grounded = state.active && state.mode === 'ride' && state.onGround;
  const surface = GLIDE[state.surface] ?? GLIDE.groomed;
  // 索道为了省时间跑得飞快，坐在上面不该听到狂风，所以只有自己滑、自己开车时才算迎面的风
  const rush = state.active && RUSHING_MODES.includes(state.mode) ? fast : 0;
  // 风：天气本身的风一直有，滑得越快耳边的风越大；两层的起伏各走各的节奏
  const wind = windLayer(WIND.body, state, rush, sway(clock, 0.9));
  const howl = windLayer(WIND.howl, state, rush, sway(clock + 40, 1.4));
  howl.tone += WIND.howl.wander * sway(clock + 90, 0.6);
  return {
    wind,
    howl,
    glide: { gain: grounded ? Math.min(1, state.speed / 12) * surface.gain : 0, tone: surface.frequency },
    // 板刃：压刃越深、搓雪越狠，刮擦声越大
    edge: { gain: grounded ? Math.min(EDGE_GAIN.max, Math.abs(state.edge) * fast * EDGE_GAIN.carve + state.slip * EDGE_GAIN.slip) : 0, tone: 2400 + fast * 1600 },
    lift: { gain: state.active && state.mode === 'lift' ? 0.1 : 0, tone: 58 },
    engine: { gain: state.active && state.mode === 'drive' ? 0.08 + fast * 0.08 : 0, tone: 46 + state.speed * 3.2 },
  };
}
