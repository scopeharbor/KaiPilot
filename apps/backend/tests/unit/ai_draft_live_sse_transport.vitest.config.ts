/**
 * v2-5-ai-draft-live-sse-transport 单元测试 vitest 配置。
 * 纯 TypeScript 逻辑测试，不依赖 AdonisJS 运行时。
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const configDirName = dirname(fileURLToPath(import.meta.url))
const root = resolve(configDirName, '../../../../') // repo root (apps/backend/tests/unit → aiproj/)

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      '**/tests/unit/incremental_scanner.spec.ts',
      '**/tests/unit/draft_generation_runner.spec.ts',
      '**/tests/unit/session_service.spec.ts',
      '**/tests/unit/streaming_progress_contract.spec.ts',
    ],
    exclude: [],
  },
  resolve: {
    alias: {
      '#services/ai_draft/incremental_scanner': resolve(
        root,
        'apps/backend/app/services/ai_draft/incremental_scanner.ts',
      ),
      '#services/ai_draft/draft_generation_runner': resolve(
        root,
        'apps/backend/app/services/ai_draft/draft_generation_runner.ts',
      ),
      '#services/ai_draft/session_service': resolve(
        root,
        'apps/backend/app/services/ai_draft/session_service.ts',
      ),
      '#services/ai_draft/events': resolve(root, 'apps/backend/app/services/ai_draft/events.ts'),
      '#services/ai_draft/generation_service': resolve(
        root,
        'apps/backend/app/services/ai_draft/generation_service.ts',
      ),
      '#models/ai_project_draft': resolve(root, 'apps/backend/app/models/ai_project_draft.ts'),
      '#models/ai_project_draft_version': resolve(
        root,
        'apps/backend/app/models/ai_project_draft_version.ts',
      ),
      '#models/ai_project_draft_event': resolve(
        root,
        'apps/backend/app/models/ai_project_draft_event.ts',
      ),
      '#services/tenant_scope': resolve(root, 'apps/backend/app/services/tenant_scope.ts'),
      '#exceptions/api_exception': resolve(root, 'apps/backend/app/exceptions/api_exception.ts'),
    },
  },
})
