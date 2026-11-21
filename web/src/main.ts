import './style.css';
import { submitScore } from './api';
import { ChromeDinoGame } from './game/runner';
import { getUsername, setUsername } from './identity';
import { LeaderboardPanel } from './leaderboard/panel';

const BEST_KEY = 'dino.best';

function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`缺少页面元素：${selector}`);
  return el;
}

const statusEl = $<HTMLElement>('#status');
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

// ---------- 本地最高分 ----------

let best = Number(localStorage.getItem(BEST_KEY)) || 0;

function keepHighScore(score: number): void {
  if (!Number.isFinite(score) || score <= best) return;
  best = score;
  localStorage.setItem(BEST_KEY, String(score));
}

// ---------- 官方 Chrome Dino 引擎 ----------

new ChromeDinoGame('#dino-game', {
  bestScore: best,
  onStart: () => setStatus(''),
  onHighScore: keepHighScore,
  onGameOver: (score) => {
    if (score <= 0) {
      setStatus('SCORE 0 · PRESS SPACE TO RETRY');
      return;
    }
    setStatus(`SCORE ${score} · SUBMITTING…`);
    void uploadScore(score);
  },
});

/** 自动提交成绩，成功后直接定位到自己的排名。 */
async function uploadScore(score: number): Promise<void> {
  try {
    const result = await submitScore(getUsername(), score);
    setStatus(`RANK #${result.rank} / ${result.total} · SCORE ${score} · SPACE TO RETRY`);
    await panel.locateMe();
  } catch (err) {
    const text = err instanceof Error ? err.message : '未知错误';
    setStatus(`提交失败：${text}`, true);
  }
}

// ---------- 玩家昵称 ----------

identity.input.value = getUsername();

identity.form.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    identity.input.value = setUsername(identity.input.value);
    identity.msg.textContent = '已保存';
    identity.msg.classList.remove('error');
  } catch (err) {
    identity.msg.textContent = err instanceof Error ? err.message : '昵称不合法';
    identity.msg.classList.add('error');
  }
});

// 官方 dino 在 document 上监听方向键与空格：输入框内需要阻止冒泡，
// 否则编辑昵称时按空格会让恐龙起跳。
for (const el of document.querySelectorAll<HTMLElement>('input, textarea')) {
  el.addEventListener('keydown', (e) => e.stopPropagation());
  el.addEventListener('keyup', (e) => e.stopPropagation());
}

// ---------- 启动 ----------

void panel.load(1);
