import { PHYSICS, WORLD } from './config';
import type { Box } from './collision';

export type ObstacleKind = 'cactus-small' | 'cactus-large' | 'bird-low' | 'bird-mid';

interface Shape {
  w: number;
  h: number;
  /** 顶部 Y（相对画布）。仙人掌贴地，飞鸟按高度定义。 */
  top: (groundY: number, h: number) => number;
}

/**
 * 障碍形态：
 * - 仙人掌：必须起跳躲避。
 * - bird-low：位于站立头部高度，必须蹲下躲避。
 * - bird-mid：贴近地面，必须起跳躲避（蹲下无效）。
 */
export const SHAPES: Record<ObstacleKind, Shape> = {
  'cactus-small': { w: 18, h: 40, top: (g, h) => g - h },
  'cactus-large': { w: 26, h: 56, top: (g, h) => g - h },
  'bird-low': { w: 40, h: 28, top: (g) => g - 63 },
  'bird-mid': { w: 40, h: 28, top: (g) => g - 40 },
};

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

const CACTI: ObstacleKind[] = ['cactus-small', 'cactus-large'];
const BIRDS: ObstacleKind[] = ['bird-low', 'bird-mid'];

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** 按当前分数决定生成哪种障碍：飞鸟只在解锁后出现。 */
export function randomKind(score: number): ObstacleKind {
  const birdAllowed = score >= PHYSICS.birdUnlockScore;
  if (birdAllowed && Math.random() < PHYSICS.birdChance) {
    return pick(BIRDS);
  }
  return pick(CACTI);
}

export function createObstacle(kind: ObstacleKind): Obstacle {
  const shape = SHAPES[kind];
  return {
    kind,
    x: WORLD.width + 10,
    w: shape.w,
    h: shape.h,
    y: shape.top(WORLD.groundY, shape.h),
  };
}

/** 两次生成之间的距离（像素）：与速度成正比，保证高速时仍可反应。 */
export function nextSpawnGap(speed: number): number {
  return speed * (PHYSICS.spawnGapMin + Math.random() * PHYSICS.spawnGapRange);
}

export function obstacleBox(o: Obstacle): Box {
  const inset = 4;
  return { x: o.x + inset, y: o.y + inset, w: o.w - inset * 2, h: o.h - inset * 2 };
}
