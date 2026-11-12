/**
 * 滑行风格。一种风格由三样东西组成：
 * - stance  固定器角度（度）：[前脚, 后脚]，正数朝板头，负数朝板尾
 * - motor   雪板的手感，SnowboardMotor 照着它算
 * - pose    身体怎么摆，在基础站姿和各个动作上做的改动，Rider 和 ridePose 照着它摆
 *
 * motor 里的每一项：
 * - maxEdge       立刃最深到多少弧度
 * - edgeResponse  换刃的快慢（每秒）
 * - sidecut       板刃弧线的半径（米）：越小，同样的立刃角弯越急
 * - grip          板刃咬雪的本事，是雪面抓地力的倍数：越大，高速时弯能拐得越急
 * - edgeDrag      立刃到底时多出来的减速度（米/秒²）
 * - pivot         慢速时原地拧板最快每秒转多少弧度；速度从 pivotFade 的前者到后者，拧板逐渐不管用
 * - steerSkid     转弯时板头比行进方向多拧进弯里多少弧度：板子横着搓雪，边转边减速。
 *                 速度从 skidFade 的前者到后者（米/秒），这个角度从没有加到最大——越快搓得越狠，慢下来就不搓了，
 *                 所以速度会自己稳在一个不快不慢的地方
 * - pop / spin    起跳的离地速度、甩出来的转速，各是基准的多少倍
 * - landing       落地时板子和行进方向的夹角（弧度）：小于 clean 算站稳，大于 catch 而且够快就卡刃摔倒
 *
 * pose 里的每一项：
 * - touch   板刃压到底时手去不去摸雪（0–1）
 * - quiet   板子在脚下拧开时，上身留在原来朝向的程度（0–1）：搓雪小转靠的就是上身不动、下身拧板
 * - stance  对基础站姿的改动
 * - moves   对各个动作的改动，写了哪一项就换哪一项
 */
export const TECHNIQUES = {
  // 肩和髋跟板子平行，两脚外八，正脚反脚都顺手：现在最常见的刻滑站法
  duck: {
    label: '八字刻滑',
    note: '肩与板平行，走刃拐中弯，正反脚都顺',
    stance: [15, -15],
    motor: { maxEdge: 1.1, edgeResponse: 6.5, sidecut: 7.5, grip: 1, edgeDrag: 0.5, pivot: 1.6, pivotFade: [1.5, 7], steerSkid: 0, pop: 1, spin: 1, landing: { clean: 0.45, catch: 0.85 } },
    pose: { touch: 1, quiet: 0 },
  },
  // 两只脚都朝板头，胸口和髋转向前进方向：刃立得更深、咬得更死，速度留得住，但换刃慢，也不适合跳
  forward: {
    label: '一顺刻滑',
    note: '两脚朝前、胸口对着板头，刃立得深、弯拐得急，换刃慢',
    stance: [39, 24],
    motor: { maxEdge: 1.22, edgeResponse: 5, sidecut: 9, grip: 1.45, edgeDrag: 0.3, pivot: 1.2, pivotFade: [1.5, 6], steerSkid: 0, pop: 0.9, spin: 0.7, landing: { clean: 0.4, catch: 0.8 } },
    pose: {
      touch: 1,
      quiet: 0,
      // 上身朝板头转开，两膝一起往前顶，两只手都在身前
      stance: { twist: 0.85, pitch: 0.2, look: 1.4, knees: 0.25, drive: 0.6, front: [0.2, -0.25, -0.05], back: [0.14, -0.22, 0.14] },
      moves: {
        cruise: { drop: 0.05, pitch: 0.05, front: [0.22, -0.22, -0.02], back: [0.16, -0.2, 0.16] },
        // 前刃：髋往弯里沉，胸口压向雪面，后手贴着雪面往前带
        toe: { drop: 0.15, hipZ: 0.08, pitch: -0.2, twist: -0.2, look: -0.2, front: [0.26, -0.14, 0.08], back: [0.1, -0.3, 0.2] },
        // 后刃：整个人朝前坐下去，胸口还是对着板头，前手垂到身侧靠近雪面
        heel: { drop: 0.17, hipZ: -0.1, pitch: 0.3, twist: 0.25, look: 0.1, front: [0.2, -0.32, -0.1], back: [0.22, -0.12, 0.08] },
        toeTouch: { hipZ: 0.04, pitch: 0.12 },
        heelTouch: { hipZ: -0.06, pitch: -0.3 },
      },
    },
  },
  // 板子放得平，下身带着板子在脚下左右拧，上身一直对着山下：弯小、换得快，一路搓着雪把速度压住
  skid: {
    label: '搓雪小转',
    note: '上身对着山下，下身拧板搓雪，弯小换得快，速度压得住',
    stance: [18, -6],
    motor: { maxEdge: 0.75, edgeResponse: 10, sidecut: 5.5, grip: 1.2, edgeDrag: 0.5, pivot: 1.9, pivotFade: [5, 16], steerSkid: 0.6, skidFade: [3, 11], pop: 1, spin: 1, landing: { clean: 0.5, catch: 0.9 } },
    pose: {
      touch: 0,
      quiet: 0.7,
      // 膝盖屈得深一些，两臂张开端平，跟着重心左右找平衡
      stance: { pitch: 0.26, knees: 0.9, front: [0.24, -0.15, 0.14], back: [-0.24, -0.15, 0.12] },
      moves: {
        cruise: { drop: 0.07, pitch: 0.04, front: [0.25, -0.13, 0.15], back: [-0.25, -0.13, 0.13] },
        // 换刃靠屈膝下压，人不往弯里倒
        toe: { drop: 0.1, hipZ: 0.04, pitch: -0.16, front: [0.26, -0.1, 0.14], back: [-0.24, -0.18, 0.16] },
        heel: { drop: 0.12, hipZ: -0.05, pitch: 0.22, front: [0.24, -0.18, 0.08], back: [-0.26, -0.1, 0.14] },
      },
    },
  },
  // 站得松、重心低，板子软：跳得高、转得快，落地歪一点也站得住，走刃不如刻滑咬得死
  free: {
    label: '自由式',
    note: '站得松、重心低，跳得高转得快，落地容错大',
    stance: [15, -15],
    motor: { maxEdge: 1, edgeResponse: 8, sidecut: 7, grip: 0.95, edgeDrag: 0.5, pivot: 1.9, pivotFade: [1.5, 8], steerSkid: 0, pop: 1.22, spin: 1.3, landing: { clean: 0.6, catch: 1 } },
    pose: {
      touch: 0.6,
      quiet: 0,
      stance: { pitch: 0.18, knees: 0.95, front: [0.2, -0.22, 0.1], back: [-0.2, -0.22, 0.1] },
      moves: {
        cruise: { drop: 0.07, pitch: 0.06, front: [0.22, -0.2, 0.12], back: [-0.22, -0.2, 0.1] },
      },
    },
  },
};

export const TECHNIQUE_IDS = Object.keys(TECHNIQUES);
export const DEFAULT_TECHNIQUE = 'duck';
const STORE_KEY = 'hemu-like-technique';

/** 上次选的滑行风格；没选过、或存的东西认不出来，就是八字刻滑。 */
export function loadTechnique() {
  try {
    const id = localStorage.getItem(STORE_KEY);
    return TECHNIQUES[id] ? id : DEFAULT_TECHNIQUE;
  } catch {
    return DEFAULT_TECHNIQUE;
  }
}

/** 记住这次选的滑行风格。存不进去（比如浏览器禁了本地存储）不影响滑。 */
export function saveTechnique(id) {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    // 忽略：下次打开回到默认风格
  }
}

/** 列表里的下一种风格，到头了回到第一种。 */
export function nextTechnique(id) {
  return TECHNIQUE_IDS[(TECHNIQUE_IDS.indexOf(id) + 1) % TECHNIQUE_IDS.length];
}
