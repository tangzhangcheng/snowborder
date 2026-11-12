import * as THREE from 'three';
import { STANCE, STANCE_ANGLES, createGear, defaultStyle } from './gear/createGear.js';
import { RIG, buildRiderModel } from './riderModel.js';
import { ridePose } from './ridePose.js';
import { MAX_CHARGE, MAX_EDGE } from './SnowboardMotor.js';

const { thigh: THIGH, shin: SHIN, upperArm: UPPER_ARM, forearm: FOREARM, hipHalf: HIP_HALF, ankle: ANKLE, shoulder: SHOULDER } = RIG;
const BOARD_TOP = 0.05;
const BOARD_HALF_WIDTH = 0.13;
const UP = new THREE.Vector3(0, 1, 0);
const SIDEWAYS = new THREE.Vector3(1, 0, 0);
const STORE_KEY = 'hemu-like-gear';
/** 板面滚转角相对立刃量的比例：慢速 / 高速。 */
const LEAN_SLOW = 0.4;
const LEAN_FAST = 1;
/** 板面最多滚转到多少弧度；身体折叠多深就看滚转到了它的几成。 */
const MAX_ROLL = MAX_EDGE * LEAN_FAST;
const SKID_ANGLE = 1.25; // 搓雪时板子横过来的角度，和 SnowboardMotor 一致
const SKID_EDGE = 0.7;
/** 各个姿态分量跟上目标的快慢（每秒）。数字越大动作越脆。 */
const RATE = { edge: 6, tuck: 7, charge: 12, cruise: 4, air: 8, fold: 14, squash: 24, recover: 3.5, pop: 30, relax: 10, spinTuck: 12, wind: 14, spot: 10 };
/** 速度（米/秒）从前者到后者，滑行时的屈膝从没有加到最深。 */
const CRUISE_SPEED = [2, 14];
/** 腾空的节奏（秒）：起跳后这么久腿才收到位；预计还有这么久落地时开始把腿伸出去。 */
const AIR = { pop: 0.22, reach: 0.4 };
/** 空中收腿时板子朝身体提上来多少米（重心走抛物线，是板子上来而不是人掉下去）。 */
const AIR_BOARD_LIFT = 0.18;
/** 身体的竖轴跟上坡面法线的快慢（每秒）。 */
const UPRIGHT_RATE = 12;
/** 豚跳蹬伸时板头先翘起来多少弧度：轻点一下，和蓄满力。 */
const OLLIE_PITCH = [0.14, 0.34];
/** 板头翘起时板尾还压在雪上，这个支点离板子中心多远（米）。 */
const TAIL_PIVOT = 0.6;
/**
 * 上身相对板子的拧转（弧度，正方向和 yaw 增大同向）。
 * prep：蓄力时朝转体的反方向预拧多少；throw：蹬伸时朝转体方向甩过去多少；
 * lead：空中每 1 弧度/秒的转速，上身领先板子多少；leadMax：领先的上限；
 * counter：反拧时板子每拧过去 1 弧度，上身朝反方向拧多少（两者角动量相抵）；limit：腰一共能拧多少。
 */
const WIND = { prep: 0.55, throw: 0.6, lead: 0.07, leadMax: 0.6, counter: 1.4, limit: 1.3 };
/** 转体时头领先身体：每 1 弧度/秒的转速头多转多少弧度，上限多少；neck 是头相对上身最多能转多少。 */
const SPOT = { lead: 0.1, max: 0.7, neck: 1.5 };
/** 板头在身体坐标里的方位角（弧度）：身体是侧着站的，胸口朝前刃，板头在左手边。 */
const NOSE_BEARING = Math.PI / 2;
/** 腾空时水平速度超过这个（米/秒）才有"行进方向"可看，再慢就看板头。 */
const DRIFT_SPEED = 2;
/** 落地时垂直雪面的速度到这么大（米/秒），缓冲就蹲到底。 */
const ABSORB_FULL_SPEED = 7;
/** 板面滚转到前者（占最大滚转的比例）时手开始去够雪面，到后者摸到。 */
const TOUCH_BANK = [0.55, 0.95];
/** 摸雪的那只手沿板长方向比肩膀再往外探多远（米）：前刃是后手拖在身后，后刃是前手撑在身前。 */
const TOUCH_REACH = { toe: 0.18, heel: 0.14 };
/** 头往回仰多少来抵掉上身前倾和整个人的侧倾，眼睛才是平着看路的。 */
const HEAD_LEVEL = { pitch: 0.6, roll: 0.55 };

function smoothstep(x) {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** 朝这一侧滚转了 bank（占最大滚转的比例）时，手够向雪面几成。 */
function touchAmount(bank) {
  return smoothstep((bank - TOUCH_BANK[0]) / (TOUCH_BANK[1] - TOUCH_BANK[0]));
}

/** 把单位长度的肢体网格拉到两个关节之间。 */
function stretch(mesh, from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length() || 1e-4;
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
  mesh.scale.set(1, len, 1);
}

/** 两段骨骼的解析解：给起点、目标和朝向提示，求中间关节与实际末端。 */
function solveJoint(from, target, upper, lower, pole, joint, end) {
  const dir = new THREE.Vector3().subVectors(target, from);
  const dist = THREE.MathUtils.clamp(dir.length(), 0.06, upper + lower - 0.002);
  dir.normalize();
  const along = (upper * upper - lower * lower + dist * dist) / (2 * dist);
  const rise = Math.sqrt(Math.max(0, upper * upper - along * along));
  const side = new THREE.Vector3().copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  joint.copy(from).addScaledVector(dir, along).addScaledVector(side, rise);
  end.copy(from).addScaledVector(dir, dist);
}

/**
 * 滑手的姿态控制。模型由 riderModel 程序生成，
 * 身体建在自己的坐标里（面朝 +Z、左手 +X），滑行时整体转 90° 侧身站在板上。
 */
export class Rider {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'Rider';
    Object.assign(this, buildRiderModel());
    this.root.add(this.body);
    this.style = loadStyle();
    this.board = null;
    this.edge = 0;
    this.roll = 0;
    // 姿态分量，都是 0–1：收腿加速、蓄力、滑行屈膝、腾空、空中收腿、落地冲击和跟着它的下蹲
    this.tuck = 0;
    this.charge = 0;
    this.cruise = 0;
    this.air = 0;
    this.fold = 0;
    this.impact = 0;
    this.squash = 0;
    this.flying = false;
    this.closing = 0;
    // 反脚：板尾朝前滑，前手后手的角色对调
    this.switched = false;
    // 起跳和转体：蹬伸、板头翘起的角度（弧度）、转体时收紧、快落地了（0–1）
    this.pop = 0;
    this.ollie = 0;
    this.spinTuck = 0;
    this.reaching = 0;
    // 上身相对板子拧了多少、眼睛看的方向在身体坐标里的方位角（弧度）
    this.wind = 0;
    this.gaze = NOSE_BEARING;
    this.fall = 0;
    this.stride = 0;
    this.up = new THREE.Vector3(0, 1, 0);
    this.mountGear();
  }

  mountGear() {
    if (this.board) {
      this.board.removeFromParent();
      this.board.traverse((o) => o.geometry?.dispose?.());
    }
    this.board = createGear(this.style);
    this.root.add(this.board);
  }

  setStyle(style) {
    this.style = { ...defaultStyle(), ...style, format: 'hemu-like-gear', version: 1 };
    localStorage.setItem(STORE_KEY, JSON.stringify(this.style));
    this.mountGear();
  }

  setOutfit(flags) {
    this.helmet.visible = flags.helmet !== false;
    this.goggles.visible = flags.goggles !== false;
    // 外套各部分共用一个材质，改一处就全变
    if (flags.jacket) this.mats.jacket.color.set(flags.jacket);
  }

  update(motor, dt) {
    const riding = motor.mode === 'ride';
    const walking = motor.mode === 'walk';
    this.track(motor, riding, dt);
    this.fall = THREE.MathUtils.damp(this.fall, motor.wipeout > 0 ? 1 : 0, 7, dt);
    if (walking) this.stride += motor.speed * dt * 4.2;

    this.placeRoot(motor, riding, dt);
    // 吊椅和车上是坐着的；魔毯上踩着板站着
    const seated = motor.mode === 'drive' || (motor.mode === 'lift' && motor.seated);
    this.board.visible = !walking && motor.mode !== 'drive';
    this.tiltBoard(riding ? this.ollie : 0, seated);
    if (walking) this.poseWalk(motor);
    else if (seated) this.poseSeated();
    else this.poseRide();
  }

  /** 把雪板的状态换成一组平滑过的姿态分量。姿态只跟着它们走，所以是渐变的，不会一帧跳过去。 */
  track(motor, riding, dt) {
    const { damp, lerp } = THREE.MathUtils;
    const grounded = riding && motor.onGround;
    const flying = riding && !motor.onGround;
    this.switched = riding && motor.switch;
    // 横板搓雪时压的是靠山一侧的板刃，和转弯输入无关
    const skid = Math.min(1, Math.abs(motor.skid) / SKID_ANGLE);
    const edge = lerp(motor.edge, -Math.sign(motor.skid) * SKID_EDGE, skid);
    const speedy = smoothstep((motor.speed - CRUISE_SPEED[0]) / (CRUISE_SPEED[1] - CRUISE_SPEED[0]));
    this.edge = damp(this.edge, riding ? edge : 0, RATE.edge, dt);
    this.tuck = damp(this.tuck, grounded && motor.tucking ? 1 : 0, RATE.tuck, dt);
    this.charge = damp(this.charge, grounded ? motor.charge / MAX_CHARGE : 0, RATE.charge, dt);
    this.cruise = damp(this.cruise, riding ? speedy : 0, RATE.cruise, dt);
    this.air = damp(this.air, flying ? 1 : 0, RATE.air, dt);
    this.fold = damp(this.fold, flying ? this.airFold(motor) : 0, RATE.fold, dt);
    this.trackJump(motor, grounded, flying, dt);
    this.trackTwist(motor, grounded, flying, dt);
    this.trackLanding(flying, dt);
  }

  /**
   * 腾空时腿该收几成：起跳那一下腿是蹬直的，升到空中把板子收上来，
   * 快落地时再把腿伸出去够雪面。顺便记下此刻朝雪面砸过去的速度和"快落地了"的程度。
   */
  airFold(motor) {
    const { closing, seconds } = motor.approach();
    this.closing = closing;
    const extended = smoothstep(seconds / AIR.reach);
    this.reaching = 1 - extended;
    return smoothstep(motor.airTime / AIR.pop) * extended;
  }

  /**
   * 豚跳：蹬伸时腿蹬直、重心压到后脚，板头先翘起来；离地后后腿一收，板子在空中放平。
   * 转体时玩家把身体收紧了几成，也在这里跟。
   */
  trackJump(motor, grounded, flying, dt) {
    const { damp, lerp } = THREE.MathUtils;
    const popping = grounded && motor.popPower > 0;
    this.pop = damp(this.pop, popping ? 1 : 0, popping ? RATE.pop : RATE.relax, dt);
    const nose = popping ? lerp(OLLIE_PITCH[0], OLLIE_PITCH[1], motor.popPower) : 0;
    this.ollie = damp(this.ollie, nose, popping ? RATE.pop : RATE.relax, dt);
    this.spinTuck = damp(this.spinTuck, flying ? motor.airTuck : 0, RATE.spinTuck, dt);
    if (!flying) this.reaching = 0;
  }

  /**
   * 上身和头绕竖轴的转动，都是为了把转体"做出来"：
   * 蓄力时上身朝反方向预拧，蹬伸时甩向转体方向，把转动借着雪面带起来；
   * 空中上身和头领先板子，眼睛先找到落点；反拧时板子往一边、上身往另一边，头始终看着行进方向。
   */
  trackTwist(motor, grounded, flying, dt) {
    const { clamp, damp } = THREE.MathUtils;
    // 转向输入：正是向右，对应 yaw 减小，所以和拧转的正方向相反
    const turn = motor.edge / MAX_EDGE;
    let wind = 0;
    if (grounded && motor.popPower > 0) wind = -turn * WIND.throw;
    else if (grounded) wind = turn * WIND.prep * this.charge;
    else if (flying) wind = clamp(motor.spinRate * WIND.lead, -WIND.leadMax, WIND.leadMax);
    // 板子在空中拧开、或落地时还没正过来：上身朝反方向拧，头不跟着板子走
    const loose = motor.mode === 'ride' ? motor.skid * this.air : 0;
    this.wind = damp(this.wind, wind - loose * WIND.counter, RATE.wind, dt);
    const lead = flying ? clamp(motor.spinRate * SPOT.lead, -SPOT.max, SPOT.max) : 0;
    this.gaze = damp(this.gaze, this.travelBearing(motor, flying) + lead, RATE.spot, dt);
  }

  /**
   * 行进方向在身体坐标里的方位角（弧度）：π/2 是板头，-π/2 是板尾。眼睛要看的就是它——
   * 横滑、反拧时板子偏开了头不跟着偏；反脚时看板尾那头；转体时身体背过去就够不着了，
   * 等转过半圈它从另一侧肩膀后面冒出来，头一下甩过去，这就是"找落点"。
   */
  travelBearing(motor, flying) {
    if (motor.mode !== 'ride') return NOSE_BEARING;
    const drifting = flying && Math.hypot(motor.vx, motor.vz) > DRIFT_SPEED;
    const travel = drifting ? Math.atan2(motor.vx, motor.vz) : motor.yaw;
    const bearing = NOSE_BEARING + travel - motor.heading;
    return Math.atan2(Math.sin(bearing), Math.cos(bearing));
  }

  /** 板子拍回雪面的那一刻按砸下来的速度记一次冲击；下蹲追着它走，冲击自己慢慢消掉，人就站回来了。 */
  trackLanding(flying, dt) {
    if (this.flying && !flying) this.impact = THREE.MathUtils.clamp(this.closing / ABSORB_FULL_SPEED, 0, 1);
    this.flying = flying;
    this.squash = THREE.MathUtils.damp(this.squash, this.impact, RATE.squash, dt);
    this.impact = THREE.MathUtils.damp(this.impact, 0, RATE.recover, dt);
  }

  /** 把根节点贴到雪面上：板头朝前、板底贴坡、按立刃角绕板的纵轴滚转。 */
  placeRoot(motor, riding, dt) {
    const sample = motor.terrain.sample(motor.x, motor.z);
    this.up.lerp(riding ? sample.normal : UP, 1 - Math.exp(-this.uprightRate(motor, riding) * Math.max(dt, 0.001))).normalize();
    const heading = riding ? motor.heading : motor.yaw;
    const nose = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)).projectOnPlane(this.up).normalize();
    const left = new THREE.Vector3().crossVectors(this.up, nose).normalize();
    this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, this.up, nose));
    // 速度越快才压得越深，慢速时只是轻轻立刃
    const depth = LEAN_SLOW + (LEAN_FAST - LEAN_SLOW) * smoothstep((motor.speed - 4) / 14);
    // 立刃量是按行进方向的左右算的，反脚时板头朝后，前刃后刃正好对调
    const toeSide = motor.switch ? -1 : 1;
    // 腾空后板子回正，转体只绕竖轴
    this.roll = riding ? toeSide * this.edge * depth * (1 - this.air) : 0;
    const roll = this.roll;
    this.root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    // 绕着压下去的那条板刃转，另一侧抬起来而不是整块板切进雪里
    const lift = BOARD_HALF_WIDTH * Math.sin(Math.abs(roll)) + AIR_BOARD_LIFT * this.fold;
    this.root.position.set(motor.x, motor.y, motor.z).addScaledVector(this.up, lift);
  }

  /**
   * 身体的竖轴跟上脚下坡面法线的快慢（每秒）。
   * 在雪上是贴着坡面的；腾空以后没有力矩能让人前后翻，所以保持离地时的朝向，
   * 快落地了才把板底对上落点的坡面。
   */
  uprightRate(motor, riding) {
    if (!riding || motor.onGround) return UPRIGHT_RATE;
    return UPRIGHT_RATE * this.reaching;
  }

  /** 板头翘起 pitch 弧度，板尾留在原地当支点。坐着的时候板子挂在脚上，往前挪一点。 */
  tiltBoard(pitch, seated) {
    this.board.rotation.x = -pitch;
    this.board.position.set(0, TAIL_PIVOT * Math.sin(pitch), seated ? 0.42 : 0);
  }

  /** 两只脚踩在板上的位置和朝向（身体坐标）。板头翘起来时前脚跟着抬高，前膝自然就提起来了。 */
  feetOnBoard() {
    const rise = Math.sin(this.ollie);
    return STANCE_ANGLES.map((yaw, i) => {
      const x = i === 0 ? STANCE : -STANCE;
      return { pos: new THREE.Vector3(x, BOARD_TOP + (x + TAIL_PIVOT) * rise, 0), yaw, pitch: this.ollie };
    });
  }

  /** 板上的姿态：基础站姿加上压刃、蹲、腾空这些动作各做到几成，具体怎么摆在 ridePose 里。 */
  poseRide() {
    // 板面滚转到了几成，朝前刃为正。慢速时滚得浅，人也就折得浅
    const bank = this.roll / MAX_ROLL;
    const touch = { toe: touchAmount(bank), heel: touchAmount(-bank) };
    const pose = ridePose({
      cruise: this.cruise,
      toe: bank,
      heel: -bank,
      toeTouch: touch.toe,
      heelTouch: touch.heel,
      absorb: this.squash,
      tuck: this.tuck,
      charge: this.charge,
      pop: this.pop,
      fly: this.air,
      fold: this.fold,
      spinTuck: this.spinTuck,
    });
    const { clamp } = THREE.MathUtils;
    const twist = clamp(pose.twist + this.wind, -WIND.limit, WIND.limit);
    // 头朝行进方向看，但不用拧到正对：站姿里看板头时差多少没拧到，这里也留这么多
    const short = NOSE_BEARING - pose.look;
    const look = Math.sign(this.gaze) * Math.max(0, Math.abs(this.gaze) - short);

    this.body.rotation.set(0, -Math.PI / 2, 0);
    this.body.rotateX(-this.fall * 1.3);
    this.setTorso(pose.hipY, pose.hipZ, pose.pitch, twist);
    this.setHead(clamp(look - twist, -SPOT.neck, SPOT.neck), pose.pitch * HEAD_LEVEL.pitch + this.roll * HEAD_LEVEL.roll);

    this.setLimbs(pose.hipY, pose.hipZ, this.feetOnBoard(), this.placeHands(pose, touch), pose.knees);
  }

  /**
   * 两只手该放在哪（身体坐标），顺序是 [板头一侧的手, 板尾一侧的手]。
   * 姿态里说的"前手、后手"是按行进方向分的：反脚时板尾朝前，两只手的角色对调，位置沿板长方向镜像。
   */
  placeHands(pose, touch) {
    const ahead = this.switched ? -1 : 1;
    const offset = (hand) => new THREE.Vector3(hand.x * ahead, hand.y, hand.z);
    const lead = this.shoulder(ahead).add(offset(pose.front));
    const trail = this.shoulder(-ahead).add(offset(pose.back));
    // 刃压得很深时手顺势去够雪面：前刃是后手拖在雪上，后刃是前手撑在雪上
    trail.lerp(this.snowTouch(-ahead, TOUCH_REACH.toe), touch.toe);
    lead.lerp(this.snowTouch(ahead, TOUCH_REACH.heel), touch.heel);
    return ahead === 1 ? [lead, trail] : [trail, lead];
  }

  /** 肩关节此刻在身体坐标里的位置。side：板头一侧 1，板尾一侧 -1。 */
  shoulder(side) {
    return new THREE.Vector3(side * SHOULDER.x, SHOULDER.y, SHOULDER.z).applyMatrix4(this.torso.matrix);
  }

  /**
   * 肩膀正下方的雪面点（身体坐标），再沿板长方向往外探 reach 米。根节点已经随板滚转，
   * 所以雪面在身体坐标里是斜的：高度 = y·cos(roll) − z·sin(roll)。
   */
  snowTouch(side, reach) {
    const shoulder = this.shoulder(side);
    const cos = Math.cos(this.roll);
    const sin = Math.sin(this.roll);
    const lift = BOARD_HALF_WIDTH * Math.abs(sin);
    const height = lift + shoulder.y * cos - shoulder.z * sin - 0.07;
    return new THREE.Vector3(shoulder.x + side * reach, shoulder.y - cos * height, shoulder.z + sin * height);
  }

  poseWalk(motor) {
    const moving = THREE.MathUtils.clamp(motor.speed / 1.8, 0, 1);
    const swing = Math.sin(this.stride) * 0.2 * moving;
    const hipY = 0.76 + Math.abs(Math.cos(this.stride)) * 0.02 * moving;
    this.body.rotation.set(0, 0, 0);
    const pitch = 0.08 + 0.08 * moving;
    this.setTorso(hipY, 0, pitch, 0);
    this.setHead(0, pitch * HEAD_LEVEL.pitch);
    const feet = [
      { pos: new THREE.Vector3(HIP_HALF, Math.max(0, swing) * 0.3, swing), yaw: 0 },
      { pos: new THREE.Vector3(-HIP_HALF, Math.max(0, -swing) * 0.3, -swing), yaw: 0 },
    ];
    const hands = [
      new THREE.Vector3(0.3, hipY + 0.02, -swing * 0.9),
      new THREE.Vector3(-0.3, hipY + 0.02, swing * 0.9),
    ];
    this.setLimbs(hipY, 0, feet, hands);
  }

  /** 吊椅或雪地摩托上的坐姿。 */
  poseSeated() {
    const hipY = 0.46;
    this.body.rotation.set(0, 0, 0);
    this.setTorso(hipY, -0.05, 0.05, 0);
    this.setHead(0, 0.05 * HEAD_LEVEL.pitch);
    const feet = [
      { pos: new THREE.Vector3(HIP_HALF + 0.03, 0.02, 0.42), yaw: 0 },
      { pos: new THREE.Vector3(-HIP_HALF - 0.03, 0.02, 0.42), yaw: 0 },
    ];
    const hands = [new THREE.Vector3(0.2, hipY + 0.12, 0.3), new THREE.Vector3(-0.2, hipY + 0.12, 0.3)];
    this.setLimbs(hipY, -0.05, feet, hands);
  }

  setTorso(hipY, hipZ, pitch, twist) {
    this.pelvis.position.set(0, hipY, hipZ);
    this.torso.position.set(0, hipY, hipZ);
    this.torso.rotation.set(pitch, twist, 0, 'YXZ');
    this.torso.updateMatrix();
  }

  /**
   * 头先左右转 yaw，再绕身体的左右轴往回仰 level：
   * 上身前倾、整个人跟着板侧倾时，头不跟着一起歪，眼睛还是平着看路。
   */
  setHead(yaw, level) {
    this.head.rotation.set(0, yaw, 0);
    this.head.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(SIDEWAYS, -level));
  }

  /** knees：膝盖往外打开的程度，八字站位时膝盖跟着脚尖朝外。 */
  setLimbs(hipY, hipZ, feet, hands, knees = 0.3) {
    const joint = new THREE.Vector3();
    const end = new THREE.Vector3();
    this.legs.forEach((leg, i) => {
      const foot = feet[i];
      leg.boot.position.copy(foot.pos);
      // 先按站位角外八，再整只脚跟着板面前后翘
      leg.boot.rotation.set(0, foot.yaw, foot.pitch ?? 0, 'ZYX');
      const hip = new THREE.Vector3(leg.side * HIP_HALF, hipY - 0.04, hipZ);
      const ankle = new THREE.Vector3(foot.pos.x, foot.pos.y + ANKLE, foot.pos.z - 0.03);
      solveJoint(hip, ankle, THIGH, SHIN, new THREE.Vector3(leg.side * knees, 0.1, 1), joint, end);
      stretch(leg.thigh, hip, joint);
      stretch(leg.shin, joint, end);
      leg.knee.position.copy(joint);
    });
    this.arms.forEach((arm, i) => {
      const shoulder = new THREE.Vector3(arm.side * SHOULDER.x, SHOULDER.y, SHOULDER.z).applyMatrix4(this.torso.matrix);
      solveJoint(shoulder, hands[i], UPPER_ARM, FOREARM, new THREE.Vector3(arm.side * 0.3, -1, -0.5), joint, end);
      stretch(arm.upper, shoulder, joint);
      stretch(arm.fore, joint, end);
      arm.elbow.position.copy(joint);
      // 手套接在小臂末端，朝向跟着小臂
      arm.mitten.position.copy(end);
      arm.mitten.quaternion.copy(arm.fore.quaternion);
    });
  }
}

export function loadStyle() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultStyle();
    const parsed = JSON.parse(raw);
    if (parsed.format !== 'hemu-like-gear') return defaultStyle();
    return { ...defaultStyle(), ...parsed };
  } catch {
    return defaultStyle();
  }
}
