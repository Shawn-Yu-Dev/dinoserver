import './style.css';
import { ApiError, fetchReplay, submitScore } from './api';
import type { ReplayData } from './game/replay';
import { ChromeDinoGame } from './game/runner';
import { getUsername, setUsername } from './identity';
import { LeaderboardPanel } from './leaderboard/panel';

const BEST_KEY = 'dino.best';

function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing page element: ${selector}`);
  return el;
}

const statusEl = $<HTMLElement>('#status');
const screenEl = $<HTMLElement>('.screen');
const runAgainBtn = $<HTMLButtonElement>('#run-again');
const replayBtn = $<HTMLButtonElement>('#replay');
const identity = {
  form: $<HTMLFormElement>('#identity-form'),
  input: $<HTMLInputElement>('#identity-input'),
  msg: $<HTMLElement>('#identity-msg'),
};

const panel = new LeaderboardPanel(
  {
    list: $<HTMLOListElement>('#board-list'),
    prev: $<HTMLButtonElement>('#board-prev'),
    next: $<HTMLButtonElement>('#board-next'),
    locate: $<HTMLButtonElement>('#board-locate'),
    pageInfo: $<HTMLElement>('#board-page'),
    message: $<HTMLElement>('#board-msg'),
  },
  getUsername,
  (username) => void watchReplay(username),
);

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

// ---------- Local best score ----------

let best = Number(localStorage.getItem(BEST_KEY)) || 0;
let lastGameOverAt = 0;
/** 最近一局的录像，用于本地 REPLAY 按钮。 */
let lastReplay: ReplayData | null = null;
/** 正在观看的录像所属玩家；本地回放时为 null。 */
let replayOwner: string | null = null;
/** 观看请求序号：开始新一局或再次点击时丢弃过期响应。 */
let watchSeq = 0;

function keepHighScore(score: number): void {
  if (!Number.isFinite(score) || score <= best) return;
  best = score;
  localStorage.setItem(BEST_KEY, String(score));
}

// ---------- Official Chrome Dino engine ----------

const game = new ChromeDinoGame('#dino-game', {
  bestScore: best,
  onStart: () => {
    watchSeq++;
    replayOwner = null;
    setStatus('');
    runAgainBtn.disabled = true;
    replayBtn.disabled = true;
  },
  onHighScore: keepHighScore,
  onGameOver: (score, replay) => {
    lastGameOverAt = performance.now();
    lastReplay = replay;
    runAgainBtn.disabled = false;
    replayBtn.disabled = !replay;
    if (score <= 0) {
      setStatus('SCORE 0 · PLAY AGAIN');
      return;
    }
    setStatus(`SCORE ${score} · SUBMITTING…`);
    void uploadScore(score, replay);
  },
  onReplayStart: () => {
    // 开始回放后，任何仍在途的观看请求都应失效。
    watchSeq++;
    setStatus(replayOwner ? `REPLAYING ${replayOwner}…` : 'REPLAYING…');
    runAgainBtn.disabled = true;
    replayBtn.disabled = true;
  },
  onReplayEnd: (score) => {
    setStatus(
      replayOwner
        ? `REPLAY FINISHED · ${replayOwner} · SCORE ${score}`
        : `REPLAY FINISHED · SCORE ${score}`,
    );
    replayOwner = null;
    runAgainBtn.disabled = false;
    replayBtn.disabled = !lastReplay;
  },
});

// ---------- Replay ----------

replayBtn.addEventListener('click', () => {
  if (!lastReplay) return;
  replayOwner = null;
  game.playReplay(lastReplay);
});

/** 从排行榜观看他人的最高分录像。 */
async function watchReplay(username: string): Promise<void> {
  if (game.isReplaying) return;
  if (!game.crashed) {
    setStatus('FINISH THE CURRENT RUN TO WATCH A REPLAY', true);
    return;
  }

  const seq = ++watchSeq;
  setStatus(`LOADING ${username}'S REPLAY…`);

  try {
    const data = await fetchReplay(username);
    if (seq !== watchSeq) return;
    replayOwner = username;
    if (!game.playReplay(data)) {
      replayOwner = null;
      setStatus(`REPLAY UNAVAILABLE FOR ${username}`, true);
    }
  } catch (err) {
    if (seq !== watchSeq) return;
    replayOwner = null;
    if (err instanceof ApiError && err.status === 404) {
      setStatus(`NO REPLAY FOR ${username}`, true);
    } else {
      const message = err instanceof Error ? err.message.toUpperCase() : 'UNKNOWN ERROR';
      setStatus(`REPLAY FAILED: ${message}`, true);
    }
  }
}

/**
 * 直接调用官方 restart()，不依赖 isCanvasInView()。
 * 用于按钮重开，以及页面被排行榜滚动后空格重开的兜底。
 */
function restartRun(): boolean {
  if (!game.crashed || performance.now() - lastGameOverAt < 500) return false;
  const restarted = game.restart();
  if (restarted) {
    runAgainBtn.blur();
    screenEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return restarted;
}

runAgainBtn.addEventListener('click', () => void restartRun());

// 自动提交后会定位排行榜；若页面因此把游戏滚出视口，官方引擎不会再响应空格。
// 这里在“已结束且画布不在视口”时接管空格：直接重开并把游戏滚回视野。
const gameContainer = $<HTMLElement>('#dino-game .runner-container');

function gameInView(): boolean {
  return gameContainer.getBoundingClientRect().top > -10;
}

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || !game.crashed) return;
  if (isInteractiveTarget(e.target) || gameInView()) return;
  if (performance.now() - lastGameOverAt < 500) return;
  e.preventDefault();
  void restartRun();
});

/** 自动提交成绩与录像，成功后刷新排行榜并高亮自己（不滚动页面）。 */
async function uploadScore(score: number, replay: ReplayData | null): Promise<void> {
  try {
    const result = await submitScore(getUsername(), score, replay);
    // 回放中不要覆盖 REPLAYING 状态。
    if (!game.isReplaying) {
      setStatus(`RANK #${result.rank} / ${result.total} · BEST ${result.score} · PLAY AGAIN`);
    }
    await panel.locateMe(false);
  } catch (err) {
    if (!game.isReplaying) {
      const text = err instanceof Error ? err.message.toUpperCase() : 'UNKNOWN ERROR';
      setStatus(`SUBMIT FAILED: ${text}`, true);
    }
  }
}

// ---------- Player identity ----------

identity.input.value = getUsername();

identity.form.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    identity.input.value = setUsername(identity.input.value);
    identity.msg.textContent = 'SAVED';
    identity.msg.classList.remove('error');
  } catch (err) {
    identity.msg.textContent = err instanceof Error ? err.message : 'INVALID PLAYER ID';
    identity.msg.classList.add('error');
  }
});

// 官方 dino 在 document 上监听方向键与空格：输入框内需要阻止冒泡，
// 否则编辑昵称时按空格会让恐龙起跳。
for (const el of document.querySelectorAll<HTMLElement>('input, textarea')) {
  el.addEventListener('keydown', (e) => e.stopPropagation());
  el.addEventListener('keyup', (e) => e.stopPropagation());
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
  );
}

// ---------- Bootstrap ----------

void panel.load(1);
