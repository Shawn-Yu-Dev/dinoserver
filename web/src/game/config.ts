// 游戏常量。所有物理量单位：像素、秒。

/** 画布逻辑尺寸与地面位置。 */
export const WORLD = {
  width: 800,
  height: 240,
  groundY: 200,
} as const;

/** 物理与难度参数。 */
export const PHYSICS = {
  gravity: 2600, // px/s²
  fastFallMultiplier: 2.5, // 空中按下 ↓ 时的加速倍数
  jumpVelocity: -780, // 起跳初速度（负值向上）
  initialSpeed: 340, // px/s
  maxSpeed: 980,
  acceleration: 10, // px/s 每秒的加速度
  scorePerPixel: 0.04, // 行进距离 → 分数的换算系数
  birdUnlockScore: 350, // 达到该分数后才会出现飞鸟
  birdChance: 0.25,
  spawnGapMin: 0.75, // 障碍间距下限（秒·速度），保证玩家有反应时间
  spawnGapRange: 0.9,
  hitboxInset: 6, // 碰撞盒各边内缩像素，让判定更宽容
} as const;

/** 恐龙尺寸与位置。 */
export const DINO = {
  x: 50,
  standWidth: 44,
  standHeight: 50,
  duckWidth: 62,
  duckHeight: 28,
} as const;
