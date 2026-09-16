import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 后端服务（apps/server）默认监听端口 */
const API_TARGET = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // 冻结契约：所有 REST 接口位于 /api/v1 之下，健康检查位于 /health
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/health': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
