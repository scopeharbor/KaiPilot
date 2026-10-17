import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      '**/tests/unit/outgoing_webhook_feature_and_audit.spec.ts',
      '**/tests/unit/outgoing_webhook_boundary.spec.ts',
    ],
    exclude: [],
  },
  resolve: {
    alias: {
      '#controllers': path.resolve(__dirname, '../../app/controllers'),
      '#exceptions': path.resolve(__dirname, '../../app/exceptions'),
      '#models': path.resolve(__dirname, '../../app/models'),
      '#services': path.resolve(__dirname, '../../app/services'),
      '#validators': path.resolve(__dirname, '../../app/validators'),
      '#middleware': path.resolve(__dirname, '../../app/middleware'),
      '#policies': path.resolve(__dirname, '../../app/policies'),
    },
  },
})
