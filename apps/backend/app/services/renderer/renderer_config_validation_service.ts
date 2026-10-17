/**
 * RendererConfigValidationService —— 确定性 UI Renderer 配置校验服务（§2.1 P0）。
 *
 * 职责：
 * - 校验 Config schema（使用共享 zod schema）
 * - 执行大小限制
 * - 剥离/拒绝不安全代码字段
 * - 计算配置哈希
 * - 返回结构化校验警告
 */
import { inject } from '@adonisjs/core'
import {
  projectViewConfigSchema,
  viewConfigSchema,
  validateConfigSize,
} from '@aiproj/compiler-spec'
import { createHash } from 'node:crypto'

interface RendererValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface RendererValidationOptions {
  /** 严格模式：拒绝未知字段 */
  strict?: boolean
  /** 检查大小限制 */
  checkSize?: boolean
  /** 计算确定性哈希 */
  computeHash?: boolean
  /** 参与哈希的字段路径 */
  hashPaths?: string[]
}

export interface RendererValidationOutput {
  valid: boolean
  errors: RendererValidationIssue[]
  warnings: RendererValidationIssue[]
  configHash?: string
  schemaVersion?: number
  sizeBytes?: number
}

@inject()
export default class RendererConfigValidationService {
  /**
   * 校验 ProjectViewConfig。
   * 使用共享 zod schema 执行校验，并附加安全规则。
   */
  validateProjectConfig(
    raw: unknown,
    options: RendererValidationOptions = {},
  ): RendererValidationOutput {
    const errors: RendererValidationIssue[] = []
    const warnings: RendererValidationIssue[] = []

    // 1. JSON 大小校验
    if (options.checkSize !== false) {
      const sizeCheck = validateConfigSize(raw)
      if (!sizeCheck.valid) {
        errors.push({
          severity: 'error',
          code: 'CONFIG_SIZE_EXCEEDED',
          message: sizeCheck.error || 'Config exceeds maximum size',
        })
        return { valid: false, errors, warnings }
      }
    }

    // 2. Schema 校验
    const schema = options.strict ? projectViewConfigSchema.strict() : projectViewConfigSchema
    const result = schema.safeParse(raw)

    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          severity: 'error',
          code: 'SCHEMA_VALIDATION_ERROR',
          message: issue.message,
          path: issue.path.join('.'),
        })
      }
      return { valid: false, errors, warnings }
    }

    const config = result.data

    // 3. 检查生成的代码/脚本字段（额外安全层）
    const codeWarnings = this.detectUnsafeCodeFields(raw as Record<string, unknown>)
    errors.push(...codeWarnings.map((issue) => ({ ...issue, severity: 'error' as const })))
    if (errors.length > 0) {
      return { valid: false, errors, warnings }
    }

    // 4. 检查 defaultViewId 引用有效性
    const viewIds = config.views.map((v) => v.id)
    if (!viewIds.includes(config.defaultViewId)) {
      errors.push({
        severity: 'error',
        code: 'DEFAULT_VIEW_NOT_FOUND',
        message: `defaultViewId "${config.defaultViewId}" does not match any view id in views array`,
      })
      return { valid: false, errors, warnings }
    }

    // 5. 计算哈希
    let configHash: string | undefined
    if (options.computeHash !== false) {
      configHash = this.computeConfigHash(config, options.hashPaths)
    }

    return {
      valid: true,
      errors,
      warnings,
      configHash,
      schemaVersion: config.schemaVersion,
      sizeBytes: this.estimateSize(raw),
    }
  }

  /**
   * 校验单个 ViewConfig（AI 候选用）。
   */
  validateViewConfig(raw: unknown): RendererValidationOutput {
    const errors: RendererValidationIssue[] = []
    const warnings: RendererValidationIssue[] = []

    const result = viewConfigSchema.safeParse(raw)
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          severity: 'error',
          code: 'SCHEMA_VALIDATION_ERROR',
          message: issue.message,
          path: issue.path.join('.'),
        })
      }
      return { valid: false, errors, warnings }
    }

    // 检测不安全代码
    errors.push(
      ...this.detectUnsafeCodeFields(raw as Record<string, unknown>).map((issue) => ({
        ...issue,
        severity: 'error' as const,
      })),
    )
    if (errors.length > 0) {
      return { valid: false, errors, warnings }
    }

    return { valid: true, errors, warnings }
  }

  /**
   * 检测配置中不安全代码/脚本/JSX 字段。
   * 检查常见危险模式：script、jsx、javascript:、onClick、eval、Function 等。
   */
  private detectUnsafeCodeFields(
    obj: Record<string, unknown>,
    path = '',
  ): RendererValidationIssue[] {
    const warnings: RendererValidationIssue[] = []
    const DANGEROUS_PATTERNS = [
      /<script[\s>]/i,
      /javascript\s*:/i,
      /on\w+\s*=\s*['"]/i,
      /\beval\s*\(/i,
      /\bFunction\s*\(/i,
      /new\s+Function/i,
      /setTimeout\s*\(/i,
      /setInterval\s*\(/i,
      /document\./i,
      /window\./i,
    ]

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key

      if (typeof value === 'string') {
        for (const pattern of DANGEROUS_PATTERNS) {
          if (pattern.test(value)) {
            warnings.push({
              severity: 'warning',
              code: 'UNSAFE_CODE_DETECTED',
              message: `Potential unsafe code detected in field "${currentPath}"`,
              path: currentPath,
            })
            break
          }
        }
      } else if (value && typeof value === 'object') {
        warnings.push(...this.detectUnsafeCodeFields(value as Record<string, unknown>, currentPath))
      }
    }

    return warnings
  }

  /**
   * 计算确定性配置哈希。
   * 对参与路径的字段按 key 排序后 JSON 序列化，再 SHA-256。
   */
  computeConfigHash(config: Record<string, unknown>, hashPaths?: string[]): string {
    const target = hashPaths?.length ? this.extractPaths(config, hashPaths) : config

    // 按 key 稳定排序后序列化
    const serialized = JSON.stringify(target, Object.keys(target).sort())
    return createHash('sha256').update(serialized).digest('hex')
  }

  private extractPaths(obj: Record<string, unknown>, paths: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const p of paths) {
      const value = this.getPath(obj, p)
      if (value !== undefined) {
        result[p] = value
      }
    }
    return result
  }

  private getPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj
    for (const part of parts) {
      if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }
    return current
  }

  /**
   * 估算 JSON 大小（字节）。
   */
  private estimateSize(raw: unknown): number {
    try {
      return Buffer.byteLength(JSON.stringify(raw), 'utf-8')
    } catch {
      return 0
    }
  }
}
