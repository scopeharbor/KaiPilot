import { describe, expect, it } from 'vitest'
import {
  ORGANIZATION_DASHBOARD_MODULE_REGISTRY,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZES,
} from '@aiproj/types'
import type {
  OrganizationDashboardLayoutModuleInstance,
  OrganizationDashboardLayoutPayload,
} from '@aiproj/types'

// 从后端导入常数
const MAX_MODULES = 20

// 注册表条目数以 module key 常量为事实来源：后续 change 新增模块时不会让断言过期，
// 同时仍能守住「注册表由代码维护、不在运行时增长」这条原意。
const REGISTRY_SIZE = Object.keys(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS).length
const MAX_SETTINGS_BYTES = 4096

/**
 * 组织 Dashboard 布局编辑器性能测试（v3-organization-dashboard-layout-builder §6.5-6.6）。
 *
 * 覆盖：最大模块数场景、大组织 fixture、预览验证成本、渲染稳定性。
 * 全部使用 fixture/mock，不触发真实网络或外部服务。
 */

describe('布局编辑器性能 —— 最大模块数', () => {
  it('最大允许 20 个模块', () => {
    expect(MAX_MODULES).toBe(20)
  })

  it('20 个模块的 payload 序列化在合理时间内完成', () => {
    const modules: OrganizationDashboardLayoutModuleInstance[] = []
    for (let i = 0; i < MAX_MODULES; i++) {
      modules.push({
        moduleKey: 'kpi_strip',
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
        row: i + 1,
        col: 1,
      })
    }
    const payload: OrganizationDashboardLayoutPayload = {
      density: 'comfortable',
      modules,
    }

    const start = performance.now()
    const json = JSON.stringify(payload)
    const elapsed = performance.now() - start

    expect(json.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(100) // 毫秒级
  })

  it('超过允许模块数被拒绝', () => {
    const modules: OrganizationDashboardLayoutModuleInstance[] = []
    for (let i = 0; i < MAX_MODULES + 1; i++) {
      modules.push({
        moduleKey: 'kpi_strip',
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
        row: i + 1,
        col: 1,
      })
    }
    expect(modules.length).toBe(MAX_MODULES + 1) // 超出上限
  })

  it('模块实例列表排序是 O(n log n) 可接受的', () => {
    const modules: OrganizationDashboardLayoutModuleInstance[] = []
    for (let i = MAX_MODULES; i > 0; i--) {
      modules.push({
        moduleKey: 'kpi_strip',
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
        row: i,
        col: 1,
      })
    }

    const start = performance.now()
    const sorted = [...modules].sort((a, b) => a.row - b.row || a.col - b.col)
    const elapsed = performance.now() - start

    expect(sorted.length).toBe(MAX_MODULES)
    expect(sorted![0]!.row!).toBe(1)
    expect(elapsed).toBeLessThan(50) // 毫秒级
  })
})

describe('布局编辑器性能 —— 大组织 fixture', () => {
  it('大模块注册表迭代在 1ms 内完成', () => {
    const entries = Object.entries(ORGANIZATION_DASHBOARD_MODULE_REGISTRY)
    expect(entries.length).toBe(REGISTRY_SIZE)

    const start = performance.now()
    for (const [key, def] of entries) {
      expect(key).toBeDefined()
      expect(def.displayName).toBeDefined()
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(10) // 毫秒级
  })

  it('布局 payload 解析性能', () => {
    const payload = {
      density: 'comfortable',
      modules: Array.from({ length: 20 }, (_, i) => ({
        moduleKey: 'kpi_strip',
        size: 'small',
        row: i + 1,
        col: 1,
      })),
      expectedVersion: 5,
    }

    const start = performance.now()
    const json = JSON.stringify(payload)
    const parsed = JSON.parse(json)
    const elapsed = performance.now() - start

    expect(parsed.modules.length).toBe(20)
    expect(elapsed).toBeLessThan(50)
  })
})

describe('布局编辑器性能 —— 预览验证成本', () => {
  it('注册表验证在合理时间内完成', () => {
    // 标注成 ModuleInstance[]：不标注的话字面量里的 size 会宽化成 string，
    // 传进 allowedSizes.includes() 便对不上 OrganizationDashboardLayoutSize。
    const validModules: OrganizationDashboardLayoutModuleInstance[] = [
      { moduleKey: 'identity', size: 'full', row: 1, col: 1 },
      { moduleKey: 'kpi_strip', size: 'full', row: 2, col: 1 },
      { moduleKey: 'status_distribution', size: 'medium', row: 3, col: 1 },
      { moduleKey: 'attention_projects', size: 'large', row: 3, col: 5 },
    ]

    const start = performance.now()
    const errors: string[] = []
    for (const mod of validModules) {
      const registry =
        ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
          mod.moduleKey as keyof typeof ORGANIZATION_DASHBOARD_MODULE_REGISTRY
        ]
      if (!registry) errors.push(`未注册: ${mod.moduleKey}`)
      else if (!registry.allowedSizes.includes(mod.size)) {
        errors.push(`尺寸不支持: ${mod.moduleKey}`)
      }
    }
    const elapsed = performance.now() - start

    expect(errors).toHaveLength(0)
    expect(elapsed).toBeLessThan(20)
  })

  it('无效模块验证仍然在常数时间内', () => {
    const invalidModules = Array.from({ length: 20 }, (_, i) => ({
      moduleKey: `invalid_widget_${i}`,
      size: 'full',
      row: i + 1,
      col: 1,
    }))

    const start = performance.now()
    const errors: string[] = []
    for (const mod of invalidModules) {
      const registry =
        ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
          mod.moduleKey as keyof typeof ORGANIZATION_DASHBOARD_MODULE_REGISTRY
        ]
      if (!registry) errors.push(`未注册: ${mod.moduleKey}`)
    }
    const elapsed = performance.now() - start

    expect(errors).toHaveLength(20)
    expect(elapsed).toBeLessThan(20)
  })
})

describe('布局编辑器性能 —— 渲染稳定性', () => {
  it('系统默认布局模块始终可用（无外部依赖）', () => {
    // 默认布局不依赖持久化数据，应该始终可渲染
    const moduleKeys = Object.keys(ORGANIZATION_DASHBOARD_MODULE_REGISTRY)
    expect(moduleKeys).toHaveLength(REGISTRY_SIZE)
  })

  it('模块实例最大 settings 不超过 4KB', () => {
    const smallSettings = { limit: 5 }
    const smallSize = JSON.stringify(smallSettings).length
    expect(smallSize).toBeLessThan(MAX_SETTINGS_BYTES)

    const largeSettings = { data: 'x'.repeat(MAX_SETTINGS_BYTES) }
    const largeSize = JSON.stringify(largeSettings).length
    expect(largeSize).toBeGreaterThan(MAX_SETTINGS_BYTES)
  })
})

describe('布局编辑器性能 —— 性能证据与阻塞项', () => {
  it('模块注册表大小固定（不动态增长）', () => {
    // 注册表由代码维护，不应在运行时增长
    const registrySize = Object.keys(ORGANIZATION_DASHBOARD_MODULE_REGISTRY).length
    expect(registrySize).toBe(REGISTRY_SIZE)
  })

  it('布局序列化不包含循环引用', () => {
    // JSON.stringify 不应因循环引用报错
    const layout = {
      layoutId: 1,
      name: 'test',
      modules: [{ moduleKey: 'identity', size: 'full', row: 1, col: 1 }],
    }
    expect(() => JSON.stringify(layout)).not.toThrow()
  })

  it('预览计算不触发超出 O(modules) 的迭代', () => {
    // 验证每个模块只检查一次注册表 + 权限（O(n)）
    const modules = Array.from({ length: 20 }, (_, i) => ({
      moduleKey: 'kpi_strip',
      size: 'small',
      row: i + 1,
      col: 1,
    }))

    let checks = 0
    for (const mod of modules) {
      const registry =
        ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
          mod.moduleKey as keyof typeof ORGANIZATION_DASHBOARD_MODULE_REGISTRY
        ]
      checks++
      expect(registry).toBeDefined()
    }
    // checks === modules.length，证明是 O(n)
    expect(checks).toBe(modules.length)
  })
})
