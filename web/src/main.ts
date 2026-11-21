import './style.css';
import { submitScore } from './api';
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
);

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

// ---------- Local best score ----------

let best = Number(localStorage.getItem(BEST_KEY)) || 0;
let lastGameOverAt = 0;

function keepHighScore(score: number): void {
  if (!Number.isFinite(score) || score <= best) return;
  best = score;
  localStorage.setItem(BEST_KEY, String(score));
}

// ---------- Official Chrome Dino engine ----------

const game = new ChromeDinoGame('#dino-game', {
  bestScore: best,
  onStart: () => {
    setStatus('');
    runAgainBtn.disabled = true;
  },
  onHighScore: keepHighScore,
  onGameOver: (score) => {
    lastGameOverAt = performance.now();
    runAgainBtn.disabled = false;
    if (score <= 0) {
      setStatus('SCORE 0 · PLAY AGAIN');
      return;
    }
    setStatus(`SCORE ${score} · SUBMITTING…`);
    void uploadScore(score);
  },
});

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

/** 自动提交成绩，成功后刷新排行榜并高亮自己（不滚动页面）。 */
async function uploadScore(score: number): Promise<void> {
  try {
    const result = await submitScore(getUsername(), score);
    setStatus(`RANK #${result.rank} / ${result.total} · BEST ${result.score} · PLAY AGAIN`);
    await panel.locateMe(false);
  } catch (err) {
    const text = err instanceof Error ? err.message.toUpperCase() : 'UNKNOWN ERROR';
    setStatus(`SUBMIT FAILED: ${text}`, true);
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
