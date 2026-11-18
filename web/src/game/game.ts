import { intersects } from './collision';
import { PHYSICS, WORLD } from './config';
import { Dino } from './dino';
import {
  createObstacle,
  nextSpawnGap,
  obstacleBox,
  randomKind,
  type Obstacle,
} from './obstacles';
import { COLORS, drawDino, drawGround, drawObstacle } from './sprites';

export interface GameCallbacks {
  /** 分数变化时调用（整数）。 */
  onScore: (score: number) => void;
  /** 游戏结束时调用，参数为最终分数。 */
  onGameOver: (score: number) => void;
  /** 每局开始时调用。 */
  onStart?: () => void;
}

type GameState = 'ready' | 'running' | 'over';

/** 游戏结束后需等待的毫秒数，防止误触立即重开。 */
const RESTART_COOLDOWN_MS = 600;
/** 单帧最大时间步长（秒），防止切后台回来时物理爆炸。 */
const MAX_FRAME_DT = 1 / 30;

/**
 * 恐龙跳跃游戏主循环。
 * 逻辑在固定坐标系（800×240）中运行，画布 CSS 尺寸由样式缩放，并按 devicePixelRatio 保持清晰。
 */
export class DinoGame {
  private readonly ctx: CanvasRenderingContext2D;
  private state: GameState = 'ready';
  private dino = new Dino();
  private obstacles: Obstacle[] = [];
  private pebbles: number[] = [];

  private speed: number = PHYSICS.initialSpeed;
  private distance = 0;
  private score = 0;
  private spawnCountdown = 0;
  private time = 0;
  private duckHeld = false;
  private overAt = 0;
  private lastTimestamp: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: GameCallbacks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('当前浏览器不支持 Canvas 2D');
    }
    this.ctx = ctx;
    this.setupBackingStore();
    this.seedPebbles();
    this.bindInput();
  }

  /** 启动渲染与逻辑循环。 */
  start(): void {
    this.render();
    requestAnimationFrame(this.frame);
  }

  // ---------- 输入 ----------

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (!e.repeat) this.handleAction();
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.duckHeld = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowDown') this.duckHeld = false;
    });
    // 失焦时清除按键状态，避免“卡住”的蹲下
    window.addEventListener('blur', () => {
      this.duckHeld = false;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handleAction();
    });
  }

  /** 统一的“跳跃 / 开始 / 重开”动作。 */
  private handleAction(): void {
    switch (this.state) {
      case 'ready':
        this.begin();
        break;
      case 'running':
        this.dino.queueJump();
        break;
      case 'over':
        if (performance.now() - this.overAt >= RESTART_COOLDOWN_MS) {
          this.begin();
        }
        break;
    }
  }

  // ---------- 状态切换 ----------

  private begin(): void {
    this.state = 'running';
    this.dino.reset();
    this.obstacles = [];
    this.speed = PHYSICS.initialSpeed;
    this.distance = 0;
    this.score = 0;
    this.time = 0;
    this.spawnCountdown = nextSpawnGap(this.speed);
    this.callbacks.onScore(0);
    this.callbacks.onStart?.();
  }

  private end(): void {
    this.state = 'over';
    this.overAt = performance.now();
    this.callbacks.onGameOver(this.score);
  }

  // ---------- 循环 ----------

  private readonly frame = (timestamp: number): void => {
    const dt =
      this.lastTimestamp === null ? 0 : Math.min((timestamp - this.lastTimestamp) / 1000, MAX_FRAME_DT);
    this.lastTimestamp = timestamp;

    if (this.state === 'running') {
      this.update(dt);
    }
    this.render();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    this.time += dt;

    // 速度随时间线性增长，直到上限
    this.speed = Math.min(PHYSICS.maxSpeed, this.speed + PHYSICS.acceleration * dt);
    const travel = this.speed * dt;

    this.dino.update(dt, this.duckHeld);

    // 分数 = 行进距离 × 系数，只在整数变化时通知 UI
    this.distance += travel;
    const nextScore = Math.floor(this.distance * PHYSICS.scorePerPixel);
    if (nextScore !== this.score) {
      this.score = nextScore;
      this.callbacks.onScore(this.score);
    }

    this.updatePebbles(travel);
    this.updateObstacles(travel);

    if (this.hasCollision()) {
      this.end();
    }
  }

  private updateObstacles(travel: number): void {
    for (const o of this.obstacles) {
      o.x -= travel;
    }
    // 移出画面的障碍物及时回收
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -10);

    // 按距离而非时间生成，保证间距随速度等比变化
    this.spawnCountdown -= travel;
    if (this.spawnCountdown <= 0) {
      this.obstacles.push(createObstacle(randomKind(this.score)));
      this.spawnCountdown = nextSpawnGap(this.speed);
    }
  }

  private hasCollision(): boolean {
    const dinoBox = this.dino.hitbox();
    return this.obstacles.some((o) => intersects(dinoBox, obstacleBox(o)));
  }

  private seedPebbles(): void {
    this.pebbles = Array.from({ length: 12 }, () => Math.random() * WORLD.width);
  }

  private updatePebbles(travel: number): void {
    this.pebbles = this.pebbles.map((x) => {
      const moved = x - travel;
      return moved < -4 ? WORLD.width + Math.random() * 40 : moved;
    });
  }

  // ---------- 渲染 ----------

  private setupBackingStore(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = WORLD.width * dpr;
    this.canvas.height = WORLD.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    drawGround(ctx, this.pebbles);
    for (const o of this.obstacles) {
      drawObstacle(ctx, o, this.time);
    }
    drawDino(ctx, this.dino);

    if (this.state === 'ready') {
      this.drawCenterText('PRESS SPACE TO START', 'SPACE / ↑ JUMP · ↓ DUCK · TAP TO PLAY');
    } else if (this.state === 'over') {
      this.drawCenterText('GAME OVER', 'PRESS SPACE TO RETRY');
    }
  }

  private drawCenterText(title: string, subtitle: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.fg;
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.fillText(title, WORLD.width / 2, 100);
    ctx.font = '14px "Courier New", monospace';
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(subtitle, WORLD.width / 2, 126);
    ctx.textAlign = 'start';
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
