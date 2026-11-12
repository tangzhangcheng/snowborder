/**
 * 四种天气。cover 云量，gloom 天色发灰的程度，visibility 能见度（乘在雾的远近上），
 * snow 飘雪的密度，wind 风的大小。都只影响画面和声音，不改雪板的手感。
 */
export const WEATHER = {
  clear: { label: '晴', cover: 0, gloom: 0, visibility: 1, snow: 0, wind: 0.15 },
  cloudy: { label: '多云', cover: 0.55, gloom: 0.45, visibility: 0.7, snow: 0, wind: 0.35 },
  snow: { label: '小雪', cover: 0.9, gloom: 0.75, visibility: 0.3, snow: 0.4, wind: 0.55 },
  storm: { label: '暴雪', cover: 1, gloom: 1, visibility: 0.1, snow: 1, wind: 1 },
};

const ORDER = Object.keys(WEATHER);
const FIELDS = ['cover', 'gloom', 'visibility', 'snow', 'wind'];
/** 自己变天时往哪儿变、各占多大比重：天气一档一档地走，不会晴天直接跳暴雪。 */
const NEXT = {
  clear: { cloudy: 4, snow: 1 },
  cloudy: { clear: 5, snow: 4, storm: 1 },
  snow: { cloudy: 5, storm: 3, clear: 2 },
  storm: { snow: 7, cloudy: 3 },
};
/** 一种天气至少、至多维持多少秒。 */
const HOLD_SECONDS = [150, 330];
/** 换天气时各项数值追上去的快慢（秒），大约三倍这么久后看不出还在变。 */
const BLEND_SECONDS = 5;

export class Weather {
  constructor(id = 'clear') {
    this.id = id;
    this.now = Object.fromEntries(FIELDS.map((field) => [field, WEATHER[id][field]]));
    this.hold = holdTime();
  }

  get label() {
    return WEATHER[this.id].label;
  }

  set(id) {
    this.id = id;
    this.hold = holdTime();
  }

  /** 手动换到下一种。 */
  cycle() {
    this.set(ORDER[(ORDER.indexOf(this.id) + 1) % ORDER.length]);
  }

  update(dt) {
    this.hold -= dt;
    if (this.hold <= 0) this.set(pick(NEXT[this.id]));
    const target = WEATHER[this.id];
    const k = 1 - Math.exp(-dt / BLEND_SECONDS);
    for (const field of FIELDS) this.now[field] += (target[field] - this.now[field]) * k;
  }
}

function holdTime() {
  return HOLD_SECONDS[0] + Math.random() * (HOLD_SECONDS[1] - HOLD_SECONDS[0]);
}

/** 按权重随机挑一个。 */
function pick(weights) {
  const entries = Object.entries(weights);
  let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [id, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return id;
  }
  return entries[0][0];
}
