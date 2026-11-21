// 官方 offline.js（Chromium 130）的最小类型声明，仅覆盖本站适配层用到的成员。

export interface DistanceMeter {
  getActualDistance(distance: number): number;
  setHighScore(highScore: number): void;
}

export interface RunnerInstance {
  playing: boolean;
  crashed: boolean;
  distanceRan: number;
  highestScore: number;
  distanceMeter: DistanceMeter;
  setPlayStatus(playing: boolean): void;
  gameOver(): void;
  restart(): void;
}

export interface RunnerConstructor {
  new (outerContainerId: string, config?: Record<string, number | string>): RunnerInstance;
  instance_: RunnerInstance | null;
}

export const Runner: RunnerConstructor;
