// 像素风绘制：全部使用矩形拼装，不依赖外部图片资源。
import { DINO, WORLD } from './config';
import type { Dino } from './dino';
import type { Obstacle } from './obstacles';

export const COLORS = {
  bg: '#0b110c',
  fg: '#8dff9f',
  dim: '#2f6b3c',
  accent: '#ffb000',
} as const;

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string = COLORS.fg): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

export function drawGround(ctx: CanvasRenderingContext2D, pebbles: readonly number[]): void {
  rect(ctx, 0, WORLD.groundY + 1, WORLD.width, 2, COLORS.dim);
  for (const x of pebbles) {
    rect(ctx, x, WORLD.groundY + 6, 4, 2, COLORS.dim);
    rect(ctx, x + 10, WORLD.groundY + 10, 2, 2, COLORS.dim);
  }
}

export function drawDino(ctx: CanvasRenderingContext2D, dino: Dino): void {
  const x = DINO.x;
  const top = dino.top;
  const eyeBg = COLORS.bg;

  if (dino.ducking) {
    // 蹲下形态：横向拉长的身体
    rect(ctx, x + 4, top + 6, 46, 14);
    rect(ctx, x + 42, top + 2, 18, 10);
    rect(ctx, x + 52, top + 4, 4, 4, eyeBg);
    const legY = top + 20;
    if (dino.runFrame === 0) {
      rect(ctx, x + 14, legY, 8, 8);
      rect(ctx, x + 34, legY + 4, 8, 4);
    } else {
      rect(ctx, x + 14, legY + 4, 8, 4);
      rect(ctx, x + 34, legY, 8, 8);
    }
    return;
  }

  // 站立形态
  rect(ctx, x + 20, top, 22, 16); // 头
  rect(ctx, x + 34, top + 4, 4, 4, eyeBg); // 眼
  rect(ctx, x + 4, top + 14, 26, 18); // 身体
  rect(ctx, x, top + 18, 8, 6); // 尾巴
  if (dino.onGround && dino.runFrame === 0) {
    rect(ctx, x + 10, top + 32, 6, 18);
    rect(ctx, x + 22, top + 32, 6, 10);
  } else if (dino.onGround) {
    rect(ctx, x + 10, top + 32, 6, 10);
    rect(ctx, x + 22, top + 32, 6, 18);
  } else {
    // 空中：双腿并拢
    rect(ctx, x + 12, top + 32, 6, 18);
    rect(ctx, x + 20, top + 32, 6, 18);
  }
}

export function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle, time: number): void {
  if (o.kind === 'cactus-small' || o.kind === 'cactus-large') {
    drawCactus(ctx, o);
  } else {
    drawBird(ctx, o, time);
  }
}

function drawCactus(ctx: CanvasRenderingContext2D, o: Obstacle): void {
  const cx = o.x + o.w / 2 - 3;
  rect(ctx, cx, o.y, 6, o.h); // 主干
  rect(ctx, o.x, o.y + o.h * 0.4, 6, 8); // 左臂横段
  rect(ctx, o.x, o.y + o.h * 0.4 - 8, 6, 8); // 左臂竖段
  rect(ctx, o.x + o.w - 6, o.y + o.h * 0.5, 6, 8); // 右臂横段
  rect(ctx, o.x + o.w - 6, o.y + o.h * 0.5 - 8, 6, 8); // 右臂竖段
}

function drawBird(ctx: CanvasRenderingContext2D, o: Obstacle, time: number): void {
  const x = o.x;
  const y = o.y;
  const flapUp = Math.floor(time / 0.15) % 2 === 0;
  rect(ctx, x + 8, y + 10, 22, 10); // 身体
  rect(ctx, x + 26, y + 6, 10, 8); // 头
  rect(ctx, x + 36, y + 9, 4, 3, COLORS.accent); // 喙
  rect(ctx, x, y + 12, 8, 4); // 尾
  if (flapUp) {
    rect(ctx, x + 10, y, 12, 6);
  } else {
    rect(ctx, x + 10, y + 18, 12, 6);
  }
}
