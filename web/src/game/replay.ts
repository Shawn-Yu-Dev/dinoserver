// 录像数据格式与可复现随机数。
// 只记录 seed + 输入时间轴，回放时用同一 seed 重放随机序列。

export type ReplayAction = 'jump' | 'duck' | 'release';
export type ReplayKey = 'jump' | 'duck';

export interface ReplayInput {
  /** 相对于开局的时间戳（毫秒） */
  t: number;
  /** jump = 起跳键按下；duck = 蹲下键按下；release = 释放按键 */
  a: ReplayAction;
  /** 仅 release 需要：释放的是跳跃键还是蹲下键 */
  k?: ReplayKey;
}

export interface ReplayData {
  /** 格式版本，便于后续演进 */
  v: 1;
  /** 无符号 32 位种子 */
  seed: number;
  /** 本局时长（毫秒） */
  duration: number;
  inputs: ReplayInput[];
}

/** 生成一个 32 位随机种子；优先使用 crypto，降级到时间戳。 */
export function createSeed(): number {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    return cryptoObj.getRandomValues(new Uint32Array(1))[0];
  }
  return Date.now() >>> 0;
}

/** mulberry32：轻量、可复现的 32 位 PRNG。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 过滤非法输入并按时间排序，避免损坏的录像导致回放异常。 */
export function sanitizeReplay(replay: ReplayData): ReplayData | null {
  if (!replay || replay.v !== 1 || !Number.isFinite(replay.seed) || !Array.isArray(replay.inputs)) {
    return null;
  }
  const inputs = replay.inputs
    .filter(
      (i): i is ReplayInput =>
        !!i &&
        Number.isFinite(i.t) &&
        i.t >= 0 &&
        (i.a === 'jump' || i.a === 'duck' || i.a === 'release') &&
        (i.a !== 'release' || i.k === 'jump' || i.k === 'duck'),
    )
    .map((i) => ({ ...i, t: Math.round(i.t) }))
    .sort((a, b) => a.t - b.t);

  return {
    v: 1,
    seed: replay.seed >>> 0,
    duration: Number.isFinite(replay.duration) ? Math.max(0, Math.round(replay.duration)) : 0,
    inputs,
  };
}
