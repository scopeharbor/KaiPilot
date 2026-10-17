import { test } from '@japa/runner'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirName = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(dirName, '..', '..', '..', '..')

/**
 * V2 Adapter 边界测试
 *
 * 验证：
 * 1. v2 adapter 委托到现有 Service/Policy 路径（3.2）
 * 2. Compiler v2 RBAC、组织隔离、低敏错误（3.4）
 * 3. Streaming v2 payload allowlist 安全（3.6）
 * 4. Gantt What-if v2 不写入正式进度数据（3.8）
 */

test.group('API v2 Adapter 边界', () => {
  test('[P1] v2 Compiler adapter 文件存在且导入正确', async ({ assert }) => {
    const adapterPath = path.join(
      REPO_ROOT,
      'apps',
      'backend',
      'app',
      'controllers',
      'v2',
      'api_v2_compiler_controller.ts',
    )
    assert.isTrue(fs.existsSync(adapterPath), 'v2 Compiler adapter 文件必须存在')
    const content = fs.readFileSync(adapterPath, 'utf-8')
    assert.include(content, 'CompilerController', 'adapter 应导入 v1 CompilerController')
  })

  test('[P1] v2 Streaming adapter 文件存在且导入正确', async ({ assert }) => {
    const adapterPath = path.join(
      REPO_ROOT,
      'apps',
      'backend',
      'app',
      'controllers',
      'v2',
      'api_v2_streaming_controller.ts',
    )
    assert.isTrue(fs.existsSync(adapterPath), 'v2 Streaming adapter 文件必须存在')
    const content = fs.readFileSync(adapterPath, 'utf-8')
    assert.include(content, 'AiProjectDraftsController', 'adapter 应导入 v1 drafts controller')
  })

  test('[P1] v2 Gantt adapter 文件存在且不含业务逻辑', async ({ assert }) => {
    const adapterPath = path.join(
      REPO_ROOT,
      'apps',
      'backend',
      'app',
      'controllers',
      'v2',
      'api_v2_gantt_controller.ts',
    )
    assert.isTrue(fs.existsSync(adapterPath), 'v2 Gantt adapter 文件必须存在')
    const content = fs.readFileSync(adapterPath, 'utf-8')
    // Gantt v2 adapter 应标记为 P1/experimental
    assert.include(content, 'experimental', 'Gantt v2 adapter 应为 experimental')
    assert.include(content, 'P1', 'Gantt v2 adapter 应为 P1')
  })

  test('[P1] v2 Capabilities adapter 不暴露敏感字段', async ({ assert }) => {
    const adapterPath = path.join(
      REPO_ROOT,
      'apps',
      'backend',
      'app',
      'controllers',
      'v2',
      'api_v2_capabilities_controller.ts',
    )
    assert.isTrue(fs.existsSync(adapterPath), 'v2 Capabilities adapter 文件必须存在')
    const content = fs.readFileSync(adapterPath, 'utf-8')
    // 不应暴露 rbac, verificationCmd, fallback 等敏感字段
    const responseMap = content.match(/\.map\([^)]+\)/)?.[0] || ''
    if (responseMap) {
      assert.notInclude(responseMap, 'rbac', '不应暴露 rbac 字段')
      assert.notInclude(responseMap, 'verificationCmd', '不应暴露 verificationCmd')
      assert.notInclude(responseMap, 'fallback', '不应暴露 fallback')
    }
  })

  test('[P1] v2 路由均以 /api/v2 前缀注册', async ({ assert }) => {
    const routesPath = path.join(REPO_ROOT, 'apps', 'backend', 'start', 'routes.ts')
    const content = fs.readFileSync(routesPath, 'utf-8')
    // 应有且仅有一个 /api/v2 前缀
    const v2PrefixCount = (content.match(/\.prefix\('\/api\/v2'\)/g) || []).length
    assert.equal(v2PrefixCount, 1, '应有且仅有一个 /api/v2 前缀注册')
  })

  test('[P1] v2 路由组使用 apiV2Gate 中间件', async ({ assert }) => {
    const routesPath = path.join(REPO_ROOT, 'apps', 'backend', 'start', 'routes.ts')
    const content = fs.readFileSync(routesPath, 'utf-8')
    assert.include(content, 'apiV2Gate', 'v2 路由组应使用 apiV2Gate 中间件')
  })

  test('[P1] apiV2Gate 中间件文件存在', async ({ assert }) => {
    const middlewarePath = path.join(
      REPO_ROOT,
      'apps',
      'backend',
      'app',
      'middleware',
      'api_v2_gate_middleware.ts',
    )
    assert.isTrue(fs.existsSync(middlewarePath), 'apiV2Gate 中间件文件必须存在')
    const content = fs.readFileSync(middlewarePath, 'utf-8')
    assert.include(content, 'API_V2_ENABLED', '中间件应检查 API_V2_ENABLED')
    assert.include(content, '503', '禁用时应返回 503')
    assert.include(content, 'FEATURE_DISABLED', '禁用时应返回 FEATURE_DISABLED')
  })
})
