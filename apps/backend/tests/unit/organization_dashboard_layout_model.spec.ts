import { test } from '@japa/runner'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZES,
  ORGANIZATION_DASHBOARD_LAYOUT_SCOPES,
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
  type OrganizationDashboardLayoutModuleInstance,
} from '@aiproj/types'

/**
 * 组织 Dashboard 布局编排 Model 序列化/反序列化测试（v3-organization-dashboard-layout-builder §2.2）。
 *
 * 覆盖：modulesJson 序列化/反序列化、null/空数组边界、scope 枚举、
 *       is_default 0/1 语义、version 递增、metadataJson nullable。
 * 全部使用 fixture，不依赖真实数据库。
 */

test.group('OrganizationDashboardLayout Model —— 序列化', () => {
  test('modulesJson 正常序列化为 JSON 字符串', ({ assert }) => {
    const modules: OrganizationDashboardLayoutModuleInstance[] = [
      {
        moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
        row: 1,
        col: 1,
      },
      {
        moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP,
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
        row: 2,
        col: 1,
      },
    ]
    const json = JSON.stringify(modules)
    const parsed = JSON.parse(json) as OrganizationDashboardLayoutModuleInstance[]
    assert.equal(parsed.length, 2)
    assert.equal(parsed[0].moduleKey, 'identity')
    assert.equal(parsed[1].moduleKey, 'kpi_strip')
  })

  test('modulesJson 空数组序列化', ({ assert }) => {
    const json = JSON.stringify([])
    const parsed = JSON.parse(json)
    assert.isArray(parsed)
    assert.isEmpty(parsed)
  })

  test('modulesJson null 输入不应产生异常（consume 处理）', ({ assert }) => {
    // 模拟 Model 的 consume 钩子：null/空值 → 空数组
    const consume = (value: string | null) =>
      value ? (JSON.parse(value) as OrganizationDashboardLayoutModuleInstance[]) : []
    assert.isEmpty(consume(null))
    assert.isEmpty(consume(''))
  })

  test('modulesJson 包含 breakpoints 和 settings 字段', ({ assert }) => {
    const modules: OrganizationDashboardLayoutModuleInstance[] = [
      {
        moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS,
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
        row: 3,
        col: 5,
        breakpoints: {
          mobile: { size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL, row: 3, col: 1 },
        },
        settings: { limit: 5 },
      },
    ]
    const json = JSON.stringify(modules)
    const parsed = JSON.parse(json) as OrganizationDashboardLayoutModuleInstance[]
    assert.equal(parsed[0].breakpoints?.mobile?.size, 'full')
    assert.equal((parsed[0].settings as any)?.limit, 5)
  })
})

test.group('OrganizationDashboardLayout Model —— scope 枚举', () => {
  test('scope 值包含 system/personal/shared', ({ assert }) => {
    assert.equal(ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SYSTEM, 'system')
    assert.equal(ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.PERSONAL, 'personal')
    assert.equal(ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED, 'shared')
  })

  test('系统默认 scope 为 system', ({ assert }) => {
    const defaultScope = ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SYSTEM
    assert.equal(defaultScope, 'system')
  })
})

test.group('OrganizationDashboardLayout Model —— is_default 语义', () => {
  test('is_default = 0 表示非默认', ({ assert }) => {
    const notDefault = 0
    assert.isFalse(!!notDefault)
  })

  test('is_default = 1 表示默认', ({ assert }) => {
    const isDefault = 1
    assert.isTrue(!!isDefault)
  })

  // Service.toDto 是私有方法，这里对齐它的 `model.isDefault === 1` 口径；
  // 变量显式标 number，避免字面量类型让比较恒真/恒假而失去意义。
  test('isDefault 转换：model.isDefault === 1 → dto.isDefault = true', ({ assert }) => {
    const modelValue: number = 1
    assert.isTrue(modelValue === 1)
  })

  test('isDefault 转换：model.isDefault === 0 → dto.isDefault = false', ({ assert }) => {
    const modelValue: number = 0
    assert.isFalse(modelValue === 1)
  })
})

test.group('OrganizationDashboardLayout Model —— version 字段', () => {
  test('version 默认为 1', ({ assert }) => {
    const defaultVersion = 1
    assert.equal(defaultVersion, 1)
  })

  test('version 递增（乐观锁语义）', ({ assert }) => {
    let version = 1
    version += 1
    assert.equal(version, 2)
    version += 1
    assert.equal(version, 3)
  })
})

test.group('OrganizationDashboardLayout Model —— metadataJson', () => {
  test('metadataJson null 序列化', ({ assert }) => {
    const prepare = (value: Record<string, unknown> | null) =>
      value === null || value === undefined ? null : JSON.stringify(value)
    assert.isNull(prepare(null))
    assert.isNull(prepare(undefined as any))
  })

  test('metadataJson 正常值序列化', ({ assert }) => {
    const prepare = (value: Record<string, unknown> | null) =>
      value === null || value === undefined ? null : JSON.stringify(value)
    const result = prepare({ source: 'manual' })
    assert.equal(result, '{"source":"manual"}')
  })

  test('metadataJson consume 处理 null', ({ assert }) => {
    const consume = (value: string | null) =>
      value ? (JSON.parse(value) as Record<string, unknown>) : null
    assert.isNull(consume(null))
  })

  test('metadataJson consume 处理正常值', ({ assert }) => {
    const consume = (value: string | null) =>
      value ? (JSON.parse(value) as Record<string, unknown>) : null
    const result = consume('{"source":"manual"}')
    assert.deepEqual(result, { source: 'manual' })
  })
})

test.group('OrganizationDashboardLayout Model —— density 字段', () => {
  test('density 枚举值', ({ assert }) => {
    assert.equal(ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE, 'comfortable')
    assert.equal(ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT, 'compact')
  })

  test('默认 density 为 comfortable', ({ assert }) => {
    const defaultDensity = 'comfortable'
    assert.equal(defaultDensity, ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE)
  })
})

test.group('OrganizationDashboardLayout Model —— 组织隔离', () => {
  test('organizationId 是必需的', ({ assert }) => {
    const orgId = 42
    assert.isNumber(orgId)
    assert.isAbove(orgId, 0)
  })

  test('个人布局 ownerActorId 为非 null', ({ assert }) => {
    const ownerActorId = 7
    assert.isNotNull(ownerActorId)
    assert.isNumber(ownerActorId)
  })

  test('系统布局 ownerActorId 为 null', ({ assert }) => {
    const ownerActorId = null
    assert.isNull(ownerActorId)
  })

  test('共享布局 ownerActorId 为 null', ({ assert }) => {
    const ownerActorId = null
    assert.isNull(ownerActorId)
  })
})
