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
├── main.go              # 后端全部核心逻辑（单文件）
├── go.mod / go.sum
└── web/
    └── dist/            # 前端构建产物，go:embed 的输入
        └── index.html   # 当前为占位页
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

## 静态资源托管

`web/dist` 通过 `go:embed` 编入二进制，无需额外部署静态文件。命中 `assets/` 的构建产物返回一年 immutable 缓存；其余路径回退 `index.html` 以支持 SPA 路由；`/api/*` 未命中返回 JSON 404。

> 注意：`go:embed` 在编译期读取 `web/dist`，部署前需先完成前端构建。当前仓库内的 `index.html` 只是占位页。

## 构建部署

```bash
# FreeBSD 服务器
GOOS=freebsd GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o dinoserver .
```

配合 ZFS 服务器时，建议将 Redis 的持久化目录（RDB/AOF）放在独立 dataset 上，并对二进制与静态资源使用只读挂载。

## 开发计划

- [x] 阶段 1：后端核心（静态内嵌、提交成绩、分页排行、定位我的排名）
- [ ] 阶段 2：游戏核心（Canvas 循环、物理、碰撞、计分）
- [ ] 阶段 3：复古极客风 UI 与排行榜界面
- [ ] 阶段 4：录像采集、压缩存储与回放
- [ ] 阶段 5：反作弊、限流与运维加固

## 分支与协作

- `main`：仅由维护者审核合并，禁止直接提交
- `kilo/*`：开发分支，每次提交后以 `main` 为 base 发起 PR 供审核
