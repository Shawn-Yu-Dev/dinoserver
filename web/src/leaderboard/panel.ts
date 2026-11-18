// 排行榜面板：分页浏览、定位“我”，并对当前玩家那一行做滚动与闪烁高亮。
import { ApiError, fetchLeaderboard, fetchMyRank, type Entry, type LeaderboardPage } from '../api';

export const PAGE_SIZE = 20;

export interface PanelElements {
  list: HTMLOListElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  locate: HTMLButtonElement;
  pageInfo: HTMLElement;
  message: HTMLElement;
}

export class LeaderboardPanel {
  private page = 1;
  private totalPages = 1;
  /** 请求序号：只渲染最新一次请求的结果，避免快速翻页时旧数据覆盖新数据。 */
  private requestSeq = 0;

  constructor(
    private readonly els: PanelElements,
    private readonly getUsername: () => string,
  ) {
    els.prev.addEventListener('click', () => void this.load(this.page - 1));
    els.next.addEventListener('click', () => void this.load(this.page + 1));
    els.locate.addEventListener('click', () => void this.locateMe());
  }

  /** 加载指定页（服务端会把越界页收敛到合法范围）。 */
  async load(page: number): Promise<void> {
    const target = Math.min(Math.max(1, page), this.totalPages);
    const seq = ++this.requestSeq;
    this.setLoading(true, '加载中…');

    try {
      const data = await fetchLeaderboard(target, PAGE_SIZE);
      if (seq !== this.requestSeq) return;
      this.render(data);
      this.setMessage(`共 ${data.total} 位玩家`);
    } catch (err) {
      if (seq !== this.requestSeq) return;
      this.setMessage(errorText(err), true);
    } finally {
      if (seq === this.requestSeq) this.setLoading(false);
    }
  }

  /** 定位到当前玩家：切换到其所在页，平滑滚动到该行并闪烁高亮。 */
  async locateMe(): Promise<void> {
    const seq = ++this.requestSeq;
    this.setLoading(true, '定位中…');

    try {
      const data = await fetchMyRank(this.getUsername(), PAGE_SIZE);
      if (seq !== this.requestSeq) return;
      this.render(data);
      this.setMessage(`你的名次：#${data.me.rank} · ${data.me.score} 分`);
      this.focusMyRow();
    } catch (err) {
      if (seq !== this.requestSeq) return;
      if (err instanceof ApiError && err.status === 404) {
        this.setMessage('你尚未上榜，先玩一局吧', true);
      } else {
        this.setMessage(errorText(err), true);
      }
    } finally {
      if (seq === this.requestSeq) this.setLoading(false);
    }
  }

  private render(data: LeaderboardPage): void {
    this.page = data.page;
    this.totalPages = Math.max(1, data.total_pages);

    this.els.list.replaceChildren(...data.entries.map((e) => this.createRow(e)));
    this.els.pageInfo.textContent = `${this.page} / ${this.totalPages}`;
    this.els.prev.disabled = this.page <= 1;
    this.els.next.disabled = this.page >= this.totalPages;
  }

  private createRow(e: Entry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = e.is_me ? 'row is-me' : 'row';
    li.dataset.rank = String(e.rank);

    const rank = document.createElement('span');
    rank.className = 'col-rank';
    rank.textContent = `#${e.rank}`;

    const name = document.createElement('span');
    name.className = 'col-name';
    name.textContent = e.is_me ? `${e.username} ◀` : e.username;

    const score = document.createElement('span');
    score.className = 'col-score';
    score.textContent = String(e.score).padStart(6, '0');

    li.append(rank, name, score);
    return li;
  }

  /** 滚动到 is_me 行并触发闪烁动画。 */
  private focusMyRow(): void {
    const row = this.els.list.querySelector<HTMLLIElement>('li.is-me');
    if (!row) return;

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // 先移除再添加 class，确保每次定位都能重新播放动画
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    row.addEventListener('animationend', () => row.classList.remove('flash'), { once: true });
  }

  private setLoading(busy: boolean, text?: string): void {
    if (text) this.setMessage(text);
    if (busy) {
      this.els.prev.disabled = true;
      this.els.next.disabled = true;
      this.els.locate.disabled = true;
      return;
    }
    // 加载结束：按真实页码恢复翻页按钮
    this.els.prev.disabled = this.page <= 1;
    this.els.next.disabled = this.page >= this.totalPages;
    this.els.locate.disabled = false;
  }

  setMessage(text: string, isError = false): void {
    this.els.message.textContent = text;
    this.els.message.classList.toggle('error', isError);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : '未知错误';
}
