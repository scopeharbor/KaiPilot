// @aiproj/types — V3 AI-TRIZ 助手共享契约测试
// v3-ai-triz-assistant / §2.10–§2.11

import { describe, it, expect } from 'vitest'
import {
  AI_TRIZ_ASSISTANT_DESTINATIONS,
  AI_TRIZ_ASSISTANT_INTENTS,
  AI_TRIZ_ASSISTANT_WARNING_CODES,
  AI_TRIZ_ASSISTANT_ACTION_TYPES,
  AI_TRIZ_ASSISTANT_SOURCE_KINDS,
  AI_TRIZ_ASSISTANT_RUN_STATUSES,
  AI_TRIZ_ASSISTANT_SORT_FIELDS,
  generateAssistantRunId,
  generateAssistantMessageId,
  generateAssistantRouteDecisionId,
  generateAssistantActionId,
  generateAssistantPromptId,
  generateAssistantFeedbackId,
  computeAssistantIdempotencyKey,
  computeAssistantSourceHash,
  computeAssistantOutputHash,
  computeAssistantContextPacketHash,
  computeAssistantStableSortKey,
  compareAssistantRouteDecisions,
  isFieldSensitive,
  isPathSensitive,
  redactSensitiveFields,
  rejectSensitivePayload,
  buildTruncationWarning,
  normalizeAssistantIntent,
  computeAssistantRouteScores,
  buildAssistantRecommendedAction,
  isAssistantSourceHashStale,
  detectStaleActions,
  isAiTrizAssistantDestination,
  isAiTrizAssistantIntent,
  isAiTrizAssistantWarningCode,
  isAiTrizAssistantActionType,
  isAiTrizAssistantSourceKind,
  isAiTrizAssistantRunStatus,
  isAiTrizAssistantSortField,
  validateAssistantSubmitRequest,
  validateAssistantContextPacket,
} from './ai-triz-assistant.js'
import {
  buildAuthorizedAssistantPermissions,
  buildPartiallyAuthorizedAssistantPermissions,
  buildAssistantSourceSummary,
  buildStaleAssistantSourceSummary,
  buildAllEnabledAssistantFeatureFlags,
  buildLimitedAssistantFeatureFlags,
  buildAuthorizedAssistantContextPacket,
  buildEmptyAssistantContextPacket,
  buildLargeAssistantContextPacket,
  buildCrossOrganizationAssistantContextPacket,
  buildAssistantResponse,
  buildAiFallbackAssistantResponse,
  buildAssistantRouteDecision,
} from './ai-triz-assistant-fixtures.js'

// =============================================================================
// §2.10 — ID/Hash 稳定性
// =============================================================================

describe('ID 生成', () => {
  it('runId 有正确前缀', () => {
    const id = generateAssistantRunId()
    expect(id).toMatch(/^ata_/)
  })

  it('runId 每次都不同', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateAssistantRunId()))
    expect(ids.size).toBe(100)
  })

  it('messageId 有正确前缀', () => {
    const id = generateAssistantMessageId()
    expect(id).toMatch(/^atam_/)
  })

  it('routeDecisionId 有正确前缀', () => {
    const id = generateAssistantRouteDecisionId()
    expect(id).toMatch(/^atar_/)
  })

  it('actionId 有正确前缀', () => {
    const id = generateAssistantActionId()
    expect(id).toMatch(/^ataa_/)
  })

  it('promptId 有正确前缀', () => {
    const id = generateAssistantPromptId()
    expect(id).toMatch(/^atap_/)
  })

  it('feedbackId 有正确前缀', () => {
    const id = generateAssistantFeedbackId()
    expect(id).toMatch(/^ataf_/)
  })
})

describe('Hash 函数', () => {
  it('idempotencyKey 相同输入产生相同输出', () => {
    const key1 = computeAssistantIdempotencyKey('测试消息', ['hash_a', 'hash_b'], 42)
    const key2 = computeAssistantIdempotencyKey('测试消息', ['hash_a', 'hash_b'], 42)
    expect(key1).toBe(key2)
  })

  it('idempotencyKey sourceHashes 顺序无关', () => {
    const key1 = computeAssistantIdempotencyKey('测试消息', ['hash_b', 'hash_a'], 42)
    const key2 = computeAssistantIdempotencyKey('测试消息', ['hash_a', 'hash_b'], 42)
    expect(key1).toBe(key2)
  })

  it('idempotencyKey 不同输入产生不同输出', () => {
    const key1 = computeAssistantIdempotencyKey('消息A', ['hash_a'], 1)
    const key2 = computeAssistantIdempotencyKey('消息B', ['hash_a'], 1)
    expect(key1).not.toBe(key2)
  })

  it('sourceHash 稳定', () => {
    const h1 = computeAssistantSourceHash('摘要', 'contradiction')
    const h2 = computeAssistantSourceHash('摘要', 'contradiction')
    expect(h1).toBe(h2)
  })

  it('outputHash 稳定', () => {
    const resp = buildAssistantResponse({ intent: 'technical_contradiction' })
    const h1 = computeAssistantOutputHash(resp)
    const h2 = computeAssistantOutputHash({ ...resp })
    expect(h1).toBe(h2)
  })

  it('contextPacketHash 稳定', () => {
    const sources = [
      buildAssistantSourceSummary({ sourceKind: 'contradiction', sourceHash: 'h1' }),
      buildAssistantSourceSummary({ sourceKind: 'ifr_snapshot', sourceHash: 'h2' }),
    ]
    const h1 = computeAssistantContextPacketHash(sources)
    const h2 = computeAssistantContextPacketHash([...sources])
    expect(h1).toBe(h2)
  })
})

describe('确定性路由排序', () => {
  it('compareAssistantRouteDecisions 按置信度优先排序', () => {
    const high = buildAssistantRouteDecision({
      destination: 'contradiction_matrix',
      confidence: 'high',
      order: 0,
    })
    const low = buildAssistantRouteDecision({
      destination: 'ifr_visualization',
      confidence: 'low',
      order: 1,
    })
    expect(compareAssistantRouteDecisions(high, low)).toBeLessThan(0)
  })

  it('相同置信度按下标排序', () => {
    const a = buildAssistantRouteDecision({
      destination: 'contradiction_matrix',
      confidence: 'medium',
      order: 0,
    })
    const b = buildAssistantRouteDecision({
      destination: 'technical_contradiction_analyzer',
      confidence: 'medium',
      order: 1,
    })
    expect(compareAssistantRouteDecisions(a, b)).toBeLessThan(0)
  })

  it('稳定排序键对相同输入产生相同结果', () => {
    const key1 = computeAssistantStableSortKey('contradiction_matrix', 'high', 0)
    const key2 = computeAssistantStableSortKey('contradiction_matrix', 'high', 0)
    expect(key1).toBe(key2)
  })
})

describe('动作元数据', () => {
  it('buildAssistantRecommendedAction 携带所有必需字段', () => {
    const action = buildAssistantRecommendedAction({
      destination: 'contradiction_matrix',
      actionType: 'navigate',
      sourceRefs: ['ref-1'],
      sourceHashes: ['hash-1'],
      requiredPermissions: ['triz_assistant:view'],
      requiresUserConfirmation: true,
      lowSensitivitySummary: '打开矛盾矩阵',
    })
    expect(action.actionId).toMatch(/^ataa_/)
    expect(action.destination).toBe('contradiction_matrix')
    expect(action.requiresUserConfirmation).toBe(true)
    expect(action.isStale).toBe(false)
    expect(action.sourceRefs).toContain('ref-1')
    expect(action.sourceHashes).toContain('hash-1')
  })

  it('action label 使用审查导向文案', () => {
    const action = buildAssistantRecommendedAction({
      destination: 'contradiction_matrix',
      actionType: 'view_evidence',
      sourceRefs: [],
      sourceHashes: [],
      requiredPermissions: [],
      requiresUserConfirmation: false,
      lowSensitivitySummary: '查看依据',
    })
    expect(action.label).toBe('查看依据')
  })
})

describe('source hash stale 检测', () => {
  it('isAssistantSourceHashStale 检测陈旧 hash', () => {
    expect(isAssistantSourceHashStale('new_hash', ['old_hash_1', 'old_hash_2'])).toBe(true)
  })

  it('isAssistantSourceHashStale 检测匹配 hash', () => {
    expect(isAssistantSourceHashStale('hash_1', ['hash_1', 'hash_2'])).toBe(false)
  })

  it('detectStaleActions 标记陈旧动作', () => {
    const action = buildAssistantRecommendedAction({
      destination: 'contradiction_matrix',
      actionType: 'navigate',
      sourceRefs: ['ref-1'],
      sourceHashes: ['old_hash'],
      requiredPermissions: [],
      requiresUserConfirmation: false,
      lowSensitivitySummary: '测试',
    })

    const currentHashes = new Map([['ref-1', 'new_hash']])
    const updated = detectStaleActions([action], currentHashes)
    expect(updated[0].isStale).toBe(true)
    expect(updated[0].staleReason).toBeDefined()
  })
})

describe('目的地枚举覆盖', () => {
  it('全部 12 个目的地已定义', () => {
    expect(AI_TRIZ_ASSISTANT_DESTINATIONS).toHaveLength(12)
  })

  it('类型守卫正确', () => {
    expect(isAiTrizAssistantDestination('contradiction_matrix')).toBe(true)
    expect(isAiTrizAssistantDestination('invalid')).toBe(false)
  })

  it('意图类型守卫正确', () => {
    expect(isAiTrizAssistantIntent('technical_contradiction')).toBe(true)
    expect(isAiTrizAssistantIntent('invalid_intent')).toBe(false)
  })

  it('警告代码类型守卫正确', () => {
    expect(isAiTrizAssistantWarningCode('SOURCE_STALE')).toBe(true)
    expect(isAiTrizAssistantWarningCode('INVALID_CODE')).toBe(false)
  })

  it('动作类型守卫正确', () => {
    expect(isAiTrizAssistantActionType('navigate')).toBe(true)
    expect(isAiTrizAssistantActionType('execute')).toBe(false)
  })

  it('来源类型守卫正确', () => {
    expect(isAiTrizAssistantSourceKind('contradiction')).toBe(true)
    expect(isAiTrizAssistantSourceKind('unknown_source')).toBe(false)
  })

  it('运行状态守卫正确', () => {
    expect(isAiTrizAssistantRunStatus('active')).toBe(true)
    expect(isAiTrizAssistantRunStatus('invalid_status')).toBe(false)
  })

  it('排序字段守卫正确', () => {
    expect(isAiTrizAssistantSortField('createdAt')).toBe(true)
    expect(isAiTrizAssistantSortField('invalidField')).toBe(false)
  })
})

// =============================================================================
// §2.11 — 上下文脱敏
// =============================================================================

describe('敏感字段检测', () => {
  it('isFieldSensitive 拒绝 prompt', () => {
    expect(isFieldSensitive('prompt')).toBe(true)
    expect(isFieldSensitive('fullPrompt')).toBe(true)
  })

  it('isFieldSensitive 拒绝 modelOutput', () => {
    expect(isFieldSensitive('modelOutput')).toBe(true)
    expect(isFieldSensitive('completion')).toBe(true)
  })

  it('isFieldSensitive 拒绝 secret/token/auth', () => {
    expect(isFieldSensitive('secret')).toBe(true)
    expect(isFieldSensitive('token')).toBe(true)
    expect(isFieldSensitive('authorization')).toBe(true)
    expect(isFieldSensitive('authHeader')).toBe(true)
    expect(isFieldSensitive('apiKey')).toBe(true)
  })

  it('isFieldSensitive 拒绝隐藏字段', () => {
    expect(isFieldSensitive('hiddenCount')).toBe(true)
    expect(isFieldSensitive('hiddenId')).toBe(true)
    expect(isFieldSensitive('inaccessibleTitle')).toBe(true)
  })

  it('isFieldSensitive 允许安全字段', () => {
    expect(isFieldSensitive('sourceKind')).toBe(false)
    expect(isFieldSensitive('lowSensitivitySummary')).toBe(false)
    expect(isFieldSensitive('warning')).toBe(false)
    expect(isFieldSensitive('createdAt')).toBe(false)
  })
})

describe('敏感路径检测', () => {
  it('isPathSensitive 拒绝 Unix 敏感路径', () => {
    expect(isPathSensitive('/etc/passwd')).toBe(true)
    expect(isPathSensitive('/home/user/.ssh/id_rsa')).toBe(true)
    expect(isPathSensitive('/home/user/.aws/credentials')).toBe(true)
  })

  it('isPathSensitive 拒绝 Windows 敏感路径', () => {
    expect(isPathSensitive('C:\\Windows\\System32\\config')).toBe(true)
    expect(isPathSensitive('D:\\Users\\admin\\.ssh\\id_rsa')).toBe(true)
  })

  it('isPathSensitive 拒绝 .env 文件', () => {
    expect(isPathSensitive('/app/.env')).toBe(true)
    expect(isPathSensitive('C:\\project\\.env')).toBe(true)
  })

  it('isPathSensitive 允许安全路径', () => {
    expect(isPathSensitive('/app/src/index.ts')).toBe(false)
    expect(isPathSensitive('src/components/Button.tsx')).toBe(false)
  })
})

describe('redactSensitiveFields', () => {
  it('移除敏感字段', () => {
    const obj = {
      sourceKind: 'contradiction',
      prompt: 'should be removed',
      lowSensitivitySummary: 'safe',
    }
    const { redacted, rejectedFields } = redactSensitiveFields(obj, Object.keys(obj))
    expect(redacted).not.toHaveProperty('prompt')
    expect(redacted).toHaveProperty('sourceKind')
    expect(rejectedFields).toContain('prompt')
  })

  it('保留安全字段', () => {
    const obj = {
      sourceKind: 'contradiction',
      lowSensitivitySummary: 'safe summary',
      createdAt: '2024-01-01',
    }
    const { redacted, rejectedFields } = redactSensitiveFields(obj, Object.keys(obj))
    expect(redacted).toEqual(obj)
    expect(rejectedFields).toHaveLength(0)
  })
})

describe('rejectSensitivePayload', () => {
  it('拒绝包含 prompt 字段的 payload', () => {
    const { safe, rejectedKeys } = rejectSensitivePayload({
      message: 'hello',
      prompt: 'secret instruction',
    })
    expect(safe).toBe(false)
    expect(rejectedKeys).toContain('prompt')
  })

  it('接受安全 payload', () => {
    const { safe, rejectedKeys } = rejectSensitivePayload({
      message: 'hello',
      sourceRef: 'ref-1',
    })
    expect(safe).toBe(true)
    expect(rejectedKeys).toHaveLength(0)
  })

  it('拒绝包含敏感路径的 payload', () => {
    const { safe, rejectedKeys } = rejectSensitivePayload({
      filePath: '/etc/passwd',
    })
    expect(safe).toBe(false)
    expect(rejectedKeys).toContain('filePath')
  })
})

describe('truncationWarning', () => {
  it('生成截断警告消息', () => {
    const warning = buildTruncationWarning(50, 20, 8192)
    expect(warning).toContain('50')
    expect(warning).toContain('20')
    expect(warning).toContain('8192')
  })
})

// =============================================================================
// 意图规范化
// =============================================================================

describe('normalizeAssistantIntent', () => {
  it('识别技术矛盾意图', () => {
    expect(normalizeAssistantIntent('如何改善质量但降低速度')).toBe('technical_contradiction')
    expect(normalizeAssistantIntent('需要权衡成本和性能')).toBe('technical_contradiction')
  })

  it('识别物理矛盾意图', () => {
    expect(normalizeAssistantIntent('既要温度高又要温度低')).toBe('physical_contradiction')
    expect(normalizeAssistantIntent('不同条件下需要相反的状态')).toBe('physical_contradiction')
  })

  it('识别缺失信息意图', () => {
    expect(normalizeAssistantIntent('我不确定还需要什么信息')).toBe('missing_information')
    expect(normalizeAssistantIntent('缺少关键数据')).toBe('missing_information')
  })

  it('识别决策意图', () => {
    expect(normalizeAssistantIntent('需要做一个决定')).toBe('decision')
    expect(normalizeAssistantIntent('帮我判断选哪个方案')).toBe('decision')
  })

  it('空输入回退到 general_guidance', () => {
    expect(normalizeAssistantIntent('')).toBe('general_guidance')
  })

  it('无匹配输入回退到 general_guidance', () => {
    expect(normalizeAssistantIntent('你好')).toBe('general_guidance')
  })
})

// =============================================================================
// 确定性路由评分
// =============================================================================

describe('computeAssistantRouteScores', () => {
  it('技术矛盾意图路由到对应分析器', () => {
    const decisions = computeAssistantRouteScores({
      intent: 'technical_contradiction',
      sourceKinds: ['contradiction', 'technical_contradiction_analysis'],
      permissions: buildAuthorizedAssistantPermissions(),
      featureFlags: buildAllEnabledAssistantFeatureFlags(),
    })

    const techDecisions = decisions.filter(
      (d) => d.destination === 'technical_contradiction_analyzer',
    )
    expect(techDecisions.length).toBe(1)
    expect(techDecisions[0].confidence).toBe('high')
  })

  it('功能标志禁用时 evolution_trend 降级', () => {
    const decisions = computeAssistantRouteScores({
      intent: 'general_guidance',
      sourceKinds: ['evolution_trend_run'],
      permissions: buildAuthorizedAssistantPermissions(),
      featureFlags: buildLimitedAssistantFeatureFlags(),
    })

    const trendDecision = decisions.find((d) => d.destination === 'evolution_trend_analysis')
    expect(trendDecision).toBeDefined()
    expect(trendDecision!.confidence).toBe('fallback')
    expect(trendDecision!.warnings).toContain('FEATURE_FLAG_DISABLED')
  })

  it('相同输入产生相同路由排序', () => {
    const input = {
      intent: 'technical_contradiction' as const,
      sourceKinds: ['contradiction'] as const,
      permissions: buildAuthorizedAssistantPermissions(),
      featureFlags: buildAllEnabledAssistantFeatureFlags(),
    }

    const decisions1 = computeAssistantRouteScores(input)
    const decisions2 = computeAssistantRouteScores({ ...input, sourceKinds: ['contradiction'] })

    const ids1 = decisions1.map((d) => d.destination).join(',')
    const ids2 = decisions2.map((d) => d.destination).join(',')
    // 比较排序而非 routeId（routeId 每次都不同）
    expect(decisions1.map((d) => d.confidence)).toEqual(decisions2.map((d) => d.confidence))
    expect(decisions1.map((d) => d.order)).toEqual(decisions2.map((d) => d.order))
  })

  it('物理矛盾意图路由到物理矛盾分析器', () => {
    const decisions = computeAssistantRouteScores({
      intent: 'physical_contradiction',
      sourceKinds: ['contradiction', 'physical_contradiction_analysis'],
      permissions: buildAuthorizedAssistantPermissions(),
      featureFlags: buildAllEnabledAssistantFeatureFlags(),
    })

    const physDecisions = decisions.filter(
      (d) => d.destination === 'physical_contradiction_analyzer',
    )
    expect(physDecisions.length).toBe(1)
    expect(physDecisions[0].confidence).toBe('high')
  })
})

// =============================================================================
// 夹具覆盖
// =============================================================================

describe('夹具构建器', () => {
  it('buildAuthorizedAssistantPermissions 全部为 true', () => {
    const perms = buildAuthorizedAssistantPermissions()
    expect(perms.canViewTriz).toBe(true)
    expect(perms.canManageTriz).toBe(true)
    expect(perms.canTriggerAi).toBe(true)
    expect(Object.values(perms.sourcePermissions).every(Boolean)).toBe(true)
  })

  it('buildPartiallyAuthorizedAssistantPermissions 部分受限', () => {
    const perms = buildPartiallyAuthorizedAssistantPermissions()
    expect(perms.canManageTriz).toBe(false)
    expect(perms.canTriggerAi).toBe(false)
  })

  it('buildEmptyAssistantContextPacket 无来源', () => {
    const packet = buildEmptyAssistantContextPacket()
    expect(packet.sources).toHaveLength(0)
    expect(packet.truncated).toBe(false)
  })

  it('buildLargeAssistantContextPacket 支持大量来源', () => {
    const packet = buildLargeAssistantContextPacket(50)
    expect(packet.sources).toHaveLength(50)
    expect(packet.truncated).toBe(true)
    expect(packet.truncationWarning).toBeDefined()
  })

  it('buildAiFallbackAssistantResponse 标记为 fallback', () => {
    const resp = buildAiFallbackAssistantResponse()
    expect(resp.fallback).toBe(true)
    expect(resp.warnings).toContain('AI_FALLBACK')
  })

  it('buildStaleAssistantSourceSummary 标记为陈旧', () => {
    const source = buildStaleAssistantSourceSummary('contradiction')
    expect(source.freshness.isStale).toBe(true)
    expect(source.warnings).toContain('SOURCE_STALE')
  })
})

// =============================================================================
// 验证函数
// =============================================================================

describe('validateAssistantSubmitRequest', () => {
  it('拒绝空消息', () => {
    const result = validateAssistantSubmitRequest({ message: '' })
    expect(result.valid).toBe(false)
  })

  it('拒绝超长消息', () => {
    const result = validateAssistantSubmitRequest({ message: 'x'.repeat(5001) })
    expect(result.valid).toBe(false)
  })

  it('接受有效消息', () => {
    const result = validateAssistantSubmitRequest({ message: '如何分析技术矛盾？' })
    expect(result.valid).toBe(true)
  })
})

describe('validateAssistantContextPacket', () => {
  it('空数据包产生警告', () => {
    const packet = buildEmptyAssistantContextPacket()
    const result = validateAssistantContextPacket(packet)
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('无可用来源数据')
  })

  it('截断数据包产生警告', () => {
    const packet = buildLargeAssistantContextPacket(50)
    const result = validateAssistantContextPacket(packet)
    expect(result.warnings).toContain('上下文数据已截断')
  })
})

// =============================================================================
// §2.12 — 性能探针（P1）
// =============================================================================

describe('性能探针 — 路由评分', () => {
  const perms = buildAuthorizedAssistantPermissions()

  it('100 个来源类型的路由评分在 20ms 内完成', () => {
    const sourceKinds = Array.from(
      { length: 100 },
      (_, i) => AI_TRIZ_ASSISTANT_SOURCE_KINDS[i % AI_TRIZ_ASSISTANT_SOURCE_KINDS.length],
    )
    const start = performance.now()
    computeAssistantRouteScores({
      intent: 'technical_contradiction',
      sourceKinds,
      permissions: perms,
      featureFlags: buildAllEnabledAssistantFeatureFlags(),
    })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(20)
  })

  it('500 个来源类型的路由评分在 50ms 内完成', () => {
    const sourceKinds = Array.from(
      { length: 500 },
      (_, i) => AI_TRIZ_ASSISTANT_SOURCE_KINDS[i % AI_TRIZ_ASSISTANT_SOURCE_KINDS.length],
    )
    const start = performance.now()
    computeAssistantRouteScores({
      intent: 'general_guidance',
      sourceKinds,
      permissions: perms,
      featureFlags: buildAllEnabledAssistantFeatureFlags(),
    })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
  })
})

describe('性能探针 — 上下文脱敏', () => {
  // 预热后取 5 次中的最快值：单次计时会把首次 JIT 与全仓并行测试时的调度抖动算进预算
  const bestOf = (fn: () => void, runs = 5) => {
    fn()
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < runs; i++) {
      const start = performance.now()
      fn()
      best = Math.min(best, performance.now() - start)
    }
    return best
  }

  it('100 字段对象的 redactSensitiveFields 在 5ms 内完成', () => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < 100; i++) {
      obj[`field_${i}`] = `value_${i}`
    }
    obj['prompt'] = 'sensitive'
    obj['token'] = 'secret123'

    expect(bestOf(() => redactSensitiveFields(obj, Object.keys(obj)))).toBeLessThan(5)
  })

  it('500 字段对象的 rejectSensitivePayload 在 5ms 内完成', () => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < 500; i++) {
      obj[`field_${i}`] = `value_${i}`
    }
    obj['secret'] = 'hidden'

    expect(bestOf(() => rejectSensitivePayload(obj))).toBeLessThan(5)
  })
})
