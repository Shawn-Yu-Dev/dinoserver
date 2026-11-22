// 后端 API 客户端：统一封装请求与错误处理，与 main.go 的响应结构保持一致。
import type { ReplayData } from './game/replay';

export interface Entry {
  rank: number;
  username: string;
  score: number;
  is_me: boolean;
}

export interface LeaderboardPage {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  entries: Entry[];
}

export interface MyRankPage extends LeaderboardPage {
  me: { rank: number; username: string; score: number; page: number };
}

export interface SubmitResult {
  username: string;
  score: number;
  rank: number;
  total: number;
}

/** 后端返回的业务错误（HTTP 状态码 + 错误码 + 中文说明）。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      res.status,
      err.error ?? 'unknown',
      err.message ?? `Request failed (HTTP ${res.status})`,
    );
  }
  return body as T;
}

/** 分页获取排行榜：GET /api/leaderboard?page=N&limit=20 */
export function fetchLeaderboard(page: number, limit: number): Promise<LeaderboardPage> {
  return request<LeaderboardPage>(`/api/leaderboard?page=${page}&limit=${limit}`);
}

/** 定位玩家自身排名：GET /api/leaderboard/me?username=xxx&limit=20 */
export function fetchMyRank(username: string, limit: number): Promise<MyRankPage> {
  const query = new URLSearchParams({ username, limit: String(limit) });
  return request<MyRankPage>(`/api/leaderboard/me?${query.toString()}`);
}

/** 提交成绩与可选录像：POST /api/score */
export function submitScore(
  username: string,
  score: number,
  replay?: ReplayData | null,
): Promise<SubmitResult> {
  return request<SubmitResult>('/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(replay ? { username, score, replay } : { username, score }),
  });
}
