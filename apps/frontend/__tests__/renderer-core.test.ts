/**
 * renderer 前端测试（§4.6 P0）。
 *
 * 覆盖：已注册组件解析、Adapter props 映射、缺失组件 fallback、
 * Adapter 异常 fallback、生成代码拒绝。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseProjectConfig,
  parseViewConfig,
  validateViewForRender,
  resolveDefaultEntry,
} from '@/lib/renderer/core'
import { componentRegistry, registerBuiltinRenderers } from '@/lib/renderer/component-registry'
import { resolveAdapterProps, registerAdapter } from '@/lib/renderer/adapters'
import { createFallback, FALLBACK_MESSAGES } from '@/lib/renderer/fallback'
import {
  VALID_DASHBOARD_CONFIG,
  VALID_LIST_CONFIG,
  VALID_GANTT_CONFIG,
  VALID_PROJECT_VIEW_CONFIG,
  UNSAFE_CODE_CONFIG,
} from '@aiproj/compiler-spec'

describe('ComponentRegistry (§4.2)', () => {
  beforeEach(() => {
    registerBuiltinRenderers()
  })

  it('registers built-in views', () => {
    expect(componentRegistry.hasView('dashboard')).toBe(true)
    expect(componentRegistry.hasView('list')).toBe(true)
    expect(componentRegistry.hasView('kanban')).toBe(true)
    expect(componentRegistry.hasView('gantt')).toBe(true)
    expect(componentRegistry.hasView('wbs')).toBe(true)
  })

  it('does not have unregistered types', () => {
    expect(componentRegistry.hasView('unknown-view')).toBe(false)
    expect(componentRegistry.hasView('')).toBe(false)
  })

  it('returns correct view entry metadata', () => {
    const entry = componentRegistry.getViewRenderer('dashboard')
    expect(entry).toBeDefined()
    expect(entry!.type).toBe('dashboard')
    expect(entry!.adapter).toBe('dashboard')
    expect(entry!.supported).toBe(true)
  })

  it('stubbed views are marked unsupported', () => {
    const timeline = componentRegistry.getViewRenderer('timeline')
    expect(timeline).toBeDefined()
    expect(timeline!.supported).toBe(false)

    const risk = componentRegistry.getViewRenderer('risk-matrix')
    expect(risk).toBeDefined()
    expect(risk!.supported).toBe(false)
  })
})

describe('Core: Parse (§4.1)', () => {
  it('parses valid ProjectViewConfig', () => {
    const config = parseProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    expect(config.schemaVersion).toBe(1)
    expect(config.defaultViewId).toBe('dash-1')
    expect(config.views.length).toBe(5)
  })

  it('throws on invalid config', () => {
    expect(() => parseProjectConfig({})).toThrow()
    expect(() => parseProjectConfig(null)).toThrow()
    expect(() => parseProjectConfig(undefined)).toThrow()
  })
})

describe('Core: Validate (§4.1)', () => {
  const adminPermissions = ['project:view', 'project:update', 'risk:view', 'resource:view']
  const viewerPermissions = ['project:view']

  it('validates config requiring permissions against user permissions', () => {
    const configWithPermission = {
      ...parseViewConfig(VALID_DASHBOARD_CONFIG),
      requiresPermission: ['project:view'],
    }
    const result = validateViewForRender(configWithPermission, adminPermissions)
    expect(result.valid).toBe(true)
  })

  it('fails validation for insufficient permissions', () => {
    const configWithPermission = {
      ...parseViewConfig(VALID_DASHBOARD_CONFIG),
      requiresPermission: ['risk:view'],
    }
    const result = validateViewForRender(configWithPermission, viewerPermissions)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects unregistered view types', () => {
    const badConfig = {
      ...parseViewConfig(VALID_LIST_CONFIG),
      type: 'unknown-view' as unknown as ReturnType<typeof parseViewConfig>['type'],
    }
    const result = validateViewForRender(badConfig, adminPermissions)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'UNSUPPORTED_VIEW')).toBe(true)
  })
})

describe('Core: Resolve Props (§4.1)', () => {
  it('resolves dashboard adapter props', async () => {
    const projectConfig = parseProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    const props = await resolveAdapterProps(parseViewConfig(VALID_DASHBOARD_CONFIG), projectConfig)
    expect(props.viewId).toBe('dash-1')
    expect(props.title).toBe('项目仪表盘')
    expect(props.widgets).toBeDefined()
    expect(Array.isArray(props.widgets)).toBe(true)
  })

  it('resolves list adapter props', async () => {
    const projectConfig = parseProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    const props = await resolveAdapterProps(parseViewConfig(VALID_LIST_CONFIG), projectConfig)
    expect(props.columns).toBeDefined()
    expect(props.showSearch).toBe(true)
  })

  it('resolves gantt adapter props', async () => {
    const projectConfig = parseProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    const props = await resolveAdapterProps(parseViewConfig(VALID_GANTT_CONFIG), projectConfig)
    expect(props.showCriticalPath).toBe(true)
    expect(props.timeScale).toBe('week')
  })

  it('throws for unregistered adapter', async () => {
    const projectConfig = parseProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    const badConfig = {
      ...parseViewConfig(VALID_LIST_CONFIG),
      type: 'unregistered' as unknown as ReturnType<typeof parseViewConfig>['type'],
    }
    await expect(resolveAdapterProps(badConfig, projectConfig)).rejects.toThrow()
  })
})

describe('Core: Default Entry Resolver (§4.1)', () => {
  const permissions = ['project:view', 'project:update']

  it('resolves valid default view', () => {
    const projectConfig = parseProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    const result = resolveDefaultEntry(projectConfig, permissions)
    expect(result.usedFallback).toBe(false)
    expect(result.targetView).not.toBeNull()
    expect(result.targetView!.id).toBe('dash-1')
  })

  it('falls back when defaultViewId is invalid', () => {
    const badConfig = parseProjectConfig({
      ...VALID_PROJECT_VIEW_CONFIG,
      defaultViewId: 'non-existent',
    })
    const result = resolveDefaultEntry(badConfig, permissions)
    expect(result.usedFallback).toBe(true)
    expect(result.targetView).toBeNull()
  })
})

describe('Fallback messages (§4.5)', () => {
  it('has Chinese messages for all known error codes', () => {
    expect(FALLBACK_MESSAGES.SCHEMA_VALIDATION_ERROR).toContain('系统默认视图')
    expect(FALLBACK_MESSAGES.MIGRATION_FAILED).toContain('自动升级')
    expect(FALLBACK_MESSAGES.UNKNOWN).toContain('系统默认状态')
  })

  it('creates fallback with message from code', () => {
    const fb = createFallback('system_default', 'SCHEMA_VALIDATION_ERROR')
    expect(fb.level).toBe('system_default')
    expect(fb.message).toContain('系统默认视图')
    expect(fb.reason).toBe('SCHEMA_VALIDATION_ERROR')
  })

  it('uses default message for unknown codes', () => {
    const fb = createFallback('error', 'UNKNOWN_ERROR_CODE')
    expect(fb.message).toBe(FALLBACK_MESSAGES.UNKNOWN)
  })

  it('creates fallback with original config ref', () => {
    const fb = createFallback('last_known_good', 'ADAPTER_FAILED', 'ref:view-123')
    expect(fb.originalConfigRef).toBe('ref:view-123')
  })
})

describe('Generated code rejection', () => {
  it('parseViewConfig rejects config with JSX fields', () => {
    expect(() => parseViewConfig(UNSAFE_CODE_CONFIG)).toThrow()
  })
})

describe('Adapter exception fallback', () => {
  it('resolves adapter that throws produces reject', async () => {
    registerAdapter('faulty', () => {
      throw new Error('Adapter failure')
    })
    const projectConfig = parseProjectConfig(VALID_PROJECT_VIEW_CONFIG)
    const faultyConfig = {
      ...parseViewConfig(VALID_LIST_CONFIG),
      type: 'faulty' as unknown as ReturnType<typeof parseViewConfig>['type'],
    }
    // 直接捕获断言：`rejects.toThrow(...)` 在本用例下读不到 Error.message
    // （匹配器拿到的是空串），改用显式 try/catch 断言，行为稳定且意图不变。
    let caught: unknown = null
    try {
      await resolveAdapterProps(faultyConfig, projectConfig)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('Adapter failure')
  })
})
