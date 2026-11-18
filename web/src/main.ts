import './style.css';
import { submitScore } from './api';
import { getUsername, setUsername } from './identity';
import { DinoGame } from './game/game';
import { LeaderboardPanel } from './leaderboard/panel';

const BEST_KEY = 'dino.best';

function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`缺少页面元素：${selector}`);
  return el;
}

const hud = {
  score: $<HTMLElement>('#hud-score'),
  best: $<HTMLElement>('#hud-best'),
  status: $<HTMLElement>('#status'),
};

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

// ---------- 本地最高分 ----------

let best = Number(localStorage.getItem(BEST_KEY)) || 0;
hud.best.textContent = pad(best);

function pad(n: number): string {
  return String(n).padStart(5, '0');
}

function recordBest(score: number): void {
  if (score <= best) return;
  best = score;
  localStorage.setItem(BEST_KEY, String(best));
  hud.best.textContent = pad(best);
}

// ---------- 游戏 ----------

const game = new DinoGame($<HTMLCanvasElement>('#game'), {
  onStart: () => {
    hud.status.textContent = '';
  },
  onScore: (score) => {
    hud.score.textContent = pad(score);
  },
  onGameOver: (score) => {
    recordBest(score);
    hud.status.textContent = `GAME OVER · SCORE ${score} · PRESS SPACE TO RETRY`;
    if (score > 0) {
      void uploadScore(score);
    }
  },
});

/** 自动提交成绩，成功后直接定位到自己的排名。 */
async function uploadScore(score: number): Promise<void> {
  try {
    const result = await submitScore(getUsername(), score);
    hud.status.textContent = `已上榜 · 第 ${result.rank} / ${result.total} 名 · PRESS SPACE TO RETRY`;
    await panel.locateMe();
  } catch (err) {
    const text = err instanceof Error ? err.message : '未知错误';
    hud.status.textContent = `成绩提交失败：${text} · PRESS SPACE TO RETRY`;
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

// ---------- 启动 ----------

game.start();
void panel.load(1);
