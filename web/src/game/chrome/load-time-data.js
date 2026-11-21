// Chromium 的错误页通过 chrome://resources 注入 loadTimeData。
// 官方 offline.js 仅用它读取可选的实验开关和图片资源，因此在独立站点中
// 提供一个“所有键都不存在”的最小实现即可，不改变游戏逻辑。
export const loadTimeData = {
  valueExists() {
    return false;
  },
  getString() {
    return '';
  },
  getValue() {
    return '';
  },
};
