# Chromium Dino 源码

本目录中的游戏实现来自 Chromium 官方 `chrome://dino`（离线错误页彩蛋），未重写游戏逻辑。

- 上游仓库：https://chromium.googlesource.com/chromium/src
- 版本：`refs/tags/130.0.6723.1`
- 路径：`components/neterror/resources/`
- 文件：
  - `offline.js`（本站文件 sha256 `c2dbfabf4987b322d588f93c59e7c94533c8d24869d3af3e2afaf8495a06b0e1`，即仅改 import 后的版本）
  - `offline-sprite-definitions.js`
  - `constants.js`
  - `LICENSE`（Chromium BSD 3-Clause）
- 精灵图：`web/public/dino/100-offline-sprite.png`、`200-offline-sprite.png`，来自
  `components/neterror/resources/images/default_*_percent/offline/`

## 唯一修改

`offline.js` 第 5 行的 import 由 Chrome 内部协议路径改为本地桩：

```diff
-import {loadTimeData} from 'chrome://resources/js/load_time_data.js';
+import {loadTimeData} from './load-time-data.js';
```

`load-time-data.js` 是本站新增的最小桩，只为满足独立站点运行；游戏逻辑、精灵定义与常量均保持上游原样。

> 选择 130 是因为它是最后一个提供单文件 `offline.js` 的版本；131 起官方拆分为 `dino_game/` 多模块，并深度耦合 Chrome 错误页与 `loadTimeData`。
