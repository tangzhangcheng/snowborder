/** 所有声音都是现场合成的：一段白噪声加几个滤波器、振荡器，不用任何音频文件。 */

const NOISE_SECONDS = 2;
/** 增益不能直接指数衰减到 0，用一个听不见的小数代替。 */
const SILENT = 0.0001;

/** 一段白噪声，风声、板底声、雪的沙沙声都从它滤出来。 */
export function noiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** 一直响着的噪声层：循环播放的噪声 → 滤波 → 音量。返回的 gain / tone 由外面逐帧调。 */
export function noiseLayer(ctx, out, buffer, { type, frequency, q = 0.7 }) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(out);
  // 各层从噪声的不同位置开始放，叠在一起才不会是同一段波形
  source.start(0, Math.random() * NOISE_SECONDS);
  return { gain: gain.gain, tone: filter.frequency };
}

/** 一直响着的嗡嗡声（索道、发动机）：锯齿波 → 低通 → 音量。 */
export function humLayer(ctx, out, { frequency, cutoff }) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = frequency;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(filter).connect(gain).connect(out);
  osc.start();
  return { gain: gain.gain, tone: osc.frequency };
}

/** 响一下就没的包络：很快冲到 peak，再在 decay 秒里衰减掉。 */
function envelope(ctx, peak, attack, decay, start) {
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(SILENT, start);
  amp.gain.linearRampToValueAtTime(Math.max(SILENT, peak), start + attack);
  amp.gain.exponentialRampToValueAtTime(SILENT, start + attack + decay);
  return amp;
}

/** 一小段滤过的噪声：雪被压实、扬起的声音。sweep 是结束时滤波器滑到的频率。 */
export function burst(ctx, out, buffer, { type = 'lowpass', frequency, sweep = frequency, q = 0.7, gain, attack = 0.005, decay }) {
  const start = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(frequency, start);
  filter.frequency.exponentialRampToValueAtTime(sweep, start + attack + decay);
  source.connect(filter).connect(envelope(ctx, gain, attack, decay, start)).connect(out);
  source.start(start, Math.random() * NOISE_SECONDS);
  source.stop(start + attack + decay + 0.05);
}

/** 一个滑音：从 from 赫兹滑到 to 赫兹。落地的闷响、提示音都用它。 */
export function tone(ctx, out, { type = 'sine', from, to = from, gain, attack = 0.005, decay, delay = 0 }) {
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + attack + decay);
  osc.connect(envelope(ctx, gain, attack, decay, start)).connect(out);
  osc.start(start);
  osc.stop(start + attack + decay + 0.05);
}
