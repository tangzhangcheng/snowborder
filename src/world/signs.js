import * as THREE from 'three';
import { INK, toonMat } from '../render/Toon.js';
import { mergeParts, paintFlat } from './scatter.js';

/** 指示牌的牌面（米）：宽、高、厚，clear 是牌面下沿离地多高。 */
export const BOARD = { width: 2.8, height: 1, thick: 0.08, clear: 1.5 };
/** 牌面贴图的像素尺寸，和牌面同样的宽高比。 */
const TEX = { width: 448, height: 160 };
/** 牌面左边难度色块的宽度（像素），和色块里图形的大小。 */
const BADGE = { width: 150, mark: 42 };
const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';

const WOOD = toonMat('#6f5340');
const FRAME = toonMat('#ffffff', { vertexColors: true });
const FRAME_GEO = frameGeometry();
const BOARD_GEO = new THREE.BoxGeometry(BOARD.width, BOARD.height, BOARD.thick);

/** 两根木桩加牌顶上的一条积雪，所有指示牌共用。 */
function frameGeometry() {
  const tall = BOARD.clear + BOARD.height + 0.12;
  const posts = [-1, 1].map((side) =>
    paintFlat(new THREE.CylinderGeometry(0.07, 0.08, tall, 6).translate(side * (BOARD.width / 2 - 0.2), tall / 2, -BOARD.thick), '#6f5340'),
  );
  const snow = paintFlat(new THREE.BoxGeometry(BOARD.width + 0.08, 0.09, BOARD.thick + 0.12).translate(0, BOARD.clear + BOARD.height + 0.045, 0), '#f4f7f8');
  return mergeParts([...posts, snow]);
}

/** 难度图形：圆、方块、菱形、双菱形，画在 (cx, cy) 处。 */
function drawMark(ctx, shape, cx, cy, size) {
  const diamond = (x) => {
    ctx.moveTo(x, cy - size);
    ctx.lineTo(x + size * 0.7, cy);
    ctx.lineTo(x, cy + size);
    ctx.lineTo(x - size * 0.7, cy);
    ctx.closePath();
  };
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(cx, cy, size, 0, Math.PI * 2);
  else if (shape === 'square') ctx.rect(cx - size * 0.85, cy - size * 0.85, size * 1.7, size * 1.7);
  else if (shape === 'diamond') diamond(cx);
  else [-0.55, 0.55].forEach((shift) => diamond(cx + shift * size));
  ctx.fill();
}

/** 把牌面画成贴图：左边难度色块和图形，右边上面一行大字、下面一行小字。 */
function boardTexture({ title, note, color, shape }) {
  const canvas = document.createElement('canvas');
  canvas.width = TEX.width;
  canvas.height = TEX.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbf8f1';
  ctx.fillRect(0, 0, TEX.width, TEX.height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, BADGE.width, TEX.height);
  ctx.fillStyle = '#ffffff';
  drawMark(ctx, shape, BADGE.width / 2, TEX.height / 2, BADGE.mark);

  const left = BADGE.width + 22;
  const room = TEX.width - left - 16;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.font = `bold 56px ${FONT}`;
  ctx.fillText(title, left, note ? 58 : TEX.height / 2, room);
  if (note) {
    ctx.fillStyle = color;
    ctx.font = `bold 36px ${FONT}`;
    ctx.fillText(note, left, 118, room);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 一块立在雪地里的指示牌，原点在两根桩子中间的地面上，牌面朝 +z。
 * @param {{ title: string, note?: string, color: string, shape: 'circle' | 'square' | 'diamond' | 'double' }} spec
 */
export function createSign(spec) {
  const sign = new THREE.Group();
  const face = toonMat('#ffffff', { map: boardTexture(spec) });
  // 六个面里只有朝前的那面贴字，其余是木头
  const board = new THREE.Mesh(BOARD_GEO, [WOOD, WOOD, WOOD, WOOD, face, WOOD]);
  board.position.y = BOARD.clear + BOARD.height / 2;
  sign.add(board, new THREE.Mesh(FRAME_GEO, FRAME));
  return sign;
}
