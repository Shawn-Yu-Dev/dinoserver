import { DINO, PHYSICS, WORLD } from './config';
import type { Box } from './collision';

/**
 * 恐龙：用“脚底 Y”（feetY）描述位置。
 * 贴地时 feetY === groundY；改变站立/蹲下形态时脚底保持不动，只改变头顶高度。
 */
export class Dino {
  feetY: number = WORLD.groundY;
  vy = 0;
  onGround = true;
  ducking = false;
  runFrame: 0 | 1 = 0;

  private jumpQueued = false;
  private runTimer = 0;

  get width(): number {
    return this.ducking ? DINO.duckWidth : DINO.standWidth;
  }

  get height(): number {
    return this.ducking ? DINO.duckHeight : DINO.standHeight;
  }

  get top(): number {
    return this.feetY - this.height;
  }

  reset(): void {
    this.feetY = WORLD.groundY;
    this.vy = 0;
    this.onGround = true;
    this.ducking = false;
    this.jumpQueued = false;
    this.runFrame = 0;
    this.runTimer = 0;
  }

  /** 记录一次起跳请求；真正起跳在下一次 update 中、且位于地面时生效。 */
  queueJump(): void {
    this.jumpQueued = true;
  }

  update(dt: number, duckHeld: boolean): void {
    // 1. 起跳：只能在地面起跳，且起跳时恢复站立形态
    if (this.jumpQueued && this.onGround) {
      this.vy = PHYSICS.jumpVelocity;
      this.onGround = false;
      this.ducking = false;
    }
    this.jumpQueued = false;

    if (this.onGround) {
      // 2a. 地面：根据 ↓ 键切换蹲下形态，脚底保持贴地
      this.ducking = duckHeld;
      this.feetY = WORLD.groundY;
      this.vy = 0;

      // 跑步腿部动画：每 0.1 秒切换一帧
      this.runTimer += dt;
      if (this.runTimer >= 0.1) {
        this.runTimer = 0;
        this.runFrame = this.runFrame === 0 ? 1 : 0;
      }
      return;
    }

    // 2b. 空中：重力积分；按住 ↓ 时加速下落
    const gravity = PHYSICS.gravity * (duckHeld ? PHYSICS.fastFallMultiplier : 1);
    this.vy += gravity * dt;
    this.feetY += this.vy * dt;

    // 3. 落地检测：脚底触到地面即复位
    if (this.feetY >= WORLD.groundY) {
      this.feetY = WORLD.groundY;
      this.vy = 0;
      this.onGround = true;
    }
  }

  /** 碰撞盒：按 hitboxInset 内缩，减少“擦边即死”的挫败感。 */
  hitbox(): Box {
    const inset = PHYSICS.hitboxInset;
    return {
      x: DINO.x + inset,
      y: this.top + inset,
      w: this.width - inset * 2,
      h: this.height - inset * 2,
    };
  }
}
