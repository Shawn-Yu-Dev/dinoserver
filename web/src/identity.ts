// 玩家身份：本地保存一个昵称（localStorage），作为排行榜的唯一标识。
// 规则与服务端 normalizeUsername 保持一致：去空格后 1–24 个字符，不含控制字符。

const STORAGE_KEY = 'dino.username';
const MAX_LEN = 24;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** 校验并规范化昵称，不合法时抛出中文错误信息。 */
export function normalizeUsername(raw: string): string {
  const name = raw.trim();
  if (name === '') {
    throw new Error('昵称不能为空');
  }
  if ([...name].length > MAX_LEN) {
    throw new Error(`昵称不能超过 ${MAX_LEN} 个字符`);
  }
  if (CONTROL_CHARS.test(name)) {
    throw new Error('昵称不能包含控制字符');
  }
  return name;
}

function randomSuffix(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** 读取当前昵称；首次访问时自动生成 DINO-XXXX。 */
export function getUsername(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return normalizeUsername(saved);
    } catch {
      // 本地数据损坏时回退到重新生成
    }
  }
  const generated = `DINO-${randomSuffix()}`;
  localStorage.setItem(STORAGE_KEY, generated);
  return generated;
}

/** 保存新昵称，返回规范化后的值。 */
export function setUsername(raw: string): string {
  const name = normalizeUsername(raw);
  localStorage.setItem(STORAGE_KEY, name);
  return name;
}
