// @aiproj/types — 企业级加密与密钥管理：脱敏 helpers
// 纯函数，零运行时依赖，前后端共享。
// 用于在 KMS ledger/audit/API 响应中安全地移除或掩盖禁止字段。

import {
  KMS_FORBIDDEN_KEYS,
  isKmsForbiddenKey,
} from './enterprise-encryption-and-key-management.js'

// ──────────────────────────────────────────────
// 1. 禁止键检测
// ──────────────────────────────────────────────

/**
 * 检测对象中是否包含禁止的 key。
 * 返回所有匹配的禁止 key 列表（区分大小写）。
 */
export function detectKmsForbiddenKeys(obj: Record<string, unknown>): string[] {
  const found: string[] = []
  for (const key of Object.keys(obj)) {
    if (isKmsForbiddenKey(key) || KMS_FORBIDDEN_KEYS.includes(key as any)) {
      found.push(key)
    }
  }
  return found
}

/**
 * 深度检测对象中是否包含禁止的 key（递归）。
 */
export function detectKmsForbiddenKeysDeep(obj: unknown): string[] {
  const found: string[] = []
  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const fullPath = path ? `${path}.${key}` : key
        if (isKmsForbiddenKey(key) || KMS_FORBIDDEN_KEYS.includes(key as any)) {
          found.push(fullPath)
        }
        walk(val, fullPath)
      }
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`)
      }
    }
  }
  walk(obj, '')
  return found
}

// ──────────────────────────────────────────────
// 2. 脱敏执行
// ──────────────────────────────────────────────

/**
 * 从对象中删除禁止的 key（浅层，返回新对象）。
 */
export function redactKmsForbiddenKeys<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj } as T
  for (const key of Object.keys(result)) {
    if (isKmsForbiddenKey(key) || KMS_FORBIDDEN_KEYS.includes(key as any)) {
      delete (result as any)[key]
    }
  }
  return result
}

/**
 * 递归从对象中删除禁止的 key（深度，返回新对象）。
 */
export function redactKmsForbiddenKeysDeep<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map(redactKmsForbiddenKeysDeep) as unknown as T
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (isKmsForbiddenKey(key) || KMS_FORBIDDEN_KEYS.includes(key as any)) {
      continue // 跳过禁止 key
    }
    result[key] = redactKmsForbiddenKeysDeep(val)
  }
  return result as T
}

/**
 * 掩盖字符串值（保留前后 2 字符，中间替换为 *）。
 * 用于日志/审计中的安全展示。
 */
export function maskSecretValue(value: string): string {
  if (!value || value.length <= 4) return '****'
  return `${value.slice(0, 2)}...${value.slice(-2)}`
}

/**
 * 脱敏 KMS 事件 metadata（确保不含禁止字段）。
 */
export function redactKmsEventMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactKmsForbiddenKeys(metadata)
}

// ──────────────────────────────────────────────
// 3. 工具函数
// ──────────────────────────────────────────────

/**
 * 构建安全的低敏感 metadata（只保留允许的字段）。
 */
export function buildSafeMetadata(
  source: Record<string, unknown>,
  allowedKeys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of allowedKeys) {
    if (key in source && !isKmsForbiddenKey(key)) {
      result[key] = source[key]
    }
  }
  return result
}

/**
 * 检查 metadata 中是否有禁止的 key（返回 boolean）。
 */
export function hasKmsForbiddenKeys(obj: Record<string, unknown>): boolean {
  return detectKmsForbiddenKeys(obj).length > 0
}
