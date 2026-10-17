/**
 * renderer-migration-facade —— Renderer migration adapter facade（§4.1 P1）。
 *
 * 将 Renderer 现有 `migrateConfigVersion` 函数包装为 MigrationAdapterRegistry 兼容的 adapter，
 * 保持 wire shape 与行为不变。
 *
 * @aiproj/compiler-spec 依赖 @aiproj/types 中的版本原语，但保持自身 schema 定义独立。
 */
import { MigrationAdapterRegistry, schemaVersionToContractVersion } from '@aiproj/types'
import {
  RENDERER_CURRENT_SCHEMA_VERSION,
  RENDERER_OLD_SUPPORTED_VERSIONS,
  migrateConfigVersion as rendererMigrateFn,
} from './renderer-schema.js'

/** Renderer 配置的 contractId。 */
export const RENDERER_CONTRACT_ID = 'renderer-config-v1'

/**
 * 注册 Renderer 的迁移适配器到指定 registry。
 *
 * 将 RENDERER_OLD_SUPPORTED_VERSIONS 中的每个旧版本注册为 1.0 版的迁移 adapter，
 * 保持现有的 migrateConfigVersion 行为完全不变。
 *
 * @param registry 目标 MigrationAdapterRegistry
 */
export function registerRendererAdapters(registry: MigrationAdapterRegistry): void {
  // 从 schemaVersion 数字映射到 contractVersion 字符串
  const currentContractVersion = schemaVersionToContractVersion(RENDERER_CURRENT_SCHEMA_VERSION)

  for (const oldVersion of RENDERER_OLD_SUPPORTED_VERSIONS) {
    const fromVersion = schemaVersionToContractVersion(oldVersion)

    // 只支持相邻 major 步进
    if (oldVersion + 1 === RENDERER_CURRENT_SCHEMA_VERSION) {
      registry.register({
        contractId: RENDERER_CONTRACT_ID,
        fromVersion,
        toVersion: currentContractVersion,
        migrate: (data: unknown, _context) => {
          // 包装现有的 migrateConfigVersion 逻辑
          const config = data as Record<string, unknown>
          const result = rendererMigrateFn(config, oldVersion, RENDERER_CURRENT_SCHEMA_VERSION)

          if (!result.success) {
            return {
              success: false,
              data,
              error: result.error || 'Renderer config migration failed',
              warnings: result.warnings,
            }
          }

          // 确保迁移结果与 migrateConfigVersion 的输出完全一致
          return {
            success: true,
            data: result.config,
            warnings: result.warnings,
          }
        },
      })
    }
  }
}

/**
 * 使用 MigrationAdapterRegistry 执行 Renderer 配置迁移。
 *
 * 调用方式兼容现有 migrateConfigVersion(fromVersion, toVersion)，
 * 但通过 registry 执行以确保一致性。
 */
export function migrateRendererConfigViaRegistry(
  registry: MigrationAdapterRegistry,
  config: Record<string, unknown>,
  fromVersion: number,
  toVersion?: number,
): { success: boolean; config?: unknown; error?: string; warnings?: string[] } {
  const targetVersion = toVersion ?? RENDERER_CURRENT_SCHEMA_VERSION
  const fromContractVersion = schemaVersionToContractVersion(fromVersion)
  const toContractVersion = schemaVersionToContractVersion(targetVersion)

  try {
    const result = registry.migrate(
      RENDERER_CONTRACT_ID,
      config,
      fromContractVersion,
      toContractVersion,
    )

    return {
      success: result.success,
      config: result.success ? result.data : undefined,
      warnings: result.warnings,
      error: result.error,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown migration error',
    }
  }
}

/**
 * 验证 Renderer 配置是否可通过 registry 读取（兼容 checkConfigReadiness）。
 */
export function checkRendererReadinessViaRegistry(
  registry: MigrationAdapterRegistry,
  config: Record<string, unknown>,
): {
  ready: boolean
  shouldMigrate: boolean
  error?: string
} {
  const sv = config.schemaVersion as number | undefined
  if (sv === undefined || sv === null || typeof sv !== 'number') {
    return { ready: false, shouldMigrate: false }
  }

  if (sv === RENDERER_CURRENT_SCHEMA_VERSION) {
    return { ready: true, shouldMigrate: false }
  }

  const fromContractVersion = schemaVersionToContractVersion(sv)
  const toContractVersion = schemaVersionToContractVersion(RENDERER_CURRENT_SCHEMA_VERSION)

  const hasPath = registry.hasPath(RENDERER_CONTRACT_ID, fromContractVersion, toContractVersion)
  if (hasPath) {
    return { ready: true, shouldMigrate: true }
  }

  return {
    ready: false,
    shouldMigrate: false,
    error: `No migration path from schema version ${sv}`,
  }
}
