# dinoserver

仿 Chrome 恐龙跳跃游戏的独立网页游戏后端：Go + Gin 单二进制，内嵌前端静态资源，使用 Redis Sorted Set 提供全球排行榜与“一键定位我的排名”。

## 技术栈

- **后端**：Go 1.23、Gin、go-redis v9
- **存储**：Redis ZSET（`global_leaderboard`）
- **前端**：Vite + Vanilla TypeScript（构建产物输出至 `web/dist`，由 `go:embed` 打包进二进制）
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
    │   │   ├── game.ts      # Canvas 主循环、输入、状态机、生成与碰撞
    │   │   ├── dino.ts      # 恐龙物理与站立/蹲下形态
    │   │   ├── obstacles.ts # 障碍类型与间距生成
    │   │   ├── collision.ts # AABB 碰撞
    │   │   ├── sprites.ts   # 纯矩形像素绘制
    │   │   └── config.ts    # 物理与难度常量
    │   └── leaderboard/
    │       └── panel.ts     # 分页、定位、平滑滚动与闪烁高亮
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

前端不引入任何运行时框架，仅依赖 Vite 与 TypeScript，产物体积约 15 KB（gzip 约 6 KB）。

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
{ "error": "invalid_score", "message": "score 必须在 0 到 10000000 之间" }
```

### `POST /api/score`

提交成绩。Redis 使用 `ZADD ... GT`，同一用户名只保留历史最高分，低分不会覆盖高分。

```bash
curl -X POST http://localhost:8080/api/score \
  -H 'Content-Type: application/json' \
  -d '{"username":"dino","score":1024}'
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

### 操作

| 输入 | 行为 |
|---|---|
| `Space` / `↑` / 点击画布 / 触摸画布 | 开始游戏、跳跃、结束后重开 |
| `↓` | 地面蹲下；空中加速下落 |

### 玩法

- 逻辑分辨率固定 `800×240`，按 `devicePixelRatio` 缩放，窗口尺寸变化不影响物理判定。
- 重力 `2600 px/s²`，起跳初速度 `-780 px/s`；速度从 `340 px/s` 随时间加速至 `980 px/s`。
- 分数按行进距离换算，随速度提升自然加快增长。
- 障碍按距离生成（而非固定时间），保证高速下仍留有反应时间；基础仙人掌之外，分数达到 350 后出现飞鸟：低空飞鸟需蹲下，中空飞鸟需起跳。
- 碰撞盒四边内缩，减少“擦边即死”的挫败感。
- 最高分保存在 `localStorage`，游戏结束后自动 `POST /api/score`，成功后立即定位到自己的排名页。

### 排行榜面板

- 分页请求 `/api/leaderboard?page=N&limit=20`，按钮在首页/末页自动禁用，服务端返回的总页数驱动页码显示。
- “LOCATE ME” 请求 `/api/leaderboard/me`，自动切换到玩家所在页，通过 `scrollIntoView({ behavior: 'smooth', block: 'center' })` 居中，并对 `is_me` 行播放 4 次闪烁高亮；未上榜时给出提示。
- 快速连续翻页时用请求序号丢弃过期响应，避免旧数据覆盖新页面。
- 昵称保存在 `localStorage`，首次访问自动生成 `DINO-XXXX`，可在面板中修改。

## 静态资源托管

`web/dist` 通过 `go:embed` 编入二进制，无需额外部署静态文件。命中 `assets/` 的构建产物返回一年 immutable 缓存；其余路径回退 `index.html` 以支持 SPA 路由；`/api/*` 未命中返回 JSON 404。

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
- [ ] 阶段 3：视觉与交互打磨（音效、更多障碍组合、移动端细节）
- [ ] 阶段 4：录像采集、压缩存储与回放
- [ ] 阶段 5：反作弊、限流与运维加固

## 分支与协作

- `main`：仅由维护者审核合并，禁止直接提交
- `kilo/calm-mosaic-wzz`：唯一开发分支，所有提交只允许落在这里
- **固定分支 + 滚动 PR**：开发分支复用同一个 PR（base 为 `main`）；每完成一个模块，追加提交并更新 PR 描述中的改动说明，由维护者审核；PR 合并后，继续使用该分支开启下一个滚动 PR
- 每次提交同步更新本 README
