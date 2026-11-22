// DINOSERVER — 仿 Chrome 恐龙跳跃游戏的单文件后端核心。
//
// 职责：
//  1. 通过 go:embed 托管前端构建产物（web/dist），并对 SPA 路由做 index.html 回退；
//  2. 接收成绩写入 Redis ZSET（global_leaderboard），相同玩家只保留最高分；
//  3. 提供分页全球排行榜；
//  4. 提供“一键定位我的排名”，返回真实名次、所在页码及该页数据。
//
// 运行环境变量：
//
//	ADDR            监听地址，默认 ":8080"
//	REDIS_ADDR      Redis 地址，默认 "127.0.0.1:6379"
//	REDIS_PASSWORD  Redis 密码，默认空
//	REDIS_DB        Redis 数据库编号，默认 0
//	GIN_MODE        gin 运行模式，默认 release
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

const (
	// leaderboardKey 全站排行榜在 Redis 中的 ZSET key。
	leaderboardKey = "global_leaderboard"

	maxUsernameLen  = 24
	maxScore        = 10_000_000 // 单局分数上限，拦截明显异常的提交
	defaultPageSize = 20
	maxPageSize     = 100
	redisTimeout    = 3 * time.Second

	// 录像限制：单条 JSON 上限 32KB，请求体额外留出余量。
	maxReplayBytes      = 32 * 1024
	maxScoreBodyBytes   = 512 * 1024
	maxReplayInputs     = 5000
	maxReplayDurationMs = 24 * 60 * 60 * 1000
)

//go:embed all:web/dist
var embeddedAssets embed.FS

// config 汇总服务运行所需的配置。
type config struct {
	addr          string
	redisAddr     string
	redisPassword string
	redisDB       int
}

func loadConfig() (config, error) {
	cfg := config{
		addr:          envOr("ADDR", ":8080"),
		redisAddr:     envOr("REDIS_ADDR", "127.0.0.1:6379"),
		redisPassword: os.Getenv("REDIS_PASSWORD"),
	}
	if raw := os.Getenv("REDIS_DB"); raw != "" {
		db, err := strconv.Atoi(raw)
		if err != nil || db < 0 {
			return config{}, fmt.Errorf("REDIS_DB must be a non-negative integer, got %q", raw)
		}
		cfg.redisDB = db
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// server 持有 Redis 客户端与静态资源处理器。
type server struct {
	rdb    *redis.Client
	key    string
	static http.Handler
}

func newServer(rdb *redis.Client, key string) (*server, error) {
	static, err := newStaticHandler()
	if err != nil {
		return nil, err
	}
	return &server{rdb: rdb, key: key, static: static}, nil
}

// routes 注册 API 与静态资源路由。
func (s *server) routes() http.Handler {
	r := gin.New()
	r.Use(gin.Recovery(), requestLogger())

	api := r.Group("/api")
	{
		api.GET("/health", s.handleHealth)
		api.POST("/score", s.handleSubmitScore)
		api.GET("/leaderboard", s.handleLeaderboard)
		api.GET("/leaderboard/me", s.handleMyRank)
		api.GET("/replay", s.handleGetReplay)
	}

	// 未命中路由：/api/* 返回 JSON 404，其余交给静态资源（SPA 回退）。
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			writeError(c, http.StatusNotFound, "not_found", "endpoint not found")
			return
		}
		s.static.ServeHTTP(c.Writer, c.Request)
	})

	return r
}

// ---------- 静态资源 ----------

// newStaticHandler 从内嵌文件系统提供 web/dist，未知路径回退到 index.html。
func newStaticHandler() (http.Handler, error) {
	dist, err := fs.Sub(embeddedAssets, "web/dist")
	if err != nil {
		return nil, fmt.Errorf("failed to load embedded frontend assets: %w", err)
	}
	files := http.FileServer(http.FS(dist))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		info, statErr := fs.Stat(dist, name)
		if statErr != nil || info.IsDir() {
			// SPA 路由（如 /leaderboard）统一返回入口页。
			name = "index.html"
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}

		if strings.HasPrefix(name, "assets/") {
			// Vite 产物文件名带内容哈希，可长期缓存。
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	}), nil
}

// ---------- 健康检查 ----------

func (s *server) handleHealth(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), redisTimeout)
	defer cancel()

	if err := s.rdb.Ping(ctx).Err(); err != nil {
		log.Printf("health: redis ping failed: %v", err)
		writeError(c, http.StatusServiceUnavailable, "redis_unavailable", "Redis is unavailable")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// ---------- 提交成绩 ----------

type scoreRequest struct {
	Username string          `json:"username"`
	Score    int64           `json:"score"`
	Replay   json.RawMessage `json:"replay"`
}

type submitScoreResponse struct {
	Username string `json:"username"`
	Score    int64  `json:"score"` // 服务端保存的历史最高分
	Rank     int64  `json:"rank"`  // 1 起始的全球名次
	Total    int64  `json:"total"` // 上榜总人数
}

// 录像格式与 web/src/game/replay.ts 保持一致。
type replayInput struct {
	T int64  `json:"t"`
	A string `json:"a"`
	K string `json:"k,omitempty"`
}

type replayPayload struct {
	V        int           `json:"v"`
	Seed     int64         `json:"seed"`
	Duration int64         `json:"duration"`
	Inputs   []replayInput `json:"inputs"`
}

// submitScoreScript 原子完成「ZADD GT + 最高分录像写入」。
// 避免并发提交时出现排行榜已是新最高分、录像却是旧成绩的错位。
//
// KEYS[1] 排行榜 ZSET，KEYS[2] 录像 key
// ARGV[1] score，ARGV[2] username，ARGV[3] 合法 replay JSON（空串表示没有）
var submitScoreScript = redis.NewScript(`
local previous = redis.call('ZSCORE', KEYS[1], ARGV[2])
local previousScore = previous and tonumber(previous) or nil

redis.call('ZADD', KEYS[1], 'GT', ARGV[1], ARGV[2])
local best = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[2]))

local stored = 0
if ARGV[3] ~= '' then
  if not previousScore or tonumber(ARGV[1]) >= previousScore then
    redis.call('SET', KEYS[2], ARGV[3])
    stored = 1
  end
elseif previousScore and tonumber(ARGV[1]) > previousScore then
  -- 新的最高分没有录像：删除旧录像，保证录像始终对应当前最高分。
  redis.call('DEL', KEYS[2])
end

return {
  best,
  redis.call('ZREVRANK', KEYS[1], ARGV[2]),
  redis.call('ZCARD', KEYS[1]),
  stored
}
`)

func replayKey(username string) string {
	return "replay:" + username
}

func (s *server) handleSubmitScore(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxScoreBodyBytes)

	var req scoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_body", `request body must be JSON, e.g. {"username":"dino","score":1024}`)
		return
	}

	name, err := normalizeUsername(req.Username)
	if err != nil {
		writeError(c, http.StatusBadRequest, "invalid_username", err.Error())
		return
	}
	if req.Score < 0 || req.Score > maxScore {
		writeError(c, http.StatusBadRequest, "invalid_score", fmt.Sprintf("score must be between 0 and %d", maxScore))
		return
	}

	// 非法或超限的录像直接丢弃，不影响本次成绩提交。
	replayJSON := ""
	if len(req.Replay) > 0 {
		if valid, ok := normalizeReplay(req.Replay); ok {
			replayJSON = string(valid)
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), redisTimeout)
	defer cancel()

	result, err := submitScoreScript.Run(
		ctx,
		s.rdb,
		[]string{s.key, replayKey(name)},
		req.Score,
		name,
		replayJSON,
	).Result()
	if err != nil {
		s.replyRedisError(c, err)
		return
	}

	values, ok := result.([]interface{})
	if !ok || len(values) != 4 {
		log.Printf("unexpected replay script result: %#v", result)
		writeError(c, http.StatusInternalServerError, "internal_error", "unexpected server response")
		return
	}
	best, okBest := values[0].(int64)
	rank, okRank := values[1].(int64)
	total, okTotal := values[2].(int64)
	if !okBest || !okRank || !okTotal {
		log.Printf("unexpected replay script result types: %#v", values)
		writeError(c, http.StatusInternalServerError, "internal_error", "unexpected server response")
		return
	}

	c.JSON(http.StatusOK, submitScoreResponse{
		Username: name,
		Score:    best,
		Rank:     rank + 1, // ZREVRANK 从 0 开始，对外用 1 起始
		Total:    total,
	})
}

// normalizeReplay 校验并规范化录像 JSON。
// 返回规范化后的字节（剥离未知字段）；任何不合法都返回 false。
func normalizeReplay(raw json.RawMessage) ([]byte, bool) {
	if len(raw) == 0 || len(raw) > maxReplayBytes {
		return nil, false
	}

	var replay replayPayload
	if err := json.Unmarshal(raw, &replay); err != nil {
		return nil, false
	}
	if replay.V != 1 || replay.Seed < 0 || replay.Seed > math.MaxUint32 {
		return nil, false
	}
	if replay.Duration < 0 || replay.Duration > maxReplayDurationMs {
		return nil, false
	}
	if replay.Inputs == nil || len(replay.Inputs) > maxReplayInputs {
		return nil, false
	}

	lastT := int64(0)
	for _, input := range replay.Inputs {
		if input.T < 0 || input.T > replay.Duration || input.T < lastT {
			return nil, false
		}
		lastT = input.T

		switch input.A {
		case "jump", "duck":
			if input.K != "" {
				return nil, false
			}
		case "release":
			if input.K != "jump" && input.K != "duck" {
				return nil, false
			}
		default:
			return nil, false
		}
	}

	normalized, err := json.Marshal(replay)
	if err != nil || len(normalized) > maxReplayBytes {
		return nil, false
	}
	return normalized, true
}

// ---------- 观看他人录像 ----------

func (s *server) handleGetReplay(c *gin.Context) {
	name, err := normalizeUsername(c.Query("username"))
	if err != nil {
		writeError(c, http.StatusBadRequest, "invalid_username", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), redisTimeout)
	defer cancel()

	data, err := s.rdb.Get(ctx, replayKey(name)).Bytes()
	if errors.Is(err, redis.Nil) {
		writeError(c, http.StatusNotFound, "replay_not_found", "no replay for this player")
		return
	}
	if err != nil {
		s.replyRedisError(c, err)
		return
	}

	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}

// ---------- 分页排行榜 ----------

type entry struct {
	Rank      int64  `json:"rank"`
	Username  string `json:"username"`
	Score     int64  `json:"score"`
	IsMe      bool   `json:"is_me"`
	HasReplay bool   `json:"has_replay"`
}

type leaderboardResponse struct {
	Page       int64   `json:"page"`
	Limit      int     `json:"limit"`
	Total      int64   `json:"total"`
	TotalPages int64   `json:"total_pages"`
	Entries    []entry `json:"entries"`
}

func (s *server) handleLeaderboard(c *gin.Context) {
	page, limit, err := parsePagination(c)
	if err != nil {
		writeError(c, http.StatusBadRequest, "invalid_pagination", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), redisTimeout)
	defer cancel()

	// 总人数：ZSET 基数。
	total, err := s.rdb.ZCard(ctx, s.key).Result()
	if err != nil {
		s.replyRedisError(c, err)
		return
	}
	if total == 0 {
		c.JSON(http.StatusOK, leaderboardResponse{Page: 1, Limit: limit, Total: 0, Entries: []entry{}})
		return
	}

	totalPages := (total + int64(limit) - 1) / int64(limit)
	if page > totalPages {
		// 越界页收敛到最后一页，避免前端拿到空列表。
		page = totalPages
	}

	rows, err := s.fetchPage(ctx, page, limit)
	if err != nil {
		s.replyRedisError(c, err)
		return
	}

	c.JSON(http.StatusOK, leaderboardResponse{
		Page:       page,
		Limit:      limit,
		Total:      total,
		TotalPages: totalPages,
		Entries:    rows,
	})
}

// fetchPage 使用 ZREVRANGE 按分数倒序取一页数据。
// start/stop 均为 0 起始的闭区间下标。
func (s *server) fetchPage(ctx context.Context, page int64, limit int) ([]entry, error) {
	start := (page - 1) * int64(limit)
	stop := start + int64(limit) - 1

	rows, err := s.rdb.ZRevRangeWithScores(ctx, s.key, start, stop).Result()
	if err != nil {
		return nil, err
	}

	entries := make([]entry, 0, len(rows))
	for i, z := range rows {
		name, ok := z.Member.(string)
		if !ok {
			continue
		}
		entries = append(entries, entry{
			Rank:     start + int64(i) + 1,
			Username: name,
			Score:    int64(math.Round(z.Score)),
		})
	}

	// 一次 pipeline 检查本页每个玩家是否有录像；失败时降级为 false，不影响榜单。
	if len(entries) > 0 {
		pipe := s.rdb.Pipeline()
		checks := make([]*redis.IntCmd, len(entries))
		for i := range entries {
			checks[i] = pipe.Exists(ctx, replayKey(entries[i].Username))
		}
		if _, err := pipe.Exec(ctx); err != nil {
			log.Printf("replay existence check failed: %v", err)
		} else {
			for i := range entries {
				entries[i].HasReplay = checks[i].Val() > 0
			}
		}
	}
	return entries, nil
}

// ---------- 一键定位我的排名 ----------

type myRank struct {
	Rank     int64  `json:"rank"`
	Username string `json:"username"`
	Score    int64  `json:"score"`
	Page     int64  `json:"page"`
}

type myRankResponse struct {
	Page       int64   `json:"page"` // 当前返回的数据页码，等于 me.page
	Limit      int     `json:"limit"`
	Total      int64   `json:"total"`
	TotalPages int64   `json:"total_pages"`
	Me         myRank  `json:"me"`
	Entries    []entry `json:"entries"`
}

func (s *server) handleMyRank(c *gin.Context) {
	name, err := normalizeUsername(c.Query("username"))
	if err != nil {
		writeError(c, http.StatusBadRequest, "invalid_username", err.Error())
		return
	}
	limit, err := parseLimit(c)
	if err != nil {
		writeError(c, http.StatusBadRequest, "invalid_pagination", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), redisTimeout)
	defer cancel()

	// 一次 pipeline 拿到：分数、倒序名次、总人数。
	pipe := s.rdb.Pipeline()
	scoreCmd := pipe.ZScore(ctx, s.key, name)
	rankCmd := pipe.ZRevRank(ctx, s.key, name)
	totalCmd := pipe.ZCard(ctx, s.key)
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		s.replyRedisError(c, err)
		return
	}
	if errors.Is(rankCmd.Err(), redis.Nil) {
		writeError(c, http.StatusNotFound, "player_not_found", "player is not ranked yet")
		return
	}
	if err := firstCmdError(rankCmd.Err(), scoreCmd.Err(), totalCmd.Err()); err != nil {
		s.replyRedisError(c, err)
		return
	}

	// ZREVRANK 返回 0 起始名次；换算成 1 起始名次与所在页码。
	rank := rankCmd.Val()
	page := rank/int64(limit) + 1
	total := totalCmd.Val()
	totalPages := (total + int64(limit) - 1) / int64(limit)

	rows, err := s.fetchPage(ctx, page, limit)
	if err != nil {
		s.replyRedisError(c, err)
		return
	}
	// 标记“我”所在行，前端据此高亮并滚动定位。
	for i := range rows {
		if rows[i].Username == name {
			rows[i].IsMe = true
		}
	}

	c.JSON(http.StatusOK, myRankResponse{
		Page:       page,
		Limit:      limit,
		Total:      total,
		TotalPages: totalPages,
		Me: myRank{
			Rank:     rank + 1,
			Username: name,
			Score:    int64(math.Round(scoreCmd.Val())),
			Page:     page,
		},
		Entries: rows,
	})
}

// ---------- 通用工具 ----------

func normalizeUsername(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errors.New("username is required")
	}
	if utf8.RuneCountInString(name) > maxUsernameLen {
		return "", fmt.Errorf("username must be at most %d characters", maxUsernameLen)
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", errors.New("username must not contain control characters")
		}
	}
	return name, nil
}

func parsePagination(c *gin.Context) (page int64, limit int, err error) {
	page = 1
	if raw := c.Query("page"); raw != "" {
		page, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || page < 1 {
			return 0, 0, errors.New("page must be a positive integer")
		}
	}
	limit, err = parseLimit(c)
	return page, limit, err
}

func parseLimit(c *gin.Context) (int, error) {
	limit := defaultPageSize
	if raw := c.Query("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return 0, errors.New("limit must be a positive integer")
		}
		limit = n
	}
	if limit > maxPageSize {
		limit = maxPageSize
	}
	return limit, nil
}

func firstCmdError(errs ...error) error {
	for _, err := range errs {
		if err != nil && !errors.Is(err, redis.Nil) {
			return err
		}
	}
	return nil
}

func (s *server) replyRedisError(c *gin.Context, err error) {
	log.Printf("%s %s: redis operation failed: %v", c.Request.Method, c.Request.URL.Path, err)
	writeError(c, http.StatusServiceUnavailable, "redis_unavailable", "leaderboard is temporarily unavailable, please retry")
}

func writeError(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": code, "message": message})
}

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Printf("%s %s -> %d (%s)", c.Request.Method, c.Request.URL.Path, c.Writer.Status(), time.Since(start).Round(time.Microsecond))
	}
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:            cfg.redisAddr,
		Password:        cfg.redisPassword,
		DB:              cfg.redisDB,
		DialTimeout:     3 * time.Second,
		ReadTimeout:     2 * time.Second,
		WriteTimeout:    2 * time.Second,
		ConnMaxIdleTime: 5 * time.Minute,
	})
	defer rdb.Close()

	pingCtx, cancelPing := context.WithTimeout(context.Background(), 5*time.Second)
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		cancelPing()
		log.Fatalf("cannot connect to Redis (%s): %v", cfg.redisAddr, err)
	}
	cancelPing()

	srv, err := newServer(rdb, leaderboardKey)
	if err != nil {
		log.Fatalf("failed to initialize server: %v", err)
	}

	httpSrv := &http.Server{
		Addr:              cfg.addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("dinoserver listening on %s (redis=%s)", cfg.addr, cfg.redisAddr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server exited unexpectedly: %v", err)
		}
	}()

	// 优雅退出：等待 SIGINT/SIGTERM 后让进行中的请求完成。
	stopCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-stopCtx.Done()

	log.Println("shutdown signal received, closing server...")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown timed out: %v", err)
	}
}
