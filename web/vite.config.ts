import { defineConfig } from 'vite';

// 构建产物输出到 web/dist，由 Go 后端通过 go:embed 打包。
// 开发时将 /api 代理到本地 Go 服务（默认 :8080）。
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
