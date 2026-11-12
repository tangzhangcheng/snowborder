import * as THREE from 'three';
import { DEFAULT_TECHNIQUE, TECHNIQUES } from './techniques.js';

const G = 9.81;
const HOVER = 0.05;
/** 刹车时板子整个横过来的角度（弧度）。 */
const BRAKE_SKID = 1.25;
/** 刹车把速度压到这个以下（米/秒）就算刹停了。 */
const PARK_SPEED = 0.6;
/** 蓄力跳按满要多少秒。 */
export const MAX_CHARGE = 0.7;
/** 松开跳跃键到板子离地要多少秒：这段时间腿在蹬伸，人还踩在雪上，蹬到头才离地。 */
export const POP_SECONDS = 0.12;
/** 蹬伸结束时垂直雪面的离地速度（米/秒）：轻点一下，和蓄满力。人的腿加上板子的弹性也就这么多。 */
const POP_SPEED = [2, 4.2];
/**
 * 起跳时借着雪面甩出来的转速（弧度/秒，按身体张开时算）：轻点一下，和蓄满力。
 * 离地以后没有外力矩，角动量守恒——空中既加不了转也刹不住，只能靠收紧、张开身体改变转速。
 */
const SPIN_THROW = [1.6, 4.2];
/** 起跳前正在走刃拐弯的话，身体已有的转动有几成带到空中。 */
const SPIN_CARRY = 0.5;
/** 空中把手脚收紧，转动惯量变小，转速是张开时的这么多倍。 */
const TUCK_SPIN_GAIN = 1.6;
/** 手脚收紧、张开的快慢（每秒）。 */
const AIR_TUCK_RATE = 7;
/**
 * 反拧：没有转动时在空中按方向键，下身带着板子拧过去、上身朝反方向拧，总角动量还是零。
 * spin 是转速低于多少（弧度/秒）才算"没在转"，angle 是板子最多拧过去多少弧度，rate 是拧的快慢（每秒）。
 */
const SHIFTY = { spin: 0.8, angle: 0.9, rate: 8 };
/** 板子横在雪上搓的减速度（米/秒²）：刹车、落地横滑都是它。 */
const SCRUB_DECEL = 7.5;
/** 横滑的板子被雪面拧回行进方向的快慢（每秒）。 */
const SKID_RATE = 9;
/** 落地时垂直雪面的速度超过这个（米/秒）腿就吃不住，直接摔。 */
const HARD_LANDING = 11;
/**
 * 找落点：转体快落地时，下身带着板子提前拧向落地那一刻离得最近的顺向（正脚或反脚），和反拧是同一个动作。
 * seconds 是离落地多久开始拧，angle 是最多能拧多少弧度——差得比这还多就只能横着落了。
 */
const LANDING_PREP = { seconds: 0.35, angle: 0.45 };
/** 板子横着落地时，水平速度超过这个（米/秒）才会卡刃摔倒。 */
const CATCH_SPEED = 8;
/** 落地时水平速度低于这个（米/秒）就谈不上行进方向，板头朝哪就往哪走。 */
const MIN_TRAVEL_SPEED = 2;
const WIPEOUT_SECONDS = 1.3;
/** 人占的圆的半径，用来和树、房子算碰撞。 */
const BODY_RADIUS = 0.35;
/** 迎面撞上去的速度超过这个就摔（米/秒，约 20 km/h）。 */
const CRASH_SPEED = 5.5;
/** 轻轻蹭一下不值得出声，超过这个才算一次碰撞。 */
const BUMP_SPEED = 1.5;
/** 撞上边界后垂直于墙的速度保留多少。 */
const WALL_BOUNCE = 0.2;
/** 两次“到边界了”提醒之间至少隔这么久。 */
const EDGE_NOTICE_SECONDS = 4;
/** 停在坡上时板头自己摆回滚落线的角速度上限（弧度/秒）。 */
const FALL_LINE_RATE = 2.2;
/** 低于前者全力回摆，到后者完全不管，不干扰正常滑行。 */
const FALL_LINE_SPEED = [1, 4];
/** 坡度正弦：比前者还平就不回摆，到后者回摆力度拉满。 */
const FALL_LINE_SLOPE = [0.04, 0.2];

const SURFACE = {
  groomed: { grip: 0.95, drag: 1 },
  powder: { grip: 0.7, drag: 1.7 },
  crust: { grip: 0.5, drag: 0.85 },
};

function wrap(a) {
  const t = Math.PI * 2;
  let r = (a + Math.PI) % t;
  if (r < 0) r += t;
  return r - Math.PI;
}

function smooth(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 运动学单板。
 * yaw 是板子的走向：前进方向 = (sin yaw, cos yaw)；yaw 减小 = 向右转。
 * 板头实际指向哪里看 heading：横滑时偏开一个 skid 角，反脚（switch）时板尾朝前。
 * 立刃多深、咬得多死、跳得多高这些手感跟着滑行风格走，见 techniques.js。
 * input: { edge(-1 左..1 右), tuck, brake, jump(按住), turn, forward, run }
 */
export class SnowboardMotor {
  constructor(terrain, pistes, spawn, inset, obstacles = null) {
    this.terrain = terrain;
    this.pistes = pistes;
    this.obstacles = obstacles;
    this.spawn = { ...spawn };
    this.inset = inset;
    this.events = [];
    this.feel = TECHNIQUES[DEFAULT_TECHNIQUE].motor;
    this.reset(spawn);
  }

  /** 换一种滑行风格的手感（TECHNIQUES 里某一项的 motor）。 */
  setFeel(feel) {
    this.feel = feel;
  }

  /** 这种风格立刃最深到多少弧度。 */
  get maxEdge() {
    return this.feel.maxEdge;
  }

  reset(spawn = this.spawn) {
    this.x = spawn.x;
    this.z = spawn.z;
    this.yaw = spawn.yaw ?? 0;
    this.y = this.terrain.heightAt(this.x, this.z) + HOVER;
    this.vx = Math.sin(this.yaw) * 2.5;
    this.vy = 0;
    this.vz = Math.cos(this.yaw) * 2.5;
    this.edge = 0;
    this.skid = 0;
    this.switch = false;
    // 刹停：parked 表示正横着板站在原地；parkArmed 表示停下以后方向键松开过
    this.parked = false;
    this.parkArmed = false;
    this.charge = 0;
    // 蹬伸：popPower 大于 0 表示正在蹬（数值是蓄了几成力），popTime 是已经蹬了多久
    this.popPower = 0;
    this.popTime = 0;
    this.onGround = true;
    this.slip = 0;
    this.speed = 2.5;
    this.wipeout = 0;
    this.airTime = 0;
    this.airSpin = 0;
    // 转体：yawRate 是在雪上拐弯的角速度；spin 是带到空中的转动（按身体张开时的转速记），
    // airTuck 是空中收紧了几成，spinRate 是此刻实际的转速
    this.yawRate = 0;
    this.spin = 0;
    this.airTuck = 0;
    this.spinRate = 0;
    this.surface = 'groomed';
    this.tucking = false;
    this.edgeNotice = 0;
    this.contact = null;
    this.mode = 'ride';
  }

  /** 脚下的雪：压雪道、粉雪，或陡坡上的硬壳。 */
  surfaceAt(sample) {
    if (sample.slope > 0.68) return 'crust';
    const hit = this.pistes.locate(this.x, this.z);
    return hit?.piste.groomed ? 'groomed' : 'powder';
  }

  /** 板头实际指向的方位角。 */
  get heading() {
    return this.yaw + this.skid + (this.switch ? Math.PI : 0);
  }

  step(input, dt) {
    // 下过板再踩上去，总是正脚，蹬到一半的起跳、刹停的状态也作废
    if (this.mode !== 'ride') {
      this.switch = false;
      this.popPower = 0;
      this.parked = false;
    }
    if (this.mode === 'lift' || this.mode === 'drive') return;
    if (this.wipeout > 0) this.wipeout = Math.max(0, this.wipeout - dt);
    if (this.edgeNotice > 0) this.edgeNotice -= dt;
    if (this.mode === 'walk') {
      this.stepWalk(input, dt);
      return;
    }
    const down = this.wipeout > 0;
    this.tucking = Boolean(input.tuck) && !input.brake && !down;
    const target = (down ? 0 : input.edge) * this.feel.maxEdge;
    this.edge += (target - this.edge) * (1 - Math.exp(-this.feel.edgeResponse * dt));

    if (this.onGround) this.stepJump(input, dt, down);
    if (this.onGround) this.stepGround(input, dt);
    else this.stepAir(input, dt);
    this.touchWorld();
    this.speed = Math.hypot(this.vx, this.vy, this.vz);
  }

  /**
   * 边界和障碍都算一遍，记下这一步贴着的那个面（法线朝外），下一步找滚落线时要绕开它。
   * 边界和紧挨着它的树会夹出死角，坡又朝角里倒时谁也出不来，所以贴着边界时不算障碍。
   */
  touchWorld() {
    this.contact = this.keepInside() ?? this.collide();
  }

  stepWalk(input, dt) {
    this.yaw = wrap(this.yaw - input.turn * 2 * dt);
    const pace = input.brake ? 0 : input.forward * (input.run ? 4.4 : 1.8);
    this.vx = Math.sin(this.yaw) * pace;
    this.vz = Math.cos(this.yaw) * pace;
    this.vy = 0;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y = this.terrain.heightAt(this.x, this.z) + HOVER;
    this.onGround = true;
    this.edge = 0;
    this.skid = 0;
    this.slip = 0;
    this.touchWorld();
    this.speed = pace;
  }

  /**
   * 起跳分三段：按住蓄力（下蹲）→ 松开后蹬伸 → 蹬到头离地。
   * 蹬伸要时间：这一下人还踩在雪上，雪面的反作用力把人推起来，腿伸直了才离地。
   */
  stepJump(input, dt, down) {
    if (this.popPower > 0) {
      this.popTime += dt;
      if (down) this.popPower = 0;
      else if (this.popTime >= POP_SECONDS) this.launch(this.popPower, input.edge);
      return;
    }
    if (input.jump && !down) {
      this.charge = Math.min(MAX_CHARGE, this.charge + dt);
      return;
    }
    if (this.charge <= 0) return;
    if (!down) {
      this.popPower = this.charge / MAX_CHARGE;
      this.popTime = 0;
    }
    this.charge = 0;
  }

  /**
   * 蹬伸结束、板子离地。雪面只能垂直于坡面推人，所以离地速度加在法线方向上。
   * turn 是这一刻的转向输入（-1 左..1 右）：转体的转动也是这时候借着雪面甩出来的。
   */
  launch(power, turn) {
    const n = this.terrain.sample(this.x, this.z).normal;
    const pop = THREE.MathUtils.lerp(POP_SPEED[0], POP_SPEED[1], power) * this.feel.pop;
    this.vx += n.x * pop;
    this.vy += n.y * pop;
    this.vz += n.z * pop;
    this.takeOff(-turn * THREE.MathUtils.lerp(SPIN_THROW[0], SPIN_THROW[1], power) * this.feel.spin);
    this.events.push({ type: 'jump', power });
  }

  /** 离开雪面。thrown 是起跳时主动甩出来的转速；正在拐弯的话，原有的转动也带一部分上去。 */
  takeOff(thrown = 0) {
    this.y += 0.06;
    this.onGround = false;
    this.parked = false;
    this.airTime = 0;
    this.airSpin = 0;
    this.popPower = 0;
    this.spin = this.yawRate * SPIN_CARRY + thrown;
    this.airTuck = 0;
  }

  /**
   * 空中的转动。角动量是离地那一刻定下来的，这里只有两件事能做：
   * 转着的时候按住同方向（或收腿键）把身体收紧，转得更快，松开就张开减速；
   * 没在转的时候按方向键是反拧，板子拧过去一个角度，松开又回来。
   */
  stepSpin(input, dt) {
    const spinning = Math.abs(this.spin) > SHIFTY.spin;
    // edge 为正是向右，对应 yaw 减小，所以输入和转动同向时两者异号
    const pulling = spinning && input.edge * this.spin < 0;
    const tuck = input.tuck || pulling ? 1 : 0;
    this.airTuck += (tuck - this.airTuck) * (1 - Math.exp(-AIR_TUCK_RATE * dt));
    this.spinRate = this.spin * THREE.MathUtils.lerp(1, TUCK_SPIN_GAIN, this.airTuck);
    this.yaw = wrap(this.yaw + this.spinRate * dt);
    this.airSpin += Math.abs(this.spinRate * dt);
    this.skid += (this.boardTwist(input, spinning) - this.skid) * (1 - Math.exp(-SHIFTY.rate * dt));
  }

  /**
   * 离脚下的雪面还有多远：closing 是此刻朝雪面去的速度（米/秒，往上升时为负），
   * seconds 是按抛物线算还有几秒落到这片坡面上。
   */
  approach() {
    const sample = this.terrain.sample(this.x, this.z);
    const n = sample.normal;
    const gap = Math.max(0, (this.y - sample.height) * n.y);
    const closing = -(this.vx * n.x + this.vy * n.y + this.vz * n.z);
    // 只有重力垂直于坡面的那部分在把人往雪面上拉
    const pull = G * n.y;
    return { closing, seconds: (Math.sqrt(closing * closing + 2 * pull * gap) - closing) / pull };
  }

  /** 空中板子相对身体该拧到哪（弧度）：快落地了就对准落点，否则没在转体时听方向键的（反拧）。 */
  boardTwist(input, spinning) {
    const { seconds } = this.approach();
    if (seconds <= LANDING_PREP.seconds) return this.landingTwist(seconds);
    return spinning ? 0 : -input.edge * SHIFTY.angle;
  }

  /** 还有 seconds 秒落地，板子该提前拧多少（弧度）：按落地那一刻身体会转到的朝向，对准离得最近的顺向。 */
  landingTwist(seconds) {
    if (Math.hypot(this.vx, this.vz) <= MIN_TRAVEL_SPEED) return 0;
    const facing = this.yaw + this.spinRate * seconds;
    let off = wrap(facing - Math.atan2(this.vx, this.vz));
    if (Math.abs(off) > Math.PI / 2) off = wrap(off + Math.PI);
    return THREE.MathUtils.clamp(-off, -LANDING_PREP.angle, LANDING_PREP.angle);
  }

  stepAir(input, dt) {
    this.vy -= G * dt;
    this.airTime += dt;
    if (this.wipeout <= 0) this.stepSpin(input, dt);
    const keep = 1 - Math.min(0.4, 0.0016 * Math.hypot(this.vx, this.vy, this.vz) * dt);
    this.vx *= keep;
    this.vy *= keep;
    this.vz *= keep;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.slip = 0;
    const sample = this.terrain.sample(this.x, this.z);
    if (this.y > sample.height + HOVER) return;
    this.land(sample);
  }

  /** 落地：板子顺着行进方向（正脚或反脚）算站稳；横着落要搓一段才正过来，又横又快就摔；砸得太狠也摔。 */
  land(sample) {
    const impact = this.hitSnow(sample.normal);
    const fast = Math.hypot(this.vx, this.vz) > CATCH_SPEED;
    const skew = this.alignBoard();
    const tolerance = this.feel.landing;
    const slammed = impact > HARD_LANDING || (skew > tolerance.catch && fast);
    if (slammed) this.slam();
    if (this.airTime > 0.45) {
      const clean = !slammed && skew < tolerance.clean;
      this.events.push({ type: 'land', spin: THREE.MathUtils.radToDeg(this.airSpin), air: this.airTime, clean, switch: this.switch });
    }
    // 每次板子拍回雪面都报一下，声音用
    this.events.push({ type: 'touch', impact });
    this.y = sample.height + HOVER;
    this.onGround = true;
    this.yawRate = 0;
    this.spin = 0;
    this.spinRate = 0;
    this.airTuck = 0;
  }

  /** 雪面挡住垂直于它的那部分速度。返回砸上去的速度（米/秒）。 */
  hitSnow(normal) {
    const vn = this.vx * normal.x + this.vy * normal.y + this.vz * normal.z;
    if (vn >= 0) return 0;
    this.vx -= normal.x * vn;
    this.vy -= normal.y * vn;
    this.vz -= normal.z * vn;
    return -vn;
  }

  /**
   * 落地时板子和行进方向对不上：行进方向是动量决定的，一下子改不了，被拧过来的是板子。
   * 所以走向交还给行进方向，差的那个角度记成横滑角，由板子在雪上搓着转回去；
   * 板尾朝前落下来就是反脚。返回板子横过来多少（弧度，0 到 π/2）。
   */
  alignBoard() {
    const board = this.yaw + this.skid;
    if (Math.hypot(this.vx, this.vz) <= MIN_TRAVEL_SPEED) {
      this.yaw = wrap(board);
      this.skid = 0;
      return 0;
    }
    const travel = Math.atan2(this.vx, this.vz);
    let off = wrap(board - travel);
    if (Math.abs(off) > Math.PI / 2) {
      this.switch = !this.switch;
      off = wrap(off + Math.PI);
    }
    this.yaw = travel;
    this.skid = off;
    return Math.abs(off);
  }

  /** 摔倒：人拍在雪上，速度一下掉一大截。 */
  slam() {
    this.wipeout = WIPEOUT_SECONDS;
    this.vx *= 0.35;
    this.vy *= 0.35;
    this.vz *= 0.35;
    this.edge = 0;
  }

  stepGround(input, dt) {
    const sample = this.terrain.sample(this.x, this.z);
    const n = sample.normal;
    this.surface = this.surfaceAt(sample);
    const surface = SURFACE[this.surface];
    const down = this.wipeout > 0;
    const vel = new THREE.Vector3(this.vx, this.vy, this.vz).projectOnPlane(n);
    const speed = vel.length();
    const edgeAbs = Math.abs(this.edge);
    const braking = input.brake && !down;
    if (this.updatePark(input, braking, speed)) {
      this.stayParked(sample, dt);
      return;
    }

    // 正贴着树或墙：原地拧板只会在原地打转，这时交给滚落线把板头带开
    const pinned = Boolean(this.contact);

    const feel = this.feel;
    // 立刃立到了这种风格的几成
    const edged = edgeAbs / feel.maxEdge;

    // 转向：沿板刃弧线走；抓地力不够时半径自动放大；很慢时允许原地拧板
    let yawRate = 0;
    if (edgeAbs > 0.03 && !down) {
      const carve = speed / (feel.sidecut / Math.sin(Math.min(edgeAbs, 1.4)));
      const gripLimit = (surface.grip * feel.grip * G * Math.max(n.y, 0.2)) / Math.max(speed, 1.5);
      const pivot = pinned ? 0 : (1 - smooth(...feel.pivotFade, speed)) * feel.pivot * edged;
      yawRate = -Math.sign(this.edge) * Math.max(Math.min(carve, gripLimit), pivot);
    }
    this.yawRate = yawRate;
    const dyaw = yawRate * dt;
    vel.applyAxisAngle(n, dyaw);
    this.yaw = wrap(this.yaw + dyaw);
    // 没在压刃也没在刹车：板头朝山上或横在坡上停住时，让它自己摆回下坡方向
    if (!braking && !down && (input.edge === 0 || pinned)) this.yaw = wrap(this.yaw + this.fallLineRate(n, speed) * dt);

    const gn = -G * n.y;
    vel.addScaledVector(new THREE.Vector3(-n.x * gn, -G - n.y * gn, -n.z * gn), dt);

    const { forward, right } = this.axes(this.yaw, n);
    let along = vel.dot(forward);
    let across = vel.dot(right);
    // 板子横在行进方向上几成：刹车时是整个横过来，落地没对正时按横滑角算
    const scrub = braking ? 1 : Math.abs(Math.sin(this.skid));
    this.slip = Math.abs(across) + speed * 0.5 * scrub;

    // 板刃咬雪：横向速度很快被吃掉，立刃越深咬得越死
    const bite = down ? 2 : THREE.MathUtils.lerp(5, 12, smooth(0, 0.4, edgeAbs));
    across *= Math.exp(-bite * dt);

    const air = (input.tuck && !braking ? 0.0026 : 0.0042) * surface.drag * along * along;
    let decel = 0.03 * G * Math.max(n.y, 0.2) * surface.drag + air + edged * feel.edgeDrag;
    decel += SCRUB_DECEL * scrub;
    if (down) decel += 4;
    const loss = decel * dt;
    along = Math.abs(along) <= loss ? 0 : along - Math.sign(along) * loss;
    // 平地上按住 W 可以蹬板起步
    if (input.tuck && !braking && !down && along < 4.5) along += 3.2 * dt;

    this.skid += (this.skidTarget(braking, down, speed) - this.skid) * (1 - Math.exp(-SKID_RATE * dt));

    vel.copy(forward).multiplyScalar(along).addScaledVector(right, across);
    this.x += vel.x * dt;
    this.z += vel.z * dt;
    const next = this.terrain.sample(this.x, this.z);
    const before = vel.y;
    vel.projectOnPlane(next.normal);
    // 冲过坡顶：地面下落得比重力还快，就腾空
    if (speed > 12 && !down && (before - vel.y) / dt > G * 1.35) {
      this.vx = vel.x;
      this.vy = before;
      this.vz = vel.z;
      this.takeOff();
      return;
    }
    this.y = next.height + HOVER;
    this.vx = vel.x;
    this.vy = vel.y;
    this.vz = vel.z;
    this.onGround = true;
  }

  /**
   * 刹停：刹车把速度压没了以后就横着板站在原地，重力不会再把人带走，
   * 直到玩家重新给出起步的操作——收腿蹬板、起跳，或者压刃把板头拧下去。
   * 刹车时一直压着的方向键不算起步，得松开再按：不然先松刹车、后松方向键的那一瞬间又滑出去了。
   * 返回这一步是不是停着。
   */
  updatePark(input, braking, speed) {
    if (!this.parked) {
      if (!braking || speed > PARK_SPEED) return false;
      this.parked = true;
      this.parkArmed = false;
    }
    if (!input.edge) this.parkArmed = true;
    const go = input.tuck || input.jump || (input.edge && this.parkArmed);
    if (go && !input.brake) this.parked = false;
    return this.parked;
  }

  /** 刹停时的一步：速度清零，板子保持横着，并慢慢摆到横对着坡。 */
  stayParked(sample, dt) {
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.slip = 0;
    this.yaw = wrap(this.yaw + this.acrossSlopeRate(sample.normal) * dt);
    this.skid += (this.skidTarget(true, false, 0) - this.skid) * (1 - Math.exp(-SKID_RATE * dt));
    this.y = sample.height + HOVER;
  }

  /**
   * 刹停在坡上时把板子摆到横对着坡的角速度（弧度/秒）：
   * 斜着切坡时刹停，板头可能正朝着山下，停在那儿却不往下滑看着是假的。
   */
  acrossSlopeRate(normal) {
    const steep = smooth(FALL_LINE_SLOPE[0], FALL_LINE_SLOPE[1], Math.hypot(normal.x, normal.z));
    if (steep <= 0) return 0;
    // 横对着坡有两个朝向，取离板子现在近的那个
    let off = wrap(Math.atan2(normal.x, normal.z) + Math.PI / 2 - (this.yaw + this.skid));
    if (Math.abs(off) > Math.PI / 2) off = wrap(off + Math.PI);
    return THREE.MathUtils.clamp(off * 3, -FALL_LINE_RATE, FALL_LINE_RATE) * steep;
  }

  /** 刹车时板头往哪边横：停住以后不再换边，滑着的时候跟着压刃的方向。 */
  brakeSide() {
    if (this.parked && this.skid !== 0) return Math.sign(this.skid);
    return this.edge < -0.05 ? -1 : 1;
  }

  /**
   * 板子该横过来多少（弧度，和 yaw 同向为正）。只是板头相对行进方向的偏角，不改行进方向：
   * 刹车时整个横过来，刹停了也一直横着；搓雪转弯的风格里，转弯时板头比行进方向多拧进弯里一点；
   * 都不是的话是 0，雪面的摩擦会把板子拧回行进方向。
   */
  skidTarget(braking, down, speed) {
    if (down) return 0;
    if (braking) return this.brakeSide() * BRAKE_SKID;
    if (speed <= 1.5) return 0;
    const feel = this.feel;
    if (!feel.steerSkid) return 0;
    // edge 为正是向右转，对应 yaw 减小，所以板头拧进弯里是负的
    return (-this.edge / feel.maxEdge) * feel.steerSkid * smooth(...feel.skidFade, speed);
  }

  /**
   * 板头摆向滚落线的角速度。
   * 平板停在坡上时板头朝山上或横着，重力要么被蹬板抵消、要么被板刃吃掉，人就原地不动了；
   * 真实的板子松开刃后板头会自己往下掉，这里只在低速时补上这一下。
   */
  fallLineRate(normal, speed) {
    const wall = this.contact;
    // 板头正顶着树或墙：不管坡陡不陡都要转开
    const blocked = wall && Math.sin(this.yaw) * wall.nx + Math.cos(this.yaw) * wall.nz < 0;
    const steep = blocked ? 1 : smooth(FALL_LINE_SLOPE[0], FALL_LINE_SLOPE[1], Math.hypot(normal.x, normal.z));
    const slow = 1 - smooth(FALL_LINE_SPEED[0], FALL_LINE_SPEED[1], speed);
    const limit = FALL_LINE_RATE * steep * slow;
    if (limit <= 0) return 0;
    const off = wrap(this.rollDirection(normal) - this.yaw);
    return THREE.MathUtils.clamp(off * 3, -limit, limit);
  }

  /**
   * 一个球放在这儿会往哪个方位滚：平时就是下坡方向；
   * 正贴着树或墙、下坡又被它挡住时，就是顺着它表面往下的那个方向。
   */
  rollDirection(normal) {
    const wall = this.contact;
    // 平地上没有“下坡”，贴着墙时就拿板头现在的朝向来算
    const flat = Math.hypot(normal.x, normal.z) < FALL_LINE_SLOPE[0];
    let dx = wall && flat ? Math.sin(this.yaw) : normal.x;
    let dz = wall && flat ? Math.cos(this.yaw) : normal.z;
    const into = wall ? dx * wall.nx + dz * wall.nz : 0;
    if (into < 0) {
      dx -= into * wall.nx;
      dz -= into * wall.nz;
      // 正对着障碍，两边一样陡：随便挑一边
      if (Math.hypot(dx, dz) < 1e-3) return Math.atan2(-wall.nz, wall.nx);
    }
    return Math.atan2(dx, dz);
  }

  axes(yaw, normal) {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).projectOnPlane(normal);
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
    return { forward, right };
  }

  /**
   * 雪场四周是看不见的墙：撞上就弹回来，并提醒一次。
   * 返回贴着的墙面 { nx, nz }（法线朝场内），没碰到返回 null。
   */
  keepInside() {
    const min = this.inset;
    const max = this.terrain.worldSize - this.inset;
    // 指向场内的方向：撞西墙 +1，撞东墙 -1，没撞 0
    const inX = this.x < min ? 1 : this.x > max ? -1 : 0;
    const inZ = this.z < min ? 1 : this.z > max ? -1 : 0;
    if (!inX && !inZ) return null;
    const into = Math.max(-inX * this.vx, -inZ * this.vz);
    if (inX) {
      this.x = inX > 0 ? min : max;
      this.vx = inX * Math.abs(this.vx) * WALL_BOUNCE;
    }
    if (inZ) {
      this.z = inZ > 0 ? min : max;
      this.vz = inZ * Math.abs(this.vz) * WALL_BOUNCE;
    }
    // 角落里两面墙都碰到，法线取对角方向
    const corner = Math.hypot(inX, inZ);
    const wall = { nx: inX / corner, nz: inZ / corner };
    if (this.mode === 'ride') {
      this.y = this.terrain.heightAt(this.x, this.z) + HOVER;
      if (into > BUMP_SPEED) this.faceAway(wall);
    }
    if (this.edgeNotice > 0) return wall;
    this.edgeNotice = EDGE_NOTICE_SECONDS;
    this.events.push({ type: 'edge' });
    return wall;
  }

  /**
   * 冲着墙撞上去时板头按墙面镜像回来，像被弹开一样。
   * 只在真撞上时这么做：慢慢贴着的时候要让板头自由转，才能顺着墙面滑走。
   */
  faceAway(wall) {
    const facing = Math.sin(this.yaw) * wall.nx + Math.cos(this.yaw) * wall.nz;
    if (facing >= 0) return;
    this.yaw = Math.atan2(Math.sin(this.yaw) - 2 * facing * wall.nx, Math.cos(this.yaw) - 2 * facing * wall.nz);
  }

  /**
   * 撞到树、房子、塔柱：先推出来；迎面撞得狠就摔，斜着蹭只是被弹开。
   * 返回碰到的面，没碰到返回 null。
   */
  collide() {
    if (!this.obstacles) return null;
    const above = this.onGround ? 0 : this.y - this.terrain.heightAt(this.x, this.z);
    const hit = this.obstacles.hit(this.x, this.z, BODY_RADIUS, above);
    if (!hit) return null;
    this.x += hit.nx * hit.depth;
    this.z += hit.nz * hit.depth;
    if (this.onGround) this.y = this.terrain.heightAt(this.x, this.z) + HOVER;
    // 步行的速度每步都重算，推出来就够了
    if (this.mode === 'walk') return hit;
    const into = -(this.vx * hit.nx + this.vz * hit.nz);
    if (into > 0) this.bounceOff(hit, into);
    return hit;
  }

  /** 把撞进障碍的那部分速度弹回去；撞得够快板头也跟着弹开。 */
  bounceOff(hit, into) {
    const crash = into > CRASH_SPEED && this.wipeout <= 0;
    const kick = into * (crash ? 1.25 : 1.1);
    this.vx += hit.nx * kick;
    this.vz += hit.nz * kick;
    if (into > BUMP_SPEED) this.faceAway(hit);
    if (crash) {
      this.wipeout = WIPEOUT_SECONDS;
      this.edge = 0;
      this.vx *= 0.4;
      this.vy *= 0.4;
      this.vz *= 0.4;
    }
    if (crash || into > BUMP_SPEED) this.events.push({ type: crash ? 'crash' : 'bump', speed: into });
  }

  place(x, y, z, yaw) {
    this.x = x;
    this.y = y;
    this.z = z;
    if (yaw != null) this.yaw = yaw;
  }
}
