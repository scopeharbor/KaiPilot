/**
 * Streaming WS Replay 单元测试 vitest 配置。
 * 纯内存逻辑测试，不依赖 AdonisJS 运行时/数据库。
 */
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const backendDir = path.resolve(__dirname, '../..')

export default defineConfig({
  resolve: {
    alias: {
      '#services': path.resolve(backendDir, 'app/services'),
      '#services/streaming/streaming_ws_service': path.resolve(
        backendDir,
        'app/services/streaming/streaming_ws_service.ts',
      ),
      '#providers': path.resolve(backendDir, 'providers'),
      '#providers/socketio_provider': path.resolve(backendDir, 'providers/socketio_provider.ts'),
      '#services/streaming/streaming_ws_config': path.resolve(
        backendDir,
        'app/services/streaming/streaming_ws_config.ts',
      ),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['**/tests/unit/streaming_ws_replay*.spec.ts'],
    exclude: [],
  },
})
