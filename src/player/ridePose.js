import * as THREE from 'three';

/** 骨盆离板面的高度（米）：站姿时的高度，和再怎么蹲也不低于的高度。 */
const HIP = { stand: 0.77, lowest: 0.5 };
/** 上身前倾角的上下限（弧度），几个动作叠在一起时不至于把脸埋进膝盖。 */
const PITCH_RANGE = [-0.3, 0.95];

/**
 * 基础站姿：八字站位的刻滑站姿。
 * 膝盖微屈并朝脚尖方向打开，重心落在两脚中间，上身略微前倾，
 * 肩和髋跟板子平行，两臂自然垂在身体两侧稍微打开，头转过去看前进方向。
 *
 * 坐标是身体自己的：+x 朝板头，+y 朝上，+z 朝脚尖一侧。
 * - hipZ   骨盆往脚尖（正）或脚跟（负）一侧挪多少米
 * - pitch  上身朝脚尖一侧前倾的角度
 * - twist  上身朝板头方向转开的角度
 * - look   头朝板头方向转过去的角度
 * - knees  膝盖往外打开的程度
 * - front / back  前手、后手相对各自肩膀的位置
 */
const STANCE = {
  hipZ: -0.03,
  pitch: 0.22,
  twist: 0.08,
  look: 1.2,
  knees: 0.8,
  front: [0.17, -0.27, 0.08],
  back: [-0.17, -0.27, 0.06],
};

/**
 * 各个动作在基础站姿上的改动，都按动作的强度（0–1）叠加。
 * drop 是骨盆下沉的米数——所谓"折叠"，就是髋、膝、踝一起屈，把重心压低。
 * 手的位置不是相加，而是按强度朝这个动作的位置靠过去，所以顺序有讲究：靠后的动作说了算。
 */
const MOVES = {
  // 有速度以后比站着不动时压得低一点，手也张开一些找平衡
  cruise: { drop: 0.04, pitch: 0.06, front: [0.2, -0.23, 0.11], back: [-0.19, -0.23, 0.08] },
  // 前刃：膝盖朝雪面跪下去，髋往前顶到刃的上方，上身反而挺直；后手放低往雪面靠，前手抬在身前领路
  toe: { drop: 0.09, hipZ: 0.07, pitch: -0.44, twist: -0.04, look: -0.3, front: [0.25, -0.1, 0.05], back: [-0.2, -0.27, 0.15] },
  // 后刃：像坐椅子一样往后往下坐，上身折向大腿把重心留在刃上；前手垂到身后靠近雪面，后手抬在身前压住平衡
  heel: { drop: 0.1, hipZ: -0.08, pitch: 0.58, twist: 0.2, look: 0.2, front: [0.2, -0.32, -0.04], back: [-0.2, -0.14, 0.12] },
  // 前刃压到底、后手去摸雪：整个人再往弯里倒一点，胸口朝雪面压下去，肩膀才够得着
  toeTouch: { hipZ: 0.05, pitch: 0.18 },
  // 后刃压到底、前手去摸雪：不再折向大腿，而是髋往后送、上身朝雪面躺开，前手撑在身后
  heelTouch: { hipZ: -0.08, pitch: -0.46 },
  // 落地：腿先伸出去接雪面，接到以后往下一沉把冲击吃掉
  absorb: { drop: 0.18, hipZ: -0.03, pitch: 0.22, front: [0.2, -0.2, 0.16], back: [-0.2, -0.2, 0.14] },
  // 收腿加速：蹲低，上身伏下去，两手收到身前
  tuck: { drop: 0.17, hipZ: -0.05, pitch: 0.5, twist: 0.25, front: [-0.02, -0.16, 0.12], back: [0.1, -0.16, 0.12] },
  // 蓄力：深蹲，手臂往下往后摆，准备往上带
  charge: { drop: 0.2, hipZ: -0.05, pitch: 0.4, front: [0.12, -0.34, 0.0], back: [-0.12, -0.34, 0.0] },
  // 蹬伸：腿一下子蹬直把人顶起来（比站姿还高），上身挺起，两臂顺势往上带
  pop: { drop: -0.07, hipZ: 0.02, pitch: -0.14, front: [0.2, -0.07, 0.13], back: [-0.2, -0.07, 0.13] },
  // 腾空：两臂沿着板子的方向张开——离转轴越远转动惯量越大，转得越慢，也越稳
  fly: { pitch: 0.05, front: [0.27, -0.06, 0.06], back: [-0.27, -0.06, 0.06] },
  // 空中折叠：把膝盖提到胸前、板子收上来；两臂还张着找平衡
  fold: { drop: 0.2, pitch: 0.38, knees: 0.4 },
  // 转体时收紧：两臂抱到胸前、身体再缩一点，质量都靠近转轴，转速就上去了
  spinTuck: { drop: 0.05, pitch: 0.14, front: [0.05, -0.15, 0.17], back: [-0.05, -0.15, 0.17] },
};

const SCALARS = ['hipZ', 'pitch', 'twist', 'look', 'knees'];

/**
 * 板上的姿态。
 * @param {Record<keyof typeof MOVES, number>} amounts 每个动作做到几成（0–1），缺省为 0
 * @returns {{ hipY: number, hipZ: number, pitch: number, twist: number, look: number, knees: number, front: THREE.Vector3, back: THREE.Vector3 }}
 */
export function ridePose(amounts) {
  const pose = { ...STANCE, front: new THREE.Vector3(...STANCE.front), back: new THREE.Vector3(...STANCE.back) };
  const reach = new THREE.Vector3();
  let drop = 0;
  for (const [name, move] of Object.entries(MOVES)) {
    const amount = THREE.MathUtils.clamp(amounts[name] ?? 0, 0, 1);
    if (amount <= 0) continue;
    drop += (move.drop ?? 0) * amount;
    for (const key of SCALARS) pose[key] += (move[key] ?? 0) * amount;
    // 有的动作只动躯干，手交给别的动作管
    if (move.front) pose.front.lerp(reach.set(...move.front), amount);
    if (move.back) pose.back.lerp(reach.set(...move.back), amount);
  }
  pose.hipY = HIP.stand - Math.min(drop, HIP.stand - HIP.lowest);
  pose.pitch = THREE.MathUtils.clamp(pose.pitch, ...PITCH_RANGE);
  return pose;
}
