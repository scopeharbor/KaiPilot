/**
 * renderer-migration-facade.test —— Renderer migration adapter facade 单元测试（§4.1 P1）。
 *
 * 验证现有 migrateConfigVersion 可通过 MigrationAdapterRegistry facade 保持行为不变，
 * 保持 wire shape 与兼容性。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { MigrationAdapterRegistry } from '@aiproj/types'
import {
  RENDERER_CONTRACT_ID,
  registerRendererAdapters,
  migrateRendererConfigViaRegistry,
  checkRendererReadinessViaRegistry,
} from './renderer-migration-facade.js'
import { RENDERER_CURRENT_SCHEMA_VERSION } from './renderer-schema.js'

describe('registerRendererAdapters', () => {
  let registry: MigrationAdapterRegistry

  beforeEach(() => {
    registry = new MigrationAdapterRegistry()
  })

  it('registers adapters for all old supported versions', () => {
    registerRendererAdapters(registry)
    const adapters = registry.listAdapters(RENDERER_CONTRACT_ID)
    // 预期至少有一个 adapter（从旧版本到当前版本）
    expect(adapters.length).toBeGreaterThanOrEqual(1)
  })

  it('facade migration preserves behavior of migrateConfigVersion', () => {
    registerRendererAdapters(registry)

    const result = migrateRendererConfigViaRegistry(
      registry,
      {
        schemaVersion: 0,
        projectId: 1,
        defaultViewId: 'v1',
        views: [],
      },
      0,
    )

    expect(result.success).toBe(true)
    if (result.success && result.config) {
      const config = result.config as Record<string, unknown>
      expect(config.schemaVersion).toBe(RENDERER_CURRENT_SCHEMA_VERSION)
    }
  })

  it('rejects migration from unsupported version', () => {
    registerRendererAdapters(registry)

    const result = migrateRendererConfigViaRegistry(
      registry,
      {
        schemaVersion: 99,
        projectId: 1,
        defaultViewId: 'v1',
        views: [],
      },
      99,
    )

    expect(result.success).toBe(false)
  })

  it('facade handles same-version gracefully', () => {
    registerRendererAdapters(registry)

    const result = migrateRendererConfigViaRegistry(
      registry,
      {
        schemaVersion: RENDERER_CURRENT_SCHEMA_VERSION,
        projectId: 1,
        defaultViewId: 'v1',
        views: [],
      },
      RENDERER_CURRENT_SCHEMA_VERSION,
    )

    expect(result.success).toBe(true)
  })

  it('checkRendererReadinessViaRegistry returns ready for current version', () => {
    registerRendererAdapters(registry)
    const status = checkRendererReadinessViaRegistry(registry, {
      schemaVersion: RENDERER_CURRENT_SCHEMA_VERSION,
      projectId: 1,
      defaultViewId: 'v1',
      views: [],
    })
    expect(status.ready).toBe(true)
    expect(status.shouldMigrate).toBe(false)
  })

  it('checkRendererReadinessViaRegistry reports shouldMigrate for old version', () => {
    registerRendererAdapters(registry)
    const status = checkRendererReadinessViaRegistry(registry, {
      schemaVersion: 0,
      projectId: 1,
      defaultViewId: 'v1',
      views: [],
    })
    expect(status.ready).toBe(true)
    expect(status.shouldMigrate).toBe(true)
  })

  it('checkRendererReadinessViaRegistry returns not ready for missing schemaVersion', () => {
    registerRendererAdapters(registry)
    const status = checkRendererReadinessViaRegistry(registry, { projectId: 1 })
    expect(status.ready).toBe(false)
  })
})
