// Adapter for the official Chrome Dino engine.
// All game logic lives in ./chrome/offline.js (Chromium 130, BSD).
// This layer only bridges high score storage, reports the final score,
// notifies the UI when a run starts, and exposes an explicit restart.
import { Runner, type RunnerInstance } from './chrome/offline.js';

export interface ChromeDinoOptions {
  /** 本地已保存的最高分，用于官方画布上的 HI 显示。 */
  bestScore: number;
  /** 一局结束，参数为官方计分（getActualDistance 的结果）。 */
  onGameOver: (score: number) => void;
  /** 官方引擎刷新最高分，用于持久化。 */
  onHighScore: (score: number) => void;
  /** 开始或重新开始一局。 */
  onStart?: () => void;
}

interface ChromeBridgeWindow extends Window {
  initializeEasterEggHighScore?: (score: number) => void;
  errorPageController?: {
    updateEasterEggHighScore: (score: number) => void;
    resetEasterEggHighScore: () => void;
    trackEasterEgg: () => void;
  };
}

export class ChromeDinoGame {
  private readonly runner: RunnerInstance;
  private readonly bridgeWindow = window as ChromeBridgeWindow;
  private readonly containerEl: HTMLElement;

  constructor(containerSelector: string, private readonly options: ChromeDinoOptions) {
    const container = document.querySelector<HTMLElement>(containerSelector);
    if (!container) {
      throw new Error(`Missing game container: ${containerSelector}`);
    }
    this.containerEl = container;

    // 官方页面通过 window.errorPageController 同步最高分；这里改成写入 localStorage。
    this.bridgeWindow.errorPageController = {
      updateEasterEggHighScore: (score) => this.options.onHighScore(score),
      resetEasterEggHighScore: () => this.options.onHighScore(0),
      trackEasterEgg: () => undefined,
    };

    // 官方 Runner 是单例；构造时会读取 #offline-resources-1x/2x 精灵图。
    this.runner = new Runner(containerSelector);

    this.wrapGameOver();
    this.wrapPlayStatus();

    // 载入本地最高分（官方画布右上角的 HI）。
    this.bridgeWindow.initializeEasterEggHighScore?.(this.options.bestScore);
  }

  /** 是否处于撞击后的结束状态。 */
  get crashed(): boolean {
    return this.runner.crashed;
  }

  /**
   * 直接调用官方 restart()。
   * 官方键盘重开受 isCanvasInView() 限制；页面滚动后按钮或兜底逻辑可绕过该限制。
   */
  restart(): boolean {
    if (!this.runner.crashed) return false;
    this.runner.restart();
    return true;
  }

  /** 官方画布中正在显示的分数（像素距离 × 官方系数）。 */
  get score(): number {
    const distance = this.runner.distanceMeter?.getActualDistance(this.runner.distanceRan) ?? 0;
    return Math.max(0, Math.floor(distance));
  }

  /** 官方引擎的“结束一局”只在撞击时调用一次，包装后即可拿到最终分数。 */
  private wrapGameOver(): void {
    const officialGameOver = this.runner.gameOver.bind(this.runner);
    this.runner.gameOver = () => {
      const finalScore = this.score;
      officialGameOver();
      this.options.onGameOver(finalScore);
    };
  }

  /** 包装开局状态切换，用于清空上一局的提交提示。 */
  private wrapPlayStatus(): void {
    const officialSetPlayStatus = this.runner.setPlayStatus.bind(this.runner);
    this.runner.setPlayStatus = (playing: boolean) => {
      officialSetPlayStatus(playing);
      this.containerEl.classList.toggle('is-playing', playing);
      if (playing) {
        this.options.onStart?.();
      }
    };
  }
}
