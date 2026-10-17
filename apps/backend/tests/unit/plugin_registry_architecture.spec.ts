import { test } from '@japa/runner'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * v3-plugin-private-registry-lifecycle — 静态/架构回归检查（task 7.6）。
 *
 * 五条红线（分别对应 CLAUDE.md §4 分层职责与 §6 组织隔离）：
 * 1. 新 route 必须登记进 tenant/API surface catalog——漏登记的 route 不受隔离体检覆盖；
 * 2. 私有目录查询必须带 `organization_id` 过滤（unscoped query 即越权）；
 * 3. Controller 不得直接 mutate Model（写入必须下沉 Service/Repository）；
 * 4. Policy 只判定权限，不得操作数据；
 * 5. 不得误接 `/api/v2` 或任何外部 endpoint（本增量无外部动作授权）。
 */

const BACKEND_ROOT = process.cwd()

function read(relative: string): string {
  return readFileSync(join(BACKEND_ROOT, relative), 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

const CONTROLLER = 'app/controllers/plugin_registry_controller.ts'
const POLICY = 'app/policies/plugin_registry_policy.ts'
const SERVICE_DIR = join(BACKEND_ROOT, 'app', 'services', 'plugin_registry')

const REGISTRY_MODELS = [
  'PluginPrivateRegistryEntry',
  'PluginPrivateRegistryRelease',
  'PluginPrivateRegistryOperation',
  'PluginPrivateRegistryReview',
]

test.group('PluginRegistry 架构回归', () => {
  test('全部私有目录 route 已登记进 tenant/API surface catalog', ({ assert }) => {
    const routes = read('start/routes.ts')
    const surface = read('app/services/tenant_api_surface_registry.ts')

    // 路由侧声明的每个 route name 都应能在 surface catalog 找到对应登记
    const declared = [...routes.matchAll(/api\.v1\.plugin-registry\.([a-z.-]+)/g)].map((m) => m[1]!)
    assert.isAbove(declared.length, 0, '未在 routes.ts 找到私有目录 route')

    const missing = declared.filter((name) => {
      // catalog 用下划线命名（review_queue），路由用连字符（review-queue）
      const normalized = name.replace(/-/g, '_')
      return !surface.includes(`routeName: 'plugin_registry.${normalized}'`)
    })
    assert.deepEqual(missing, [], `以下 route 未登记进 surface catalog：${missing.join(', ')}`)
  })

  test('私有目录资源已进入数据库隔离目录', ({ assert }) => {
    const isolation = read('app/services/database_isolation_catalog.ts')
    for (const table of [
      'plugin_private_registry_entries',
      'plugin_private_registry_releases',
      'plugin_private_registry_operations',
      'plugin_private_registry_reviews',
    ]) {
      assert.include(isolation, table, `隔离目录缺少表：${table}`)
    }
  })

  test('私有目录查询一律带 organization_id 过滤（无 unscoped query）', ({ assert }) => {
    const offenders: string[] = []
    for (const file of walk(SERVICE_DIR).concat(join(BACKEND_ROOT, CONTROLLER))) {
      const source = readFileSync(file, 'utf8')
      // 逐个 `Model.query()` 调用检查其后是否紧跟组织过滤
      for (const model of REGISTRY_MODELS) {
        const pattern = new RegExp(
          model.replace(/\$/g, '') + '\\.query\\(\\)([\\s\\S]{0,160})',
          'g',
        )
        for (const match of source.matchAll(pattern)) {
          if (!match[1]!.includes("'organization_id'")) {
            offenders.push(`${file.replace(BACKEND_ROOT, '')} → ${model}.query() 缺组织过滤`)
          }
        }
      }
    }
    assert.deepEqual(offenders, [], offenders.join('\n'))
  })

  test('Controller 不直接 mutate Model（写入下沉到 Service/Repository）', ({ assert }) => {
    const source = read(CONTROLLER)
    const mutations = [
      '.create(',
      '.save()',
      '.merge(',
      '.delete()',
      '.updateOrCreate(',
      '.firstOrCreate(',
    ]
    for (const mutation of mutations) {
      assert.notInclude(source, mutation, `Controller 出现直接写入：${mutation}`)
    }
  })

  test('Policy 只判定权限，不操作数据', ({ assert }) => {
    const source = read(POLICY)
    for (const forbidden of ['.query()', '.create(', '.save()', '.merge(', '.delete()']) {
      assert.notInclude(source, forbidden, `Policy 出现数据操作：${forbidden}`)
    }
    // Policy 允许依赖 RbacService 做权限求值
    assert.include(source, 'RbacService')
  })

  test('Service 层不碰 HTTP（无 HttpContext / response）', ({ assert }) => {
    const offenders: string[] = []
    for (const file of walk(SERVICE_DIR)) {
      const source = readFileSync(file, 'utf8')
      if (source.includes('HttpContext') || /\bctx\.response\b/.test(source)) {
        offenders.push(file.replace(BACKEND_ROOT, ''))
      }
    }
    assert.deepEqual(offenders, [], `Service 层出现 HTTP 依赖：${offenders.join(', ')}`)
  })

  test('未误接 /api/v2 或外部 endpoint（本增量无外部动作授权）', ({ assert }) => {
    const files = walk(SERVICE_DIR).concat(
      join(BACKEND_ROOT, CONTROLLER),
      join(BACKEND_ROOT, POLICY),
    )
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (source.includes('/api/v2')) offenders.push(`${file}: /api/v2`)
      // 外部出站：真实注册中心/上游同步需用户显式授权，本增量不得出现
      for (const outbound of ['fetch(', 'axios', 'https://registry', 'npmjs.org']) {
        if (source.includes(outbound)) offenders.push(`${file}: ${outbound}`)
      }
    }
    assert.deepEqual(offenders, [], offenders.join('\n'))
  })

  test('纯核心零 Adonis/Lucid 依赖（可被直跑）', ({ assert }) => {
    const cores = walk(SERVICE_DIR).filter((f) => f.endsWith('_core.ts'))
    assert.isAbove(cores.length, 0)
    for (const file of cores) {
      const source = readFileSync(file, 'utf8')
      assert.notInclude(source, '@adonisjs/', `${file} 引入了 Adonis 依赖`)
      assert.notInclude(source, '#models/', `${file} 引入了 Lucid 模型`)
    }
  })
})
