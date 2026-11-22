// Adapter for the official Chrome Dino engine.
// All game logic lives in ./chrome/offline.js (Chromium 130, BSD).
// This layer bridges high score storage, reports the final score, records a
// deterministic input replay, and can play that replay back on the same canvas.
import { Runner, type RunnerInstance } from './chrome/offline.js';
import {
  createSeed,
  mulberry32,
  sanitizeReplay,
  type ReplayData,
  type ReplayInput,
  type ReplayKey,
} from './replay';

export interface ChromeDinoOptions {
  /** 本地已保存的最高分，用于官方画布上的 HI 显示。 */
  bestScore: number;
  /** 一局结束：官方计分，以及本局录像（未录制时为 null）。 */
  onGameOver: (score: number, replay: ReplayData | null) => void;
  /** 官方引擎刷新最高分，用于持久化。 */
  onHighScore: (score: number) => void;
  /** 开始或重新开始一局（回放期间不触发）。 */
  onStart?: () => void;
  /** 回放开始 / 结束。 */
  onReplayStart?: () => void;
  onReplayEnd?: (score: number) => void;
}

interface ChromeBridgeWindow extends Window {
  initializeEasterEggHighScore?: (score: number) => void;
  errorPageController?: {
    updateEasterEggHighScore: (score: number) => void;
    resetEasterEggHighScore: () => void;
    trackEasterEgg: () => void;
  };
}

type Mode = 'idle' | 'recording' | 'replaying';

const JUMP_KEYCODE = 32;
const DUCK_KEYCODE = 40;
const MAX_REPLAY_INPUTS = 5000;

export class ChromeDinoGame {
  private readonly runner: RunnerInstance;
  private readonly bridgeWindow = window as ChromeBridgeWindow;
  private readonly containerEl: HTMLElement;
  private readonly nativeRandom = Math.random;

  private mode: Mode = 'idle';
  private wasPlaying = false;

  // 录制状态
  private seed = 0;
  private recordStartedAt = 0;
  private recordedInputs: ReplayInput[] = [];
  /** 首次开局由哪个输入触发：官方 handler 先于/后于录制器执行时都能补记 t=0 的起跳。 */
  private pendingStartJump = false;

  // 回放状态
  private replayInputs: ReplayInput[] = [];
  private replayIndex = 0;
  private replayStartedAt = 0;
  private replayTimer = 0;
  /** 回放前的最高分：官方引擎可能在回放中改写，结束时恢复。 */
  private highScoreBeforeReplay = 0;

  constructor(containerSelector: string, private readonly options: ChromeDinoOptions) {
    const container = document.querySelector<HTMLElement>(containerSelector);
    if (!container) {
      throw new Error(`Missing game container: ${containerSelector}`);
    }
    this.containerEl = container;

    // 官方页面通过 window.errorPageController 同步最高分；这里改成写入 localStorage。
    // 回放不应改写最高分，因此回放期间忽略该桥接。
    this.bridgeWindow.errorPageController = {
      updateEasterEggHighScore: (score) => {
        if (this.mode !== 'replaying') this.options.onHighScore(score);
      },
      resetEasterEggHighScore: () => {
        if (this.mode !== 'replaying') this.options.onHighScore(0);
      },
      trackEasterEgg: () => undefined,
    };

    // 官方 Runner 是单例；构造时会读取 #offline-resources-1x/2x 精灵图。
    this.runner = new Runner(containerSelector);

    this.wrapGameOver();
    this.wrapPlayStatus();
    this.bindRecorder();

    // 载入本地最高分（官方画布右上角的 HI）。
    this.bridgeWindow.initializeEasterEggHighScore?.(this.options.bestScore);
  }

  /** 是否处于撞击后的结束状态。 */
  get crashed(): boolean {
    return this.runner.crashed;
  }

  /** 是否正在回放。 */
  get isReplaying(): boolean {
    return this.mode === 'replaying';
  }

  /** 当前是否有一局正在进行（含暂停）。 */
  get playing(): boolean {
    return this.runner.playing;
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

  /**
   * 用同一 seed 重置官方游戏，并按时间轴重新注入输入。
   * 仅在撞击结束、且录像合法时生效。
   */
  playReplay(replay: ReplayData): boolean {
    if (this.mode === 'replaying' || !this.runner.crashed) return false;

    const data = sanitizeReplay(replay);
    if (!data) return false;

    this.mode = 'replaying';
    this.replayInputs = data.inputs;
    this.replayIndex = 0;
    this.highScoreBeforeReplay = this.runner.highestScore;
    Math.random = mulberry32(data.seed);

    // 官方键盘事件受 isCanvasInView() 限制；先确保画布在视口内。
    this.containerEl.scrollIntoView({ block: 'center' });
    this.blockUserInput();
    this.options.onReplayStart?.();

    // setPlayStatus 包装器会跳过录制/重新播种，restart() 内部的所有随机调用都使用录像 seed。
    this.runner.restart();
    this.replayStartedAt = performance.now();

    // t=0 的输入立即注入，其余交给定时器时间轴（保留亚帧输入时机）。
    this.dispatchDueInputs(0);
    this.scheduleNextReplayInput();
    return true;
  }

  /** 官方引擎的“结束一局”只在撞击时调用一次，包装后即可拿到最终分数与录像。 */
  private wrapGameOver(): void {
    const officialGameOver = this.runner.gameOver.bind(this.runner);
    this.runner.gameOver = () => {
      const finalScore = this.score;
      const wasReplay = this.mode === 'replaying';
      const replay = this.finishRecording();

      officialGameOver();

      if (wasReplay) {
        this.finishReplay(finalScore);
      } else {
        this.options.onGameOver(finalScore, replay);
      }
    };
  }

  /** 包装开局状态切换：只在真正的新一局开始时播种并录制。 */
  private wrapPlayStatus(): void {
    const officialSetPlayStatus = this.runner.setPlayStatus.bind(this.runner);
    this.runner.setPlayStatus = (playing: boolean) => {
      const wasPlaying = this.wasPlaying;
      this.wasPlaying = playing;
      officialSetPlayStatus(playing);
      this.containerEl.classList.toggle('is-playing', playing);

      const started = playing && !wasPlaying;
      if (!started) return;

      if (this.mode === 'replaying') {
        // 回放期间不重新播种、不录制、也不清空回放状态提示。
        return;
      }
      if (this.mode !== 'recording') {
        this.startRecording();
      }
      this.options.onStart?.();
    };
  }

  // ---------- 录制 ----------

  private bindRecorder(): void {
    document.addEventListener('keydown', (e) => {
      if (this.mode === 'replaying' || isTypingTarget(e.target) || e.repeat) return;
      const jump = e.code === 'Space' || e.code === 'ArrowUp';
      const duck = e.code === 'ArrowDown';
      if (!jump && !duck) return;

      if (this.mode === 'recording') {
        this.record(jump ? 'jump' : 'duck');
      } else if (jump && !this.runner.crashed) {
        // 首次开局：官方 handler 可能先于本监听器执行，先记下待补的起跳。
        this.pendingStartJump = true;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (this.mode !== 'recording' || isTypingTarget(e.target)) return;
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        this.record('release', 'jump');
      } else if (e.code === 'ArrowDown') {
        this.record('release', 'duck');
      }
    });

    document.addEventListener('pointerdown', (e) => {
      if (this.mode === 'replaying' || e.button !== 0) return;
      if (!this.isInsideGame(e.target)) return;
      if (this.mode === 'recording') {
        this.record('jump');
      } else if (!this.runner.crashed) {
        this.pendingStartJump = true;
      }
    });

    document.addEventListener('pointerup', (e) => {
      if (this.mode !== 'recording' || !this.isInsideGame(e.target)) return;
      this.record('release', 'jump');
    });
  }

  private startRecording(): void {
    this.mode = 'recording';
    this.seed = createSeed();
    this.recordStartedAt = performance.now();
    this.recordedInputs = [];
    // 临时替换全局随机源；本局所有 Math.random 调用都走同一个 PRNG。
    Math.random = mulberry32(this.seed);

    if (this.pendingStartJump) {
      this.recordedInputs.push({ t: 0, a: 'jump' });
      this.pendingStartJump = false;
    }
  }

  private record(action: ReplayInput['a'], key?: ReplayKey): void {
    if (this.mode !== 'recording' || this.recordedInputs.length >= MAX_REPLAY_INPUTS) return;
    const input: ReplayInput = {
      t: Math.max(0, Math.round(performance.now() - this.recordStartedAt)),
      a: action,
    };
    if (key) input.k = key;
    this.recordedInputs.push(input);
  }

  /** 结束录制并生成录像；非录制状态返回 null。 */
  private finishRecording(): ReplayData | null {
    if (this.mode !== 'recording') return null;

    const duration = Math.max(0, Math.round(performance.now() - this.recordStartedAt));
    const lastInput = this.recordedInputs[this.recordedInputs.length - 1];
    const replay: ReplayData = {
      v: 1,
      seed: this.seed,
      duration: Math.max(duration, lastInput?.t ?? 0),
      inputs: this.recordedInputs.slice(),
    };

    this.mode = 'idle';
    this.recordedInputs = [];
    this.restoreRandom();
    return replay;
  }

  // ---------- 回放 ----------

  /** 用自校正的 setTimeout 链重放输入，避免 rAF 把亚帧按键对齐到 16ms。 */
  private scheduleNextReplayInput(): void {
    if (this.replayIndex >= this.replayInputs.length) return;
    const delay = Math.max(
      0,
      this.replayInputs[this.replayIndex].t - (performance.now() - this.replayStartedAt),
    );
    this.replayTimer = window.setTimeout(() => {
      if (this.mode !== 'replaying') return;
      this.dispatchDueInputs(performance.now() - this.replayStartedAt);
      this.scheduleNextReplayInput();
    }, delay);
  }

  private dispatchDueInputs(elapsed: number): void {
    while (
      this.replayIndex < this.replayInputs.length &&
      this.replayInputs[this.replayIndex].t <= elapsed
    ) {
      this.dispatchReplayInput(this.replayInputs[this.replayIndex]);
      this.replayIndex++;
    }
  }

  /** 直接调用官方事件入口，避免合成 KeyboardEvent 的 keyCode 兼容问题。 */
  private dispatchReplayInput(input: ReplayInput): void {
    const key = input.a === 'release' ? (input.k ?? 'jump') : input.a;
    this.runner.handleEvent({
      type: input.a === 'release' ? 'keyup' : 'keydown',
      keyCode: key === 'duck' ? DUCK_KEYCODE : JUMP_KEYCODE,
      target: document.body,
      button: 0,
      preventDefault: () => undefined,
    });
  }

  private finishReplay(finalScore: number): void {
    this.stopReplayLoop();
    this.mode = 'idle';
    this.replayInputs = [];
    this.replayIndex = 0;
    this.unblockUserInput();
    this.restoreRandom();

    // 回放不应影响最高分：官方引擎可能已在回放中调用 saveHighScore，这里恢复。
    this.runner.highestScore = this.highScoreBeforeReplay;
    this.runner.distanceMeter.setHighScore(this.highScoreBeforeReplay);

    this.options.onReplayEnd?.(finalScore);
  }

  private stopReplayLoop(): void {
    if (this.replayTimer) window.clearTimeout(this.replayTimer);
    this.replayTimer = 0;
  }

  /** 回放期间吞掉真实用户输入，避免打乱时间轴。 */
  private readonly blockEvent = (e: Event): void => {
    if (this.mode !== 'replaying') return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  private blockUserInput(): void {
    const opts: AddEventListenerOptions = { capture: true };
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
      document.addEventListener(type, this.blockEvent, opts);
    }
  }

  private unblockUserInput(): void {
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
      document.removeEventListener(type, this.blockEvent, { capture: true });
    }
  }

  // ---------- 工具 ----------

  private restoreRandom(): void {
    Math.random = this.nativeRandom;
  }

  private isInsideGame(target: EventTarget | null): boolean {
    return target instanceof Node && this.containerEl.contains(target);
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}
