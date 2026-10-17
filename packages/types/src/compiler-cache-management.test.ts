/**
 * compiler-cache-management 类型契约测试（tasks 2.2）。
 *
 * 覆盖：
 * - 范围枚举（CACHE_INVALIDATION_SCOPES）拒绝非法值
 * - 低敏字段断言（cacheResponseContainsSensitiveFields）
 * - 必填参数约束（stage 范围必带 stageId，cachePolicyVersion 降级说明）
 * - 版本化与兼容矩阵意识（contract-versioning）
 */
import { describe, it, expect } from 'vitest'
import {
  CACHE_INVALIDATION_SCOPES,
  cacheResponseContainsSensitiveFields,
  type CacheInvalidationScope,
  type CacheInventoryResponse,
  type CacheInvalidationPreviewResponse,
  type CacheInvalidationResponse,
  type CacheInvalidationRequest,
} from './compiler-cache-management'
import { CONTRACT_CATALOG } from './contract-versioning'

// ── 范围枚举 ──

describe('CACHE_INVALIDATION_SCOPES', () => {
  it('包含三个受控范围', () => {
    expect(CACHE_INVALIDATION_SCOPES).toEqual(['organization', 'stage', 'cachePolicyVersion'])
  })

  it('拒绝任意范围枚举（受限枚举，design D6）', () => {
    const known = new Set<string>(CACHE_INVALIDATION_SCOPES)
    expect(known.has('organization')).toBe(true)
    expect(known.has('stage')).toBe(true)
    expect(known.has('cachePolicyVersion')).toBe(true)
    expect(known.has('keyGlob' as CacheInvalidationScope)).toBe(false)
    expect(known.has('arbitraryPrefix' as CacheInvalidationScope)).toBe(false)
  })
})

// ── 低敏字段守卫 ──

describe('cacheResponseContainsSensitiveFields', () => {
  it('低敏盘点响应不被判敏感', () => {
    const inv: CacheInventoryResponse = {
      organizationId: 1,
      storeKind: 'memory',
      count: 3,
      sampleKeyHashes: ['abc'.padEnd(64, '0')],
      cachePolicyVersion: '1',
      stageCacheEnabled: true,
    }
    expect(cacheResponseContainsSensitiveFields(inv).found).toBe(false)
  })

  it('含缓存值正文字段被判敏感', () => {
    const bad = {
      organizationId: 1,
      count: 1,
      value: 'SECRET-CACHED-OUTPUT',
    }
    const r = cacheResponseContainsSensitiveFields(bad)
    expect(r.found).toBe(true)
    expect(r.fieldPath).toBe('value')
  })

  it('含 raw key 字段被判敏感', () => {
    const bad = {
      organizationId: 1,
      rawKey: 'aiproj:cache:org:1:stage:a:h1',
    }
    const r = cacheResponseContainsSensitiveFields(bad)
    expect(r.found).toBe(true)
  })

  it('含 prompt/token 字段被判敏感', () => {
    const bad = { prompt: 'system prompt', token: 'jwt-xxx' }
    expect(cacheResponseContainsSensitiveFields(bad).found).toBe(true)
    expect(cacheResponseContainsSensitiveFields({ token: 'x' }).found).toBe(true)
  })

  it('嵌套结构中的敏感字段被检出', () => {
    const bad = {
      organizationId: 1,
      sampleKeyHashes: [],
      nested: { modelOutput: 'leak' },
    }
    const r = cacheResponseContainsSensitiveFields(bad)
    expect(r.found).toBe(true)
    expect(r.fieldPath).toBe('nested.modelOutput')
  })
})

// ── 必填参数约束（编译期 + 运行期文档） ──

describe('失效请求必填参数约束', () => {
  it('stage 范围必带 stageId（类型层表达）', () => {
    const req: CacheInvalidationRequest = {
      scope: 'stage',
      stageId: 'intent_parsing',
      confirm: true,
    }
    expect(req.stageId).toBe('intent_parsing')
  })

  it('cachePolicyVersion 范围首期降级为 organization 级（note 明示）', () => {
    const preview: CacheInvalidationPreviewResponse = {
      organizationId: 1,
      scope: 'cachePolicyVersion',
      affectedCount: 5,
      sampleKeyHashes: [],
      remainingCount: 0,
      degraded: true,
      note: 'cachePolicyVersion 不在键前缀，降级为 organization 级失效',
    }
    expect(preview.degraded).toBe(true)
    expect(preview.note).toBeTruthy()
  })
})

// ── 响应类型可构造性（schema 解析意识） ──

describe('响应 DTO 可构造性', () => {
  it('CacheInvalidationResponse 仅含低敏字段', () => {
    const res: CacheInvalidationResponse = {
      organizationId: 1,
      scope: 'stage',
      removedCount: 2,
    }
    const json = JSON.stringify(res)
    expect(json).not.toContain('value')
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('artifact')
  })
})

// ── 版本化与兼容矩阵意识 ──

describe('版本化与兼容矩阵意识', () => {
  it('CONTRACT_CATALOG 可被枚举（共享契约登记入口存在）', () => {
    // 本 change 的 DTO 沿用 StageCacheSummary 低敏字段家族；
    // catalog 登记为可选（与姊妹 compiler-config-management-api 一致，未独立登记 wire contract），
    // 此处仅断言 catalog 基础设施可用，确保版本化路径存在。
    expect(typeof CONTRACT_CATALOG).toBe('object')
    expect(Object.keys(CONTRACT_CATALOG).length).toBeGreaterThan(0)
  })
})
