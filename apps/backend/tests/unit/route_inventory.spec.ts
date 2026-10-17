/**
 * Route Inventory 提取器单元测试
 *
 * 测试 `scripts/api-route-inventory.ts` 的 main 函数（通过 CLI 运行），
 * 覆盖嵌套 route group、prefix、命名路由、auth middleware、
 * public health 路由、dev-only 路由和路径参数场景。
 *
 * 使用 execSync 调用脚本 + JSON 输出模式，避免 AdonisJS ESM loader 限制。
 */

import { test } from '@japa/runner'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirName = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(dirName, '..', '..', '..', '..')

test.group('Route Inventory 提取器', (group) => {
  let tmpDir: string

  group.each.setup(() => {
    tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-route-inv-test-'))
  })

  group.each.teardown(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      for (const f of fs.readdirSync(tmpDir)) {
        fs.rmSync(path.join(tmpDir, f), { force: true })
      }
      fs.rmdirSync(tmpDir)
    }
  })

  /**
   * 写 routes.ts 夹具文件，通过 JSON 输出模式运行 extractRoutesFromFile。
   * 脚本通过 TEST_ROUTES_PATH 环境变量接收夹具路径。
   */
  function runExtract(routesContent: string): {
    total: number
    whitelisted: number
    rows: {
      method: string
      path: string
      openApiPath: string
      routeName: string
      classification: string
      whitelistReason: string
      middleware: string[]
      apiVersion: string
      source: string
    }[]
  } {
    const routesFile = path.join(tmpDir, 'routes.ts')
    fs.writeFileSync(routesFile, routesContent, 'utf-8')

    const scriptPath = path.join(REPO_ROOT, 'scripts', 'api-route-inventory.ts')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TEST_ROUTES_PATH: routesFile,
    }

    // 不带 --compact 标志 → JSON 输出
    let stdout = ''
    try {
      stdout = execSync(`npx tsx "${scriptPath}"`, {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (e: any) {
      stdout = e.stdout ?? ''
    }

    // 解析 JSON 输出
    const firstBrace = stdout.indexOf('{')
    const lastBrace = stdout.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace === -1) {
      console.error('No JSON found in output:', stdout.slice(0, 500))
      return { total: 0, whitelisted: 0, rows: [] }
    }

    try {
      return JSON.parse(stdout.slice(firstBrace, lastBrace + 1))
    } catch (e) {
      console.error('Failed to parse JSON:', stdout.slice(firstBrace, lastBrace + 1).slice(0, 200))
      return { total: 0, whitelisted: 0, rows: [] }
    }
  }

  test('[P0] 扁平路由：正确提取 method 和路径', async ({ assert }) => {
    const result = runExtract(`
router.get('/api/v1/health', [controllers.Health, 'index']).as('health.index')
router.post('/api/v1/auth/login', [controllers.Auth, 'login']).as('auth.login')
router.delete('/api/v1/users/:id', [controllers.Users, 'destroy']).as('users.destroy')
`)
    assert.equal(result.total, 3)
    const get = result.rows.find((r) => r.method === 'GET')
    assert.isDefined(get)
    assert.equal(get!.path, '/api/v1/health')
    assert.equal(get!.routeName, 'health.index')
    const del = result.rows.find((r) => r.method === 'DELETE')
    assert.isDefined(del)
    assert.equal(del!.path, '/api/v1/users/:id')
    assert.equal(del!.openApiPath, '/api/v1/users/{id}')
  })

  test('[P0] 嵌套 route group + prefix：正确拼接路径', async ({ assert }) => {
    const result = runExtract(`
router
  .group(() => {
    router
      .group(() => {
        router.get('users', [controllers.Users, 'index']).as('users.index')
        router.get('users/:id', [controllers.Users, 'show']).as('users.show')
      })
      .prefix('api/v1')
      .use(middleware.auth())
  })
`)
    assert.equal(result.total, 2)
    const idx = result.rows.find((r) => r.routeName === 'users.index')
    assert.isDefined(idx)
    assert.equal(idx!.path, '/api/v1/users')
    const show = result.rows.find((r) => r.routeName === 'users.show')
    assert.isDefined(show)
    assert.equal(show!.path, '/api/v1/users/:id')
  })

  test('[P0] 多层 group 前缀嵌套', async ({ assert }) => {
    const result = runExtract(`
router
  .group(() => {
    router
      .group(() => {
        router
          .group(() => {
            router.get('tasks/:taskId', [controllers.Tasks, 'show']).as('tasks.show')
          })
          .prefix('projects/:projectId')
      })
      .prefix('api/v1')
      .use(middleware.auth())
  })
`)
    assert.equal(result.total, 1)
    assert.equal(result.rows[0]!.path, '/api/v1/projects/:projectId/tasks/:taskId')
  })

  test('[P0] 命名路由：正确提取 routeName', async ({ assert }) => {
    const result = runExtract(`
router.get('/api/v1/users', [controllers.Users, 'index']).as('users.index')
router.post('/api/v1/projects', [controllers.Projects, 'store']).as('projects.store')
`)
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0]!.routeName, 'users.index')
    assert.equal(result.rows[1]!.routeName, 'projects.store')
  })

  test('[P0] auth middleware + 受保护路由分类', async ({ assert }) => {
    const result = runExtract(`
router
  .group(() => {
    router.get('projects', [controllers.Projects, 'index']).as('projects.index')
  })
  .prefix('api/v1')
  .use(middleware.auth())
`)
    assert.equal(result.total, 1)
    // 无 whitelist 前缀 → auth 分类（非 whitelist 且无 public 标记的路由默认为 auth）
    assert.equal(result.rows[0]!.classification, 'auth')
  })

  test('[P0] public health 路由：分类为 whitelist', async ({ assert }) => {
    const result = runExtract(`
router.get('/api/v1/health', [controllers.Health, 'index']).as('health.index')
router.get('/api/v1/health/ready', [controllers.Health, 'ready']).as('health.ready')
`)
    assert.equal(result.total, 2)
    assert.equal(result.rows[0]!.classification, 'whitelist')
    assert.equal(result.rows[1]!.classification, 'whitelist')
  })

  test('[P0] dev-only 路由：分类为 dev-only', async ({ assert }) => {
    const result = runExtract(`
router.get('/api/v1/dev/ai-m0/inputs', [controllers.Dev, 'inputs']).as('dev.ai-m0.inputs')
`)
    assert.equal(result.total, 1)
    assert.equal(result.rows[0]!.classification, 'dev-only')
  })

  test('[P0] 路径参数归一化为 OpenAPI 格式', async ({ assert }) => {
    const result = runExtract(`
router.get('/api/v1/projects/:projectId/tasks/:taskId', [controllers.Tasks, 'show']).as('tasks.show')
`)
    assert.equal(result.total, 1)
    assert.equal(result.rows[0]!.openApiPath, '/api/v1/projects/{projectId}/tasks/{taskId}')
  })

  test('[P0] 不匹配 /api/v1 前缀的路由被过滤', async ({ assert }) => {
    const result = runExtract(`
router.get('/', () => { return { hello: 'world' } })
router.get('/api/v2/health', [controllers.Health, 'index'])
router.get('/api/v1/health', [controllers.Health, 'index']).as('health.index')
`)
    assert.equal(result.total, 1)
    assert.equal(result.rows[0]!.path, '/api/v1/health')
  })

  test('[P0] 无 auth 且非 whitelist 的路由分类为 public', async ({ assert }) => {
    const result = runExtract(`
router.get('/api/v1/search', [controllers.Search, 'exec']).as('search.exec')
`)
    assert.equal(result.total, 1)
    assert.equal(result.rows[0]!.classification, 'public')
  })

  test('[P0] 外部 /api/v2 group 不影响 /api/v1 路由', async ({ assert }) => {
    // 模拟真实 routes.ts 结构：外部 group prefix /api/v2，内部 group prefix /api/v1
    // 路由 /api/v2/api/v1/projects 不应被算作 /api/v1 路由
    const result = runExtract(`
router
  .group(() => {
    router
      .group(() => {
        router.get('projects', [controllers.Projects, 'index']).as('projects.index')
      })
      .prefix('api/v1')
  })
  .prefix('api/v2')
  .use(middleware.apiV2Gate())
`)
    // 外部 group 的 prefix /api/v2 导致完整路径为 /api/v2/api/v1/projects
    // 不以 /api/v1 开头，所以被过滤
    assert.equal(result.total, 0)
  })

  test('[P0] 低敏感断言：输出不含敏感数据', async ({ assert }) => {
    const result = runExtract(`
router.get('/api/v1/health', [controllers.Health, 'index']).as('health.index')
router.post('/api/v1/auth/login', [controllers.Auth, 'login']).as('auth.login')
`)
    assert.isAbove(result.total, 0)
    for (const row of result.rows) {
      // Inventory rows 应只包含 method/path/openApiPath/routeName/classification 等元数据
      assert.notInclude(row.path, 'header')
      assert.notInclude(row.path, 'cookie')
      assert.notInclude(row.path, 'token')
      assert.notInclude(row.path, 'secret')
      assert.notInclude(row.path, 'password')
      assert.notInclude(row.path, 'raw-body')
      assert.notInclude(row.path, 'response')
      assert.notInclude(row.path, 'prompt')
      assert.notInclude(row.path, 'model-output')
      assert.notInclude(row.path, 'user-data')
    }
  })

  test('[P0] 输出字段完整性：所有行含必填字段', async ({ assert }) => {
    const result = runExtract(`
router.get('/api/v1/health', [controllers.Health, 'index']).as('health.index')
router.post('/api/v1/auth/login', [controllers.Auth, 'login']).as('auth.login')
`)
    assert.isAbove(result.total, 0)
    for (const row of result.rows) {
      assert.isNotEmpty(row.method)
      assert.isNotEmpty(row.path)
      assert.isNotEmpty(row.openApiPath)
      assert.isNotEmpty(row.apiVersion)
      assert.include(['auth', 'public', 'dev-only', 'whitelist'], row.classification)
      assert.isNotEmpty(row.source)
      // 进一步验证行格式
      assert.notInclude(row.method, ' ') // 方法名不含空格
      assert.isTrue(row.path.startsWith('/')) // 路径以 / 开头
    }
  })
})
