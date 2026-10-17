/**
 * compiler-config-management 类型契约测试（tasks 1.1-1.3）。
 *
 * 覆盖：
 * - schema 解析（featureToggles allowlist、cachePolicy 枚举、budgetPolicies 复用）
 * - allowlist/枚举拒绝非法值
 * - 低敏字段断言（compilerConfigContainsSensitiveFields）
 * - 版本化与兼容矩阵意识（contract-versioning）
 */
import { describe, it, expect } from 'vitest'
import {
  COMPILER_CONFIG_FEATURE_TOGGLES,
  COMPILER_CACHE_STORE_KINDS,
  compilerConfigContainsSensitiveFields,
  type CompilerConfigFeatureToggle,
  type CompilerConfigProfile,
  type CompilerConfigProfileInput,
  type CompilerEffectiveConfig,
  type CompilerConfigPreviewResponse,
  type CompilerConfigDiffEntry,
  type CompilerConfigProfileView,
  type CompilerConfigProfileHistoryResponse,
  type CompilerConfigCreateRequest,
  type CompilerConfigActivateRequest,
  type CompilerConfigCommittedView,
  type CompilerCachePolicy,
  type CompilerFeatureToggles,
  type CompilerCacheStoreKind,
} from './compiler-config-management'

// ── featureToggles allowlist ──

describe('COMPILER_CONFIG_FEATURE_TOGGLES', () => {
  it('包含首批已知开关', () => {
    expect(COMPILER_CONFIG_FEATURE_TOGGLES).toContain('stageCacheEnabled')
  })

  it('所有 toggle 为 camelCase', () => {
    for (const t of COMPILER_CONFIG_FEATURE_TOGGLES) {
      expect(t).toMatch(/^[a-z][a-zA-Z0-9]*$/)
    }
  })

  it('未知开关不在 allowlist 中', () => {
    const unknown = 'routingEnabled' as CompilerConfigFeatureToggle
    expect(COMPILER_CONFIG_FEATURE_TOGGLES).not.toContain(unknown)
  })
})

// ── cachePolicy 枚举 ──

describe('COMPILER_CACHE_STORE_KINDS', () => {
  it('包含已知 store 种类', () => {
    expect(COMPILER_CACHE_STORE_KINDS).toContain('memory')
    expect(COMPILER_CACHE_STORE_KINDS).toContain('redis')
    expect(COMPILER_CACHE_STORE_KINDS).toContain('auto')
  })

  it('所有 store kind 为小写', () => {
    for (const k of COMPILER_CACHE_STORE_KINDS) {
      expect(k).toMatch(/^[a-z]+$/)
    }
  })
})

// ── CompilerConfigProfile 结构 ──

describe('CompilerConfigProfile', () => {
  it('合法的 profile 对象通过类型检查', () => {
    const profile: CompilerConfigProfile = {
      organizationId: 1,
      version: 1,
      isActive: true,
      featureToggles: { stageCacheEnabled: true },
      budgetPolicies: [],
      cachePolicy: { policyVersion: '1', ttlSeconds: 3600, storeKind: 'auto' },
      createdBy: 42,
      createdAt: '2026-07-21T00:00:00.000Z',
    }
    expect(profile.organizationId).toBe(1)
    expect(profile.version).toBe(1)
    expect(profile.isActive).toBe(true)
    expect(profile.featureToggles.stageCacheEnabled).toBe(true)
  })

  it('空 featureToggles 允许', () => {
    const profile: CompilerConfigProfile = {
      organizationId: 1,
      version: 1,
      isActive: true,
      featureToggles: {},
      budgetPolicies: [],
      cachePolicy: null as unknown as CompilerCachePolicy,
      createdBy: 42,
      createdAt: '2026-07-21T00:00:00.000Z',
    }
    expect(Object.keys(profile.featureToggles)).toHaveLength(0)
  })

  it('cachePolicy 可缺省 storeKind', () => {
    const policy: CompilerCachePolicy = { policyVersion: '1' }
    expect(policy.policyVersion).toBe('1')
    expect(policy.ttlSeconds).toBeUndefined()
    expect(policy.storeKind).toBeUndefined()
  })
})

// ── CompilerConfigProfileInput ──

describe('CompilerConfigProfileInput', () => {
  it('所有字段可缺省', () => {
    const input: CompilerConfigProfileInput = {}
    expect(input.featureToggles).toBeUndefined()
    expect(input.budgetPolicies).toBeUndefined()
    expect(input.cachePolicy).toBeUndefined()
  })

  it('部分字段可设置', () => {
    const input: CompilerConfigProfileInput = {
      featureToggles: { stageCacheEnabled: false },
    }
    expect(input.featureToggles?.stageCacheEnabled).toBe(false)
  })
})

// ── CompilerEffectiveConfig ──

describe('CompilerEffectiveConfig', () => {
  it('profile 来源解析结果', () => {
    const config: CompilerEffectiveConfig = {
      organizationId: 1,
      sourceVersion: 2,
      source: 'profile',
      featureToggles: { stageCacheEnabled: true },
      budgetPolicyNames: ['default-policy'],
      cachePolicyVersion: '1',
      cacheTtlSeconds: 3600,
      cacheStoreKind: 'auto',
    }
    expect(config.source).toBe('profile')
    expect(config.sourceVersion).toBe(2)
  })

  it('env 默认来源解析结果', () => {
    const config: CompilerEffectiveConfig = {
      organizationId: 1,
      sourceVersion: null,
      source: 'env_default',
      featureToggles: {},
      budgetPolicyNames: [],
      cachePolicyVersion: '1',
      cacheTtlSeconds: 3600,
      cacheStoreKind: 'auto',
    }
    expect(config.source).toBe('env_default')
    expect(config.sourceVersion).toBeNull()
  })
})

// ── CompilerConfigDiffEntry ──

describe('CompilerConfigDiffEntry', () => {
  it('差异条目类型', () => {
    const diff: CompilerConfigDiffEntry = {
      path: 'featureToggles.stageCacheEnabled',
      before: false,
      after: true,
      change: 'modified',
    }
    expect(diff.change).toBe('modified')
    expect(diff.before).toBe(false)
    expect(diff.after).toBe(true)
  })

  it('变更类型枚举', () => {
    const added: CompilerConfigDiffEntry = {
      path: 'cachePolicy.ttlSeconds',
      before: null,
      after: 7200,
      change: 'added',
    }
    expect(added.change).toBe('added')
  })
})

// ── CompilerConfigPreviewResponse ──

describe('CompilerConfigPreviewResponse', () => {
  it('valid preview 响应', () => {
    const preview: CompilerConfigPreviewResponse = {
      valid: true,
      validationErrors: [],
      diff: [],
      impactPreview: {
        featureToggles: { stageCacheEnabled: true },
        budgetPolicyNames: [],
        cachePolicyVersion: '1',
      },
      prospectiveVersion: 2,
    }
    expect(preview.valid).toBe(true)
    expect(preview.prospectiveVersion).toBe(2)
  })

  it('invalid preview 含错误', () => {
    const preview: CompilerConfigPreviewResponse = {
      valid: false,
      validationErrors: ['未知开关: routingEnabled'],
      diff: [],
      impactPreview: {
        featureToggles: {},
        budgetPolicyNames: [],
        cachePolicyVersion: '1',
      },
      prospectiveVersion: 0,
    }
    expect(preview.valid).toBe(false)
    expect(preview.validationErrors).toHaveLength(1)
  })
})

// ── CompilerConfigProfileView ──

describe('CompilerConfigProfileView', () => {
  it('低敏快照视图', () => {
    const view: CompilerConfigProfileView = {
      version: 1,
      isActive: true,
      featureToggles: { stageCacheEnabled: true },
      budgetPolicyNames: ['org-default'],
      cachePolicy: { policyVersion: '1' },
      createdBy: 42,
      createdAt: '2026-07-21T00:00:00.000Z',
    }
    expect(view.budgetPolicyNames).toHaveLength(1)
    expect(view.budgetPolicyNames[0]).toBe('org-default')
  })
})

// ── CompilerConfigProfileHistoryResponse ──

describe('CompilerConfigProfileHistoryResponse', () => {
  it('含历史版本列表', () => {
    const history: CompilerConfigProfileHistoryResponse = {
      organizationId: 1,
      activeVersion: 2,
      current: {
        version: 2,
        isActive: true,
        featureToggles: { stageCacheEnabled: true },
        budgetPolicyNames: [],
        cachePolicy: { policyVersion: '1' },
        createdBy: 42,
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      history: [
        {
          version: 1,
          isActive: false,
          featureToggles: {},
          budgetPolicyNames: [],
          cachePolicy: null as unknown as CompilerCachePolicy,
          createdBy: 42,
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
    }
    expect(history.history).toHaveLength(1)
    expect(history.activeVersion).toBe(2)
  })
})

// ── 写入请求 DTO ──

describe('CompilerConfigCreateRequest', () => {
  it('创建请求须显式确认', () => {
    const req: CompilerConfigCreateRequest = {
      featureToggles: { stageCacheEnabled: true },
      confirm: true,
    }
    expect(req.confirm).toBe(true)
  })

  it('全字段创建请求', () => {
    const req: CompilerConfigCreateRequest = {
      featureToggles: { stageCacheEnabled: true },
      budgetPolicies: [
        {
          name: 'org-default',
          scope: 'organization',
          scopeValue: '1',
          enabled: true,
          onSoftLimit: 'warn',
          onHardLimit: 'block',
        },
      ],
      cachePolicy: { policyVersion: '1', ttlSeconds: 7200, storeKind: 'auto' },
      confirm: true,
    }
    expect(req.budgetPolicies).toHaveLength(1)
    expect(req.cachePolicy?.ttlSeconds).toBe(7200)
  })
})

describe('CompilerConfigActivateRequest', () => {
  it('启用请求', () => {
    const req: CompilerConfigActivateRequest = {
      version: 2,
      active: true,
      confirm: true,
    }
    expect(req.version).toBe(2)
    expect(req.active).toBe(true)
  })

  it('停用请求', () => {
    const req: CompilerConfigActivateRequest = {
      version: 1,
      active: false,
      confirm: true,
    }
    expect(req.active).toBe(false)
  })
})

describe('CompilerConfigCommittedView', () => {
  it('写入结果视图', () => {
    const view: CompilerConfigCommittedView = {
      version: 2,
      isActive: true,
      featureToggles: { stageCacheEnabled: true },
      budgetPolicyNames: ['org-default'],
      cachePolicy: { policyVersion: '1' },
    }
    expect(view.version).toBe(2)
  })
})

// ── 低敏守卫 ──

describe('compilerConfigContainsSensitiveFields', () => {
  it('允许合法的配置候选', () => {
    const allowed = {
      featureToggles: { stageCacheEnabled: true },
      budgetPolicies: [{ name: 'default', scope: 'organization', scopeValue: '1' }],
      cachePolicy: { policyVersion: '1' },
    }
    expect(compilerConfigContainsSensitiveFields(allowed).found).toBe(false)
  })

  it('拒绝含 prompt 字段的配置', () => {
    const bad = { featureToggles: { stageCacheEnabled: true }, prompt: 'hello' }
    const result = compilerConfigContainsSensitiveFields(bad)
    expect(result.found).toBe(true)
    expect(result.fieldPath).toContain('prompt')
  })

  it('拒绝含 secret 字段的配置', () => {
    const bad = { secret: 'my-secret' }
    expect(compilerConfigContainsSensitiveFields(bad).found).toBe(true)
  })

  it('拒绝含 apiKey 字段的配置', () => {
    const bad = { apiKey: 'sk-xxx' }
    expect(compilerConfigContainsSensitiveFields(bad).found).toBe(true)
  })

  it('拒绝含 token 字段的配置', () => {
    const bad = { token: 'jwt-xxx' }
    expect(compilerConfigContainsSensitiveFields(bad).found).toBe(true)
  })

  it('拒绝深层嵌套的敏感字段', () => {
    const bad = { cachePolicy: { version: '1', secret: 'hidden' } }
    const result = compilerConfigContainsSensitiveFields(bad)
    expect(result.found).toBe(true)
    expect(result.fieldPath).toContain('secret')
  })

  it('null 安全', () => {
    expect(compilerConfigContainsSensitiveFields(null).found).toBe(false)
  })

  it('undefined 安全', () => {
    expect(compilerConfigContainsSensitiveFields(undefined).found).toBe(false)
  })

  it('空对象安全', () => {
    expect(compilerConfigContainsSensitiveFields({}).found).toBe(false)
  })

  it('数组中的敏感字段', () => {
    const bad = { policies: [{ name: 'p1', secret: 's' }] }
    expect(compilerConfigContainsSensitiveFields(bad).found).toBe(true)
  })

  it('confirmToken 不误判为敏感（token 在集合外做精确匹配，confirmToken 的 key 不是 "token"）', () => {
    // 字段名精确匹配：'token' 命中，但 'confirmToken' 的 key 是 confirmToken，不是纯 token
    const result = compilerConfigContainsSensitiveFields({ confirmToken: 'abc' })
    expect(result.found).toBe(false)
  })

  it('content 被视为敏感', () => {
    const bad = { content: 'full text' }
    expect(compilerConfigContainsSensitiveFields(bad).found).toBe(true)
  })

  it('payload 被视为敏感', () => {
    const bad = { payload: { data: 'x' } }
    expect(compilerConfigContainsSensitiveFields(bad).found).toBe(true)
  })

  it('modelOutput 被视为敏感', () => {
    const bad = { modelOutput: 'generated code' }
    expect(compilerConfigContainsSensitiveFields(bad).found).toBe(true)
  })
})
