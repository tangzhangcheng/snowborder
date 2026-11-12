export function planRoute(world, from, dest) {
  const dh = (dest.h ?? 0) - (from.h ?? 0);
  if (dh > 35) {
    let best = null;
    for (const lift of world.lifts) {
      const walk = Math.hypot(lift.bottom.x - from.x, lift.bottom.z - from.z);
      const drop = Math.hypot(lift.top.x - dest.x, lift.top.z - dest.z);
      const score = walk + drop * 0.65;
      if (!best || score < best.score) best = { lift, score, walk };
    }
    if (best && best.walk > 18) {
      return {
        mode: 'to-lift',
        via: best.lift,
        points: [from, best.lift.bottom],
        hint: `先去 ${best.lift.name}`,
      };
    }
  }
  return {
    mode: 'direct',
    via: null,
    points: [from, dest],
    hint: `前往 ${dest.name}`,
  };
}
