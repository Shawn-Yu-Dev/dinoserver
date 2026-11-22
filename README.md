# dinoserver

仿 Chrome 恐龙跳跃游戏的独立网页游戏：Go + Gin 单二进制，内嵌前端静态资源，使用 Redis Sorted Set 提供全球排行榜与“一键定位我的排名”。游戏本体直接使用 Chromium 官方 `chrome://dino` 源码（BSD-3-Clause），不自行重写。

## 技术栈

- **后端**：Go 1.23、Gin、go-redis v9
- **存储**：Redis ZSET（`global_leaderboard`）
- **前端**：Vite + Vanilla TypeScript（构建产物输出至 `web/dist`，由 `go:embed` 打包进二进制）
- **游戏引擎**：Chromium 官方 dino（`offline.js`，BSD-3-Clause）
- **部署**：单二进制，交叉编译至 FreeBSD/amd64

## 目录结构

```
.
├── main.go                  # 后端全部核心逻辑（单文件）
├── go.mod / go.sum
└── web/
    ├── index.html
    ├── package.json / tsconfig.json / vite.config.ts
    ├── src/
    │   ├── main.ts          # UI 装配：HUD、昵称、成绩上传、排行榜初始化
    │   ├── api.ts           # /api 客户端与错误封装
    │   ├── identity.ts      # localStorage 昵称
    │   ├── style.css        # 复古极客风样式与 CRT 扫描线
    │   ├── game/
    │   │   ├── runner.ts    # 官方引擎适配层：最高分、结束回调、录像录制与回放
    │   │   ├── replay.ts    # 录像类型、mulberry32、seed 生成与校验
    │   │   └── chrome/      # 原样引入的 Chromium 130 源码与许可
    │   │       ├── offline.js
    │   │       ├── offline-sprite-definitions.js
    │   │       ├── constants.js
    │   │       ├── load-time-data.js  # 独立站点的最小桩
    │   │       ├── offline.d.ts
    │   │       ├── README.md
    │   │       └── LICENSE
    │   └── leaderboard/
    │       └── panel.ts     # 分页、定位、平滑滚动与闪烁高亮
    ├── public/dino/         # 官方精灵图 1x/2x
    └── dist/                # 构建产物（已提交，go:embed 的输入）
```

## 快速开始

```bash
# 1. 启动 Redis
redis-server --port 6379

# 2. 运行服务（默认 :8080）
go run .

# 3. 健康检查
curl http://localhost:8080/api/health
```

构建并运行：

```bash
go build -o dinoserver .
./dinoserver
```

### 前端开发

```bash
cd web
npm install
npm run dev      # http://localhost:5173，/api 自动代理到 :8080
npm run build    # 类型检查并输出 web/dist
```

前端不引入任何运行时框架，仅依赖 Vite 与 TypeScript。JS 约 66 KB（gzip 约 18 KB），其中包含完整的官方 dino 引擎；`index.html` 内联了官方音效的 data URI。

### 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `ADDR` | `:8080` | HTTP 监听地址 |
| `REDIS_ADDR` | `127.0.0.1:6379` | Redis 地址 |
| `REDIS_PASSWORD` | 空 | Redis 密码 |
| `REDIS_DB` | `0` | Redis 数据库编号 |
| `GIN_MODE` | `release` | Gin 运行模式 |

## API

错误响应统一为：

```json
{ "error": "invalid_score", "message": "score must be between 0 and 10000000" }
```

### `POST /api/score`

提交成绩。Redis 使用 `ZADD ... GT`，同一用户名只保留历史最高分，低分不会覆盖高分。可选的 `replay` 字段携带本局录像，当前后端会忽略该字段（存储与压缩留待后续阶段）。

```bash
curl -X POST http://localhost:8080/api/score \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "dino",
    "score": 1024,
    "replay": {
      "v": 1,
      "seed": 915707037,
      "duration": 5782,
      "inputs": [
        { "t": 2, "a": "jump" },
        { "t": 10, "a": "release", "k": "jump" }
      ]
    }
  }'
```

```json
{ "username": "dino", "score": 1024, "rank": 1, "total": 1 }
```

约束：`username` 去空格后 1–24 字符、不含控制字符；`score` 为 `0`–`10000000` 的整数。

### `GET /api/leaderboard?page=1&limit=20`

按分数倒序返回分页排行榜。`limit` 默认 20、上限 100；页码越界时自动收敛到最后一页。

```json
{
  "page": 1,
  "limit": 2,
  "total": 4,
  "total_pages": 2,
  "entries": [
    { "rank": 1, "username": "dave", "score": 300, "is_me": false },
    { "rank": 2, "username": "bob", "score": 200, "is_me": false }
  ]
}
```

### `GET /api/leaderboard/me?username=dino&limit=20`

通过 `ZREVRANK` 计算真实名次与所在页码，返回该页数据，本人行 `is_me` 为 `true`，供前端高亮并平滑滚动定位。玩家未上榜返回 `404 player_not_found`。

```json
{
  "page": 2,
  "limit": 2,
  "total": 4,
  "total_pages": 2,
  "me": { "rank": 3, "username": "alice", "score": 100, "page": 2 },
  "entries": [
    { "rank": 3, "username": "alice", "score": 100, "is_me": true },
    { "rank": 4, "username": "carol", "score": 50, "is_me": false }
  ]
}
```

### `GET /api/health`

Redis 可用时返回 `{"status":"ok"}`。

## 游戏与排行榜

### 官方引擎

游戏本体来自 Chromium `chrome://dino`，版本 `130.0.6723.1`，完整保留官方逻辑、精灵图与音效：

- 源码：`web/src/game/chrome/`，详见该目录下的 `README.md`
- 许可：BSD-3-Clause，许可全文见 `web/src/game/chrome/LICENSE`
- 唯一源码改动：将 `chrome://resources/js/load_time_data.js` 的 import 指向本地最小桩
- 适配层 `web/src/game/runner.ts` 负责：载入本地最高分、包装 `gameOver()` 上报最终分数与录像、包装 `setPlayStatus()` 通知 UI 并开始录制

### 操作

| 输入 | 行为 |
|---|---|
| `Space` / `↑` | 开始游戏、跳跃 |
| `↓` | 地面蹲下；空中加速下落 |
| 触摸画面 | 移动端开始游戏、跳跃 |
| 点击画布 / `Enter` / 结束 1.2s 后 `Space` | 撞击后重新开始（桌面端） |
| `▶ RUN AGAIN` | 撞击后随时重开，不受冷却与页面滚动影响 |
| `⟲ REPLAY` | 用最近一局的 seed 与输入时间轴原地回放 |

界面文案全部为英文（`<html lang="en">`），服务端返回的错误信息同为英文。

### 玩法与集成

- 分数由官方 `DistanceMeter.getActualDistance()` 计算，并与画布右上角显示一致。
- 最高分保存在 `localStorage`，开局时回填官方画布的 `HI`；官方 `errorPageController` 桥接到本地存储。
- 游戏结束后自动 `POST /api/score`（附本局录像），成功后刷新排行榜并高亮自己；自动刷新**不滚动页面**，避免把游戏画布滚出视口。
- 官方键盘重开受 `isCanvasInView()` 限制：页面被排行榜滚动后，空格由 UI 接管，直接调用官方 `restart()` 并平滑滚回游戏；`RUN AGAIN` 按钮同样绕过该限制，因此可以无限重复游玩。
- 昵称输入框内阻止按键冒泡，避免编辑昵称时误触恐龙跳跃。
- 官方画布通过 CSS filter 转为荧光绿终端配色，外层叠加 CRT 扫描线，不修改渲染代码。

### 排行榜面板

- 分页请求 `/api/leaderboard?page=N&limit=20`，按钮在首页/末页自动禁用，服务端返回的总页数驱动页码显示。
- “LOCATE ME” 请求 `/api/leaderboard/me`，自动切换到玩家所在页，通过 `scrollIntoView({ behavior: 'smooth', block: 'center' })` 居中，并对 `is_me` 行播放 4 次闪烁高亮；未上榜时给出提示。
- 快速连续翻页时用请求序号丢弃过期响应，避免旧数据覆盖新页面。
- 昵称保存在 `localStorage`，首次访问自动生成 `DINO-XXXX`，可在面板中修改。

## 录像与回放

最小可用版本：录制 seed 与输入时间轴、随成绩提交、在同一画布回放。

### 数据格式

```json
{
  "v": 1,
  "seed": 915707037,
  "duration": 5782,
  "inputs": [
    { "t": 2, "a": "jump" },
    { "t": 10, "a": "release", "k": "jump" },
    { "t": 830, "a": "duck" },
    { "t": 1180, "a": "release", "k": "duck" }
  ]
}
```

- `t`：相对开局的毫秒时间戳
- `a`：`jump` / `duck` / `release`
- `k`：仅 `release` 使用，标明释放跳跃键或蹲下键
- `duration`：本局时长，便于后续服务端校验与压缩

### 录制

- 真正开局时（`setPlayStatus(true)`）生成 32 位 seed，并用 `mulberry32` **临时替换** `Math.random`，结束或回放结束时恢复。
- 在 `document` 上旁路监听键盘与指针输入，不修改官方 `offline.js`：
  - `Space` / `↑` → `jump`，`↓` → `duck`
  - 对应按键释放 → `release`
  - 画布内 `pointerdown` / `pointerup` → `jump` / `release`
- 首次开局的起跳可能先于/后于录制器执行，使用 `pendingStartJump` 保证恰好记录一次。
- 暂停/恢复不会重新播种；只在新一局开始时创建新录像。

### 提交

`submitScore(username, score, replay?)` 会在 body 中附带录像；后端当前忽略该字段，不影响原有成绩写入。

### 回放

- `playReplay(replay)`：校验录像 → 用同 seed 设置 PRNG → `scrollIntoView` 保证画布可见 → 调用官方 `restart()` → 按时间轴注入输入。
- 输入通过官方 `handleEvent()` 直接注入，避免合成 `KeyboardEvent` 的 `keyCode` 兼容问题。
- 使用自校正的 `setTimeout` 链，保留亚帧按键时机。
- 回放期间吞掉真实用户输入，不重复提交成绩，也不改写最高分与 `localStorage`。
- UI 提供 `⟲ REPLAY` 按钮，可重复回放最近一局。

### 已知边界

官方引擎按真实帧间隔推进（`performance.now()` + `requestAnimationFrame`），seed 只能保证随机序列，无法保证逐帧时间一致；云层等背景随机调用还会影响随机数消费顺序。因此回放分数可能与原局相差数分（实测 49 → 44/45），但回放流程、输入注入与“不回放成绩”均正常。要做到逐帧一致，需要固定步长循环或记录帧时间轴，留待后续阶段；录像压缩与服务端存储同理。

## 静态资源托管

`web/dist` 通过 `go:embed` 编入二进制，无需额外部署静态文件。命中 `assets/` 的构建产物返回一年 immutable 缓存；其余路径回退 `index.html` 以支持 SPA 路由；`/api/*` 未命中返回 JSON 404。官方精灵图位于 `web/public/dino/`，构建时复制到 `dist/dino/` 一并内嵌。

> `web/dist` 已随仓库提交，因此在没有 Node 环境的机器上也能直接 `go build`。修改前端后需执行 `npm run build` 并一并提交构建产物。

## 构建部署

```bash
# FreeBSD 服务器
GOOS=freebsd GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o dinoserver .
```

配合 ZFS 服务器时，建议将 Redis 的持久化目录（RDB/AOF）放在独立 dataset 上，并对二进制与静态资源使用只读挂载。

## 开发计划

- [x] 阶段 1：后端核心（静态内嵌、提交成绩、分页排行、定位我的排名）
- [x] 阶段 2：游戏主体与排行榜 UI（Canvas 循环、物理、碰撞、计分、分页与定位面板）
- [x] 阶段 3：Chromium 官方 dino 引擎、复古终端视觉、全英文界面、重复游玩修复
- [x] 阶段 4：录像采集与回放（seed + 输入时间轴、随成绩提交、REPLAY 按钮）
- [ ] 阶段 5：录像压缩与服务端存储
- [ ] 阶段 6：反作弊、限流与运维加固

## 分支与协作

- `main`：仅由维护者审核合并，禁止直接提交
- `kilo/calm-mosaic-wzz`：唯一开发分支，所有提交只允许落在这里
- **固定分支 + 滚动 PR**：开发分支复用同一个 PR（base 为 `main`）；每完成一个模块，追加提交并更新 PR 描述中的改动说明，由维护者审核；PR 合并后，继续使用该分支开启下一个滚动 PR
- 每次提交同步更新本 README
