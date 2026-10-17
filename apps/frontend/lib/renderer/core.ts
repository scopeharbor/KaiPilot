/**
 * renderer/core —— 确定性 UI Renderer 核心模块（§4.1 P0）。
 *
 * 实现管线：Parse -> Validate -> Resolve Props -> Render
 * 所有输入必须通过共享 zod schema 校验，不执行动态代码。
 *
 * 类型错误与 fallback 状态均有明确定义。
 */
import type {
  ProjectViewConfig,
  ViewConfig,
  DefaultEntryResolveResult,
  FallbackState,
  ValidationIssue,
} from '@aiproj/types'
import {
  projectViewConfigSchema,
  viewConfigSchema,
  migrateConfigVersion,
} from '@aiproj/compiler-spec'
import { componentRegistry } from './component-registry'
import { resolveAdapterProps } from './adapters'
import type { ReactNode } from 'react'

// ─── 渲染器错误类型 ───────────────────────────────────
export enum RendererErrorCode {
  INVALID_CONFIG = 'INVALID_CONFIG',
  UNSUPPORTED_VIEW = 'UNSUPPORTED_VIEW',
  COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND',
  ADAPTER_FAILED = 'ADAPTER_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  MIGRATION_FAILED = 'MIGRATION_FAILED',
  UNKNOWN = 'UNKNOWN',
}

export class RendererError extends Error {
  constructor(
    public code: RendererErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'RendererError'
  }
}

// ─── 渲染结果 ─────────────────────────────────────────
export interface RenderResult {
  component: ReactNode | null
  fallback?: FallbackState
  warnings?: ValidationIssue[]
}

export interface ResolvedViewConfig {
  viewConfig: ViewConfig
  projectConfig: ProjectViewConfig
  resolvedProps: Record<string, unknown>
}

// ─── Parse ────────────────────────────────────────────
export function parseProjectConfig(raw: unknown): ProjectViewConfig {
  const result = projectViewConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new RendererError(
      RendererErrorCode.INVALID_CONFIG,
      'ProjectViewConfig 校验失败',
      result.error.issues,
    )
  }
  return result.data
}

export function parseViewConfig(raw: unknown): ViewConfig {
  const result = viewConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new RendererError(
      RendererErrorCode.INVALID_CONFIG,
      'ViewConfig 校验失败',
      result.error.issues,
    )
  }
  return result.data
}

// ─── Validate ─────────────────────────────────────────
export interface ValidateResult {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export function validateViewForRender(
  config: ViewConfig,
  userPermissions: string[],
): ValidateResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  // 检查权限
  if (config.requiresPermission?.length) {
    const hasPermission = config.requiresPermission.some((p) => userPermissions.includes(p))
    if (!hasPermission) {
      errors.push({
        severity: 'error',
        code: 'PERMISSION_DENIED',
        message: `缺少权限：${config.requiresPermission.join(', ')}`,
      })
    }
  }

  // 检查视图类型是否已注册
  const registered = componentRegistry.getViewRenderer(config.type)
  if (!registered) {
    errors.push({
      severity: 'error',
      code: 'UNSUPPORTED_VIEW',
      message: `未注册的视图类型：${config.type}`,
    })
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ─── Resolve Props ───────────────────────────────────
export async function resolveProps(
  config: ViewConfig,
  projectConfig: ProjectViewConfig,
): Promise<Record<string, unknown>> {
  try {
    return await resolveAdapterProps(config, projectConfig)
  } catch (err) {
    throw new RendererError(
      RendererErrorCode.ADAPTER_FAILED,
      `Adapter 解析失败：${(err as Error).message}`,
      err,
    )
  }
}

// ─── 默认入口解析 ────────────────────────────────────
export function resolveDefaultEntry(
  projectConfig: ProjectViewConfig,
  userPermissions: string[],
): DefaultEntryResolveResult {
  const defaultView = projectConfig.views.find((v) => v.id === projectConfig.defaultViewId)

  if (!defaultView) {
    return {
      viewConfig: projectConfig,
      targetView: null,
      usedFallback: true,
      fallbackReason: 'defaultViewId 不存在于 views 数组中',
      fallbackMessage: '默认视图配置无效，将使用系统默认视图',
    }
  }

  const validation = validateViewForRender(defaultView, userPermissions)
  if (!validation.valid) {
    return {
      viewConfig: projectConfig,
      targetView: null,
      usedFallback: true,
      fallbackReason: validation.errors.map((e) => e.message).join('; '),
      fallbackMessage: '默认视图不可用，将使用系统默认视图',
      validationWarnings: validation.warnings,
    }
  }

  return {
    viewConfig: projectConfig,
    targetView: defaultView,
    usedFallback: false,
    validationWarnings: validation.warnings,
  }
}

// ─── 迁移入口配置 ─────────────────────────────────────
export function migrateProjectConfig(raw: Record<string, unknown>): {
  config: ProjectViewConfig | null
  fallback: FallbackState | null
} {
  const sv = raw.schemaVersion as number
  if (sv === 1) {
    // 当前版本直接解析
    try {
      return { config: parseProjectConfig(raw), fallback: null }
    } catch {
      return {
        config: null,
        fallback: {
          level: 'system_default',
          reason: 'SCHEMA_VALIDATION_ERROR',
          message: '配置校验失败，将使用系统默认仪表盘',
        },
      }
    }
  }

  // 尝试迁移
  const migrationResult = migrateConfigVersion(raw, sv)
  if (!migrationResult.success) {
    return {
      config: null,
      fallback: {
        level: 'system_default',
        reason: migrationResult.error || 'MIGRATION_FAILED',
        message: `配置版本 ${sv} 迁移失败，将使用系统默认视图：${migrationResult.error || '未知错误'}`,
      },
    }
  }

  try {
    const config = parseProjectConfig(migrationResult.config as Record<string, unknown>)
    return { config, fallback: null }
  } catch {
    return {
      config: null,
      fallback: {
        level: 'system_default',
        reason: 'MIGRATION_RESULT_INVALID',
        message: '迁移后的配置校验失败，将使用系统默认视图',
      },
    }
  }
}
