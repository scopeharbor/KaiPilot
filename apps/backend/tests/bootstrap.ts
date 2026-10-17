import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import { rm } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import { dbAssertions } from '@adonisjs/lucid/plugins/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import env from '#start/env'
import { listVitestStyleSpecs } from './vitest_style_specs.js'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 *
 * 注：脚手架原本在此从 `.adonisjs/client/registry/schema.d.ts` 导入 `Registry`
 * 并用它增广 `@japa/api-client` 的 `RoutesRegistry`。本项目所用的 AdonisJS 7.3.3
 * 不生成该 codegen 文件（`.adonisjs/client/` 下只有 data/manifest），
 * 且测试全部走 `client.get/post(路径)` 而非类型化的 `client.visit(路由名)`，
 * 故移除该导入与模块增广。若日后引入路由 registry codegen，再按当时的产物路径恢复。
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  dbAssertions(app),
  apiClient(),
  sessionApiClient(app),
  authApiClient(app),
]

/**
 * 从 Japa 的文件收集中排除纯逻辑 V2 编译器测试（deterministic / validation /
 * repair / draft_layer）。这些文件用 Vitest 运行并 `import ... from 'vitest'`，
 * 一旦被 Japa（node:fs/promises 的 glob）加载就会在启动阶段抛
 * "Vitest failed to access its internal state" 并让整个套件无法启动。
 *
 * 注意：设置 `exclude` 会覆盖 Japa 的默认值，故需保留默认的 node_modules/.git/coverage。
 * 这些 Vitest 套件由 `pnpm test:unit`（vitest run）单独执行并计入 `pnpm test`。
 */
export const exclude: Config['exclude'] = [
  'node_modules/**',
  '.git/**',
  'coverage/**',
  'tests/unit/compiler_code_generation_*.spec.{ts,js}',
  'tests/unit/compiler_realtime_mapper.spec.{ts,js}',
  'tests/unit/deterministic/**',
  'tests/unit/draft_generation_runner.spec.{ts,js}',
  'tests/unit/validation/**',
  'tests/unit/repair/**',
  'tests/unit/draft_layer_*.spec.{ts,js}',
  'tests/unit/dynamic-routing/**',
  'tests/unit/incremental_scanner.spec.{ts,js}',
  'tests/unit/streaming_progress_contract.spec.{ts,js}',
  'tests/unit/transport-health/**',
  'tests/unit/github_readonly_client.spec.ts',
  'tests/unit/github_connection_resolver.spec.ts',
  'tests/unit/task_ref_extractor.spec.ts',
  'tests/unit/ab-compilation/**',
  'tests/unit/outgoing_webhook_*.spec.{ts,js}',
  'tests/unit/pwa_web_push_*.spec.{ts,js}',
  'tests/unit/streaming_domain_adapters.spec.{ts,js}',
  'tests/unit/streaming_ws_*.spec.{ts,js}',
  'tests/unit/skill_eval_benchmark_provider.spec.{ts,js}',
  'tests/unit/ocr_privacy_policy.spec.{ts,js}',
  'tests/unit/ocr_entity_linking_policy.spec.{ts,js}',
  'tests/unit/ocr_privacy_policy_resolver.spec.{ts,js}',
  'tests/unit/ocr_structured_extraction_policy.spec.{ts,js}',
  'tests/unit/triz_assistant_policy.spec.{ts,js}',
  'tests/unit/bi_report_template_registry.spec.{ts,js}',
  'tests/unit/bi_report_template_service.spec.{ts,js}',
  'tests/unit/ocr_entity_linking_schema.spec.{ts,js}',
  'tests/unit/ocr_privacy_classifier.spec.{ts,js}',
  'tests/unit/ocr_structured_extraction_schema.spec.{ts,js}',
  'tests/unit/triz_assistant_api.spec.{ts,js}',
  'tests/unit/triz_assistant_audit.spec.{ts,js}',
  'tests/unit/triz_assistant_model.spec.{ts,js}',
  'tests/unit/triz_assistant_service.spec.{ts,js}',
  'tests/unit/triz_assistant_source_adapter.spec.{ts,js}',
  // v3-copilot-live-submission-channel：按内容规则排除**所有** vitest 风格 spec。
  // 上面的静态条目保留为可读记录；下面这行保证新增 vitest 风格 spec 不再因漏补
  // 名单而拖崩整个 Japa 套件（判定见 tests/vitest_style_specs.ts）。
  ...listVitestStyleSpecs(),
]

/**
 * v2-postgresql-migration-foundation (Section 2.3)：改造测试 bootstrap。
 * 当前测试默认使用 SQLite。通过设置 DB_TEST_CONNECTION=pg 可启用 PG 测试。
 * PG 测试使用独立数据库（DB_TEST_DATABASE），通过 Truncate 清理，不删除文件。
 */
const isTestPg = process.env.DB_TEST_CONNECTION === 'pg'

async function resetTestDb() {
  if (isTestPg) {
    // PG 测试：不删除文件，使用 TRUNCATE 策略。
    // 调用 testUtils.db() 的迁移回滚/运行，或依赖套件级清理。
    // testUtils.db().migrate() 在 setup 中运行，这里只做辅助清理。
    return
  }

  // SQLite 测试：删除 test.sqlite 及其 WAL/SHM 文件
  const filename = process.env.DB_TEST_DATABASE ?? 'test.sqlite'
  const dbPath = app.makePath(filename)
  await Promise.all(
    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((path) =>
      rm(path, { force: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT' && error.code !== 'EBUSY' && error.code !== 'EPERM') {
          throw error
        }
      }),
    ),
  )
}

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [
    async () => {
      // 登录期 2FA 绑定策略运行时默认 `optional`，会让「密码正确即拿到会话」的既有认证用例
      // 全部卡在绑定挑战（401）。测试默认关闭，需要该策略的用例自行 env.set 开启。
      // 原先依赖本地未入库的 `.env.test`，新 clone / CI 下缺失即整批失败，故在此兜底。
      if (!env.get('TWO_FACTOR_LOGIN_ENROLLMENT')) {
        env.set('TWO_FACTOR_LOGIN_ENROLLMENT', 'off')
      }
      await resetTestDb()
      return testUtils.db().migrate()
    },
  ],
  teardown: [],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
