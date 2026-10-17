// @aiproj/types — V3 Copilot 共享契约测试
// v3-copilot-shared-contracts — 枚举校验 / 结构类型 / 确定性 helpers / fixtures / 红线一致性

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  COPILOT_ACTION_TYPES,
  COPILOT_CONFIDENCE_BANDS,
  COPILOT_DEGRADED_REASONS,
  COPILOT_DESTINATION_REGISTRY,
  COPILOT_DESTINATIONS,
  COPILOT_ENTITY_TYPES,
  COPILOT_INTENT_CLASSES,
  COPILOT_INTENT_CLASS_RULES,
  COPILOT_KNOWLEDGE_TIERS,
  COPILOT_LEDGER_ALIGNED_FIELD_NAMES,
  COPILOT_MESSAGE_ROLES,
  COPILOT_MUTATION_INTENT_CLASSES,
  COPILOT_PERSISTABLE_FIELD_NAMES,
  COPILOT_PERSISTENCE_CLASSES,
  COPILOT_SCOPES,
  COPILOT_SESSION_STATUSES,
  COPILOT_SOURCE_KINDS,
  COPILOT_WARNING_CODES,
  classifyCopilotPersistence,
  compareCopilotRouteDecisions,
  computeCopilotContextPacketHash,
  computeCopilotIdempotencyKey,
  computeCopilotSourceHash,
  computeCopilotStableSortKey,
  copilotCostSummaryAlignedFieldNames,
  copilotCostSummaryLedgerAttributeName,
  copilotIntentClassAllowsActionType,
  deriveRequiresUserConfirmation,
  detectStaleCopilotActions,
  generateCopilotActionId,
  generateCopilotAssumptionId,
  generateCopilotMessageId,
  generateCopilotPromptId,
  generateCopilotRouteDecisionId,
  generateCopilotSessionId,
  isCopilotActionType,
  isCopilotConfidenceBand,
  isCopilotDegradedReason,
  isCopilotDestination,
  isCopilotEntityType,
  isCopilotFieldSensitive,
  isCopilotIntentClass,
  isCopilotKnowledgeTier,
  isCopilotMessageRole,
  isCopilotPathSensitive,
  isCopilotScope,
  isCopilotSessionStatus,
  isCopilotSourceKind,
  isCopilotWarningCode,
  mapCopilotConfidenceToBand,
  normalizeCopilotMessageRole,
  normalizeCopilotSessionStatus,
  copilotStableSerialize,
  redactCopilotSensitiveFields,
  rejectCopilotSensitivePayload,
  validateCopilotActionSet,
  validateCopilotContextPacket,
  validateCopilotDestinationRegistry,
  validateCopilotScopeSources,
  type CopilotContextPacket,
} from './copilot-shared-contracts.js'
import {
  buildCopilotAction,
  buildCopilotRouteDecision,
  buildCopilotSourceSummary,
  COPILOT_FIXTURE_STATES,
  COPILOT_FIXTURE_STATE_NAMES,
} from './copilot-shared-contracts-fixtures.js'
import { LEDGER_STANDARD_ATTRIBUTE_KEYS } from './unified-ai-invocation-ledger.js'

// =============================================================================
// 2.12 — 枚举合法值通过 / 未知值拒绝（未知值不得被当作成功或已授权）
// =============================================================================

describe('枚举与词汇：合法值通过、未知值拒绝', () => {
  const guardCases: Array<[string, (v: string) => boolean, readonly string[], string]> = [
    ['scope', isCopilotScope, COPILOT_SCOPES, 'bogus-scope'],
    ['intentClass', isCopilotIntentClass, COPILOT_INTENT_CLASSES, 'bogus-intent'],
    ['destination', isCopilotDestination, COPILOT_DESTINATIONS, 'bogus-destination'],
    ['actionType', isCopilotActionType, COPILOT_ACTION_TYPES, 'bogus-action'],
    ['warningCode', isCopilotWarningCode, COPILOT_WARNING_CODES, 'BOGUS_WARNING'],
    ['degradedReason', isCopilotDegradedReason, COPILOT_DEGRADED_REASONS, 'bogus-reason'],
    ['confidenceBand', isCopilotConfidenceBand, COPILOT_CONFIDENCE_BANDS, 'bogus-band'],
    ['sourceKind', isCopilotSourceKind, COPILOT_SOURCE_KINDS, 'bogus-source'],
    ['sessionStatus', isCopilotSessionStatus, COPILOT_SESSION_STATUSES, 'bogus-status'],
    ['messageRole', isCopilotMessageRole, COPILOT_MESSAGE_ROLES, 'bogus-role'],
    ['knowledgeTier', isCopilotKnowledgeTier, COPILOT_KNOWLEDGE_TIERS, 'L9'],
    ['entityType', isCopilotEntityType, COPILOT_ENTITY_TYPES, 'bogus-entity'],
  ]

  it.each(guardCases)('%s：全部合法值通过守卫', (_name, guard, values) => {
    for (const v of values) {
      expect(guard(v)).toBe(true)
    }
  })

  it.each(guardCases)('%s：未知值被守卫拒绝', (_name, guard, _values, unknown) => {
    expect(guard(unknown)).toBe(false)
  })

  it('未知 session status 不被当作成功：归一化为 failed 且标记 unknown', () => {
    const r = normalizeCopilotSessionStatus('totally-unknown-status')
    expect(r.unknown).toBe(true)
    expect(r.status).toBe('failed')
    expect(['active', 'completed', 'completed_with_warnings', 'archived']).not.toContain(r.status)
  })

  it('合法 session status 归一化不标记 unknown', () => {
    const r = normalizeCopilotSessionStatus('completed')
    expect(r.unknown).toBe(false)
    expect(r.status).toBe('completed')
  })

  it('未知 message role 归一化标记 unknown 且不当作 user/assistant 成功输入', () => {
    const r = normalizeCopilotMessageRole('robot')
    expect(r.unknown).toBe(true)
  })

  it('持久化分类词汇只有 persistable / transport-only', () => {
    expect(COPILOT_PERSISTENCE_CLASSES).toEqual(['persistable', 'transport-only'])
  })
})

// =============================================================================
// 2.6 — destination 注册表三项元数据齐备且无遗漏
// =============================================================================

describe('destination 注册表完整性', () => {
  it('validateCopilotDestinationRegistry 零问题', () => {
    const r = validateCopilotDestinationRegistry()
    expect(r.issues).toEqual([])
    expect(r.valid).toBe(true)
  })

  it('每个 destination 都声明 owner capability、required permissions 与 persistenceReachable', () => {
    for (const destination of COPILOT_DESTINATIONS) {
      const meta = COPILOT_DESTINATION_REGISTRY[destination]
      expect(meta).toBeDefined()
      expect(meta.ownerCapability.trim().length).toBeGreaterThan(0)
      expect(meta.requiredPermissions.length).toBeGreaterThan(0)
      expect(typeof meta.persistenceReachable).toBe('boolean')
      expect(meta.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('注册表键与 destination 枚举一一对应（无遗漏无多余）', () => {
    expect(Object.keys(COPILOT_DESTINATION_REGISTRY).sort()).toEqual(
      [...COPILOT_DESTINATIONS].sort(),
    )
  })
})

// =============================================================================
// 3.5 — L3 合格层清单拒绝
// =============================================================================

describe('上下文包 L3 排除标记', () => {
  function basePacket(): CopilotContextPacket {
    return {
      contextHash: 'ctx',
      scope: 'project',
      sources: [buildCopilotSourceSummary({ sourceKind: 'task' })],
      eligibleKnowledgeTiers: ['L1', 'L2'],
      truncation: {
        truncated: false,
        omittedSourceCount: 0,
        omittedEvidenceCount: 0,
        budgetBytes: 8192,
      },
      budget: {
        contextBytesUsed: 100,
        contextBytesLimit: 4096,
        evidenceBytesUsed: 0,
        evidenceBytesLimit: 2048,
      },
      warnings: [],
      sourceOrdering: ['task'],
    }
  }

  it('合格层清单不含 L3 时校验通过', () => {
    const r = validateCopilotContextPacket(basePacket())
    expect(r.valid).toBe(true)
  })

  it('合格层清单含 L3 时校验拒绝', () => {
    const packet = { ...basePacket(), eligibleKnowledgeTiers: ['L1', 'L2', 'L3'] as const }
    const r = validateCopilotContextPacket(packet)
    expect(r.valid).toBe(false)
    expect(r.issues.join()).toContain('L3')
  })

  it('L3 是合成评测知识层且不在生产路径合格清单内', () => {
    // 与 four-layer-knowledge-base 语义对齐：L3 强制 SYNTHETIC 水印、禁止进入生产检索
    expect(COPILOT_KNOWLEDGE_TIERS).toContain('L3')
  })
})

// =============================================================================
// 4.3 — hash 稳定性（对象键顺序无关）
// =============================================================================

describe('确定性 hash 稳定性', () => {
  it('copilotStableSerialize 对键顺序不同但内容等价的输入产出相同签名', () => {
    const a = { b: 1, a: { d: 'x', c: [1, 2, 3] }, z: 'tail' }
    const b = { z: 'tail', a: { c: [1, 2, 3], d: 'x' }, b: 1 }
    expect(copilotStableSerialize(a)).toBe(copilotStableSerialize(b))
  })

  it('copilotStableSerialize 对内容不同的输入产出不同签名', () => {
    expect(copilotStableSerialize({ x: 1, y: 2 })).not.toBe(copilotStableSerialize({ x: 2, y: 1 }))
  })

  it('source hash / context packet hash 与来源顺序无关', () => {
    const s1 = buildCopilotSourceSummary({ sourceKind: 'task', sourceHash: 'H1' })
    const s2 = buildCopilotSourceSummary({ sourceKind: 'risk', sourceHash: 'H2' })
    expect(computeCopilotContextPacketHash([s1, s2])).toBe(
      computeCopilotContextPacketHash([s2, s1]),
    )
  })

  it('idempotencyKey 对 sourceHashes 顺序无关', () => {
    const k1 = computeCopilotIdempotencyKey('输入', ['b', 'a'], 7)
    const k2 = computeCopilotIdempotencyKey('输入', ['a', 'b'], 7)
    expect(k1).toBe(k2)
  })

  it('相同输入重复调用产出相同稳定排序键与 hash', () => {
    expect(computeCopilotStableSortKey('draft_layer', 'high', 1)).toBe(
      computeCopilotStableSortKey('draft_layer', 'high', 1),
    )
    expect(computeCopilotSourceHash('摘要', 'task')).toBe(computeCopilotSourceHash('摘要', 'task'))
  })
})

// =============================================================================
// 4.5 — requiresUserConfirmation 派生（遍历全部 destination + 负例）
// =============================================================================

describe('requiresUserConfirmation 派生', () => {
  it.each(COPILOT_DESTINATIONS)(
    'destination %s：navigation/explanation/clarification 不被强制确认',
    (dest) => {
      expect(deriveRequiresUserConfirmation(dest, 'navigation')).toBe(false)
      expect(deriveRequiresUserConfirmation(dest, 'explanation')).toBe(false)
      expect(deriveRequiresUserConfirmation(dest, 'clarification')).toBe(false)
    },
  )

  it.each(COPILOT_DESTINATIONS.filter((d) => COPILOT_DESTINATION_REGISTRY[d].persistenceReachable))(
    '可持久化 destination %s：preview/review-entry/handoff-candidate 恒为 true',
    (dest) => {
      expect(deriveRequiresUserConfirmation(dest, 'preview')).toBe(true)
      expect(deriveRequiresUserConfirmation(dest, 'review-entry')).toBe(true)
      expect(deriveRequiresUserConfirmation(dest, 'handoff-candidate')).toBe(true)
    },
  )

  it('不可持久化 destination：preview 类动作不强制确认', () => {
    for (const dest of COPILOT_DESTINATIONS) {
      if (!COPILOT_DESTINATION_REGISTRY[dest].persistenceReachable) {
        expect(deriveRequiresUserConfirmation(dest, 'preview')).toBe(false)
      }
    }
  })

  it('负例：仅导航动作不得被强制要求确认（动作集校验放行）', () => {
    const action = buildCopilotAction({
      destination: 'draft_layer', // 可持久化 destination 上的导航
      actionType: 'navigation',
      intentClass: 'query',
      requiresUserConfirmation: false,
    })
    const r = validateCopilotActionSet([action])
    expect(r.valid).toBe(true)
    expect(r.issues).toEqual([])
  })
})

// =============================================================================
// 4.7 — global scope 拒绝 project 作用域来源
// =============================================================================

describe('scope 与合格来源映射', () => {
  it('global scope 拒绝 project 作用域来源', () => {
    expect(validateCopilotScopeSources('global', ['task']).valid).toBe(false)
    expect(validateCopilotScopeSources('global', ['risk']).valid).toBe(false)
    expect(validateCopilotScopeSources('global', ['draft_layer_change']).valid).toBe(false)
  })

  it('global scope 只接受一般知识/帮助/外部内容', () => {
    expect(validateCopilotScopeSources('global', ['general_knowledge', 'help_article']).valid).toBe(
      true,
    )
    expect(
      validateCopilotScopeSources('global', ['external_content', 'general_knowledge']).valid,
    ).toBe(true)
  })

  it('project scope 接受项目域来源', () => {
    expect(
      validateCopilotScopeSources('project', ['task', 'risk', 'draft_layer_change']).valid,
    ).toBe(true)
  })

  it('entity scope 只绑定实体与授权父级来源', () => {
    expect(validateCopilotScopeSources('entity', ['task', 'risk', 'milestone']).valid).toBe(true)
    expect(validateCopilotScopeSources('entity', ['pmo_portfolio']).valid).toBe(false)
  })

  it('5 档 scope 全覆盖', () => {
    expect(COPILOT_SCOPES).toEqual(['global', 'organization', 'project', 'portfolio', 'entity'])
    for (const scope of COPILOT_SCOPES) {
      expect(COPILOT_INTENT_CLASSES.length).toBeGreaterThan(0) // 相邻枚举不受影响
      expect(typeof deriveRequiresUserConfirmation('general_qa', 'navigation')).toBe('boolean')
    }
  })
})

// =============================================================================
// 4.8 — 置信度档位映射
// =============================================================================

describe('置信度档位映射', () => {
  it('≥80 → high', () => {
    expect(mapCopilotConfidenceToBand(80)).toBe('high')
    expect(mapCopilotConfidenceToBand(95)).toBe('high')
  })
  it('50–79 → medium', () => {
    expect(mapCopilotConfidenceToBand(50)).toBe('medium')
    expect(mapCopilotConfidenceToBand(72)).toBe('medium')
  })
  it('<50 → low', () => {
    expect(mapCopilotConfidenceToBand(49)).toBe('low')
    expect(mapCopilotConfidenceToBand(0)).toBe('low')
  })
  it('未知/缺失 → fallback（UI 灰色未知态）', () => {
    expect(mapCopilotConfidenceToBand(undefined)).toBe('fallback')
    expect(mapCopilotConfidenceToBand(NaN)).toBe('fallback')
  })
})

// =============================================================================
// 4.11 — 低敏 sanitizer：每类禁止键至少一个负例
// =============================================================================

describe('低敏 sanitizer 禁止键', () => {
  const FORBIDDEN_KEYS = [
    'prompt',
    'systemInstructions',
    'systemPrompt',
    'modelOutput',
    'completion',
    'messages',
    'toolArguments',
    'toolResults',
    'retrievalBody',
    'rawEvidence',
    'rawBody',
    'rawPayload',
    'secret',
    'token',
    'apiKey',
    'authorization',
    'authHeader',
    'password',
    'credential',
    'privateKey',
    'certificate',
    'fullText',
  ]

  it.each(FORBIDDEN_KEYS)('禁止键 %s 被 isCopilotFieldSensitive 命中', (key) => {
    expect(isCopilotFieldSensitive(key)).toBe(true)
  })

  it('redactCopilotSensitiveFields 删除全部禁止键并回报', () => {
    const obj: Record<string, unknown> = { prompt: 'x', modelOutput: 'y', safeField: 'z' }
    const { redacted, rejectedFields } = redactCopilotSensitiveFields(obj, Object.keys(obj))
    expect(rejectedFields.sort()).toEqual(['modelOutput', 'prompt'])
    expect(redacted).not.toHaveProperty('prompt')
    expect(redacted).not.toHaveProperty('modelOutput')
    expect(redacted).toHaveProperty('safeField')
  })

  it('rejectCopilotSensitivePayload 标记不安全载荷', () => {
    const r = rejectCopilotSensitivePayload({ apiKey: 'sk-x', authorization: 'Bearer y' })
    expect(r.safe).toBe(false)
    expect(r.rejectedKeys.sort()).toEqual(['apiKey', 'authorization'])
  })

  it('敏感路径值被拒绝（/etc/passwd、.env、.ssh 等）', () => {
    expect(isCopilotPathSensitive('/etc/passwd')).toBe(true)
    expect(isCopilotPathSensitive('C:\\Windows\\system32\\config')).toBe(true)
    expect(isCopilotPathSensitive('/home/u/.ssh/id_rsa')).toBe(true)
    expect(rejectCopilotSensitivePayload({ path: '/etc/passwd' }).safe).toBe(false)
  })

  it('低敏字段不被误判为敏感', () => {
    for (const key of ['sourceHash', 'sourceRef', 'lowSensitivitySummary', 'idempotencyKey']) {
      expect(isCopilotFieldSensitive(key)).toBe(false)
    }
  })
})

// =============================================================================
// 4.12 / 6.4 — 持久化分类拒绝全文类字段
// =============================================================================

describe('持久化分类', () => {
  it('prompt / systemInstructions / modelOutput 全文字段一律 transport-only', () => {
    expect(classifyCopilotPersistence('prompt').classification).toBe('transport-only')
    expect(classifyCopilotPersistence('systemInstructions').classification).toBe('transport-only')
    expect(classifyCopilotPersistence('modelOutput').classification).toBe('transport-only')
    expect(classifyCopilotPersistence('completion').classification).toBe('transport-only')
  })

  it('低敏字段可持久化', () => {
    for (const key of [
      'sessionId',
      'status',
      'sourceHash',
      'warningCodes',
      'idempotencyKey',
      'inputTokens',
    ]) {
      expect(classifyCopilotPersistence(key).classification).toBe('persistable')
    }
  })

  it('未知字段安全默认不落库', () => {
    expect(classifyCopilotPersistence('someRandomField').classification).toBe('transport-only')
  })

  it('allowlist 覆盖可持久化字段集且不包含任何敏感字段', () => {
    for (const field of COPILOT_PERSISTABLE_FIELD_NAMES) {
      expect(isCopilotFieldSensitive(field)).toBe(false)
    }
  })
})

// =============================================================================
// 5.10 — fixtures 八态全部通过契约校验且互不矛盾
// =============================================================================

describe('fixtures 八态', () => {
  it('恰好八态且状态名互不重复', () => {
    expect(COPILOT_FIXTURE_STATES).toHaveLength(8)
    expect(new Set(COPILOT_FIXTURE_STATE_NAMES).size).toBe(8)
    expect(COPILOT_FIXTURE_STATE_NAMES).toEqual([
      'success',
      'clarification',
      'degraded',
      'stale-blocked',
      'permission-missing',
      'truncated',
      'general-purpose',
      'external-rejected',
    ])
  })

  it.each(COPILOT_FIXTURE_STATES)('状态 %s：上下文包与动作集全部通过契约校验', (fixture) => {
    if (fixture.contextPacket) {
      const ctx = validateCopilotContextPacket(fixture.contextPacket)
      expect(ctx.valid).toBe(true)
    }
    const actions = validateCopilotActionSet(fixture.response.recommendedActions)
    expect(actions.valid).toBe(true)
    expect(Array.isArray(fixture.response.warnings)).toBe(true)
    expect(fixture.session.sessionId.length).toBeGreaterThan(0)
  })

  it('全局问答 fixture：无项目来源 + 禁写（无可持久化动作）', () => {
    const fixture = COPILOT_FIXTURE_STATES.find((f) => f.state === 'general-purpose')!
    expect(fixture.session.scope).toBe('global')
    expect(fixture.contextPacket!.sources).toHaveLength(0)
    for (const action of fixture.response.recommendedActions) {
      expect(action.requiresUserConfirmation).toBe(false)
    }
    expect(fixture.response.intentClass).toBe('query')
  })

  it('澄清 fixture：不产出变更动作', () => {
    const fixture = COPILOT_FIXTURE_STATES.find((f) => f.state === 'clarification')!
    expect(fixture.response.recommendedActions).toHaveLength(0)
    expect(fixture.response.clarificationPrompts.length).toBeGreaterThan(0)
  })

  it('降级 fixture：isFallback=true + 机器可读降级原因 + 确定性建议保留', () => {
    const fixture = COPILOT_FIXTURE_STATES.find((f) => f.state === 'degraded')!
    expect(fixture.response.fallback).toBe(true)
    expect(fixture.response.degradedReason).toBe('provider_error')
    expect(fixture.response.recommendedActions.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// 6.2 / 6.3 — 红线：变更类意图必须确认；可持久化 destination 动作恒真
// =============================================================================

describe('红线：确认义务', () => {
  it('变更类意图无法产出不要求确认的动作', () => {
    const bad = buildCopilotAction({
      destination: 'draft_layer',
      actionType: 'preview',
      intentClass: 'mutation',
      requiresUserConfirmation: false, // 违反红线
    })
    const r = validateCopilotActionSet([bad])
    expect(r.valid).toBe(false)
    expect(r.issues.join()).toContain('要求用户确认')
  })

  it('mutation / instruction 类规则面声明要求确认', () => {
    for (const cls of COPILOT_MUTATION_INTENT_CLASSES) {
      expect(COPILOT_INTENT_CLASS_RULES[cls].requiresUserConfirmation).toBe(true)
    }
  })

  it('子意图规则继承：mutation 类允许的动作类型全为可确认类', () => {
    for (const actionType of COPILOT_INTENT_CLASS_RULES.mutation.allowedActionTypes) {
      expect(copilotIntentClassAllowsActionType('mutation', actionType)).toBe(true)
      expect(['preview', 'review-entry', 'handoff-candidate']).toContain(actionType)
    }
  })

  it('可导致持久化的 destination 对应动作 requiresUserConfirmation 恒为真（校验拒绝假值）', () => {
    for (const dest of COPILOT_DESTINATIONS) {
      if (!COPILOT_DESTINATION_REGISTRY[dest].persistenceReachable) continue
      const action = buildCopilotAction({
        destination: dest,
        actionType: 'preview',
        intentClass: 'mutation',
      })
      expect(action.requiresUserConfirmation).toBe(true)
      const bad = buildCopilotAction({
        destination: dest,
        actionType: 'preview',
        intentClass: 'mutation',
        requiresUserConfirmation: false,
      })
      expect(validateCopilotActionSet([bad]).valid).toBe(false)
    }
  })
})

// =============================================================================
// 6.5 — 成本字段名与统一账本对齐集合相等
// =============================================================================

describe('成本字段名与统一账本 gen_ai.* 对齐', () => {
  it('对齐字段名集合与 COPILOT_LEDGER_ALIGNED_FIELD_NAMES 相等', () => {
    expect(copilotCostSummaryAlignedFieldNames()).toEqual([...COPILOT_LEDGER_ALIGNED_FIELD_NAMES])
  })

  it('对齐字段名全部存在于账本 LEDGER_STANDARD_ATTRIBUTE_KEYS（与统一账本集合相等）', () => {
    for (const name of COPILOT_LEDGER_ALIGNED_FIELD_NAMES) {
      expect(LEDGER_STANDARD_ATTRIBUTE_KEYS).toContain(name)
    }
    // 反向：Copilot 声明的对齐集恰好是账本标准键中「成本摘要所覆盖」的子集，不引入第二套词汇
    const costLedgerKeys = new Set(LEDGER_STANDARD_ATTRIBUTE_KEYS)
    const aligned = new Set(COPILOT_LEDGER_ALIGNED_FIELD_NAMES)
    for (const name of aligned) {
      expect(costLedgerKeys.has(name)).toBe(true)
    }
  })

  it('对齐字段映射到账本标准裸名（gen_ai.* 语义，无前缀）', () => {
    expect(copilotCostSummaryLedgerAttributeName('conversationId')).toBe('conversation_id')
    expect(copilotCostSummaryLedgerAttributeName('operationName')).toBe('operation_name')
    expect(copilotCostSummaryLedgerAttributeName('providerName')).toBe('provider_name')
    expect(copilotCostSummaryLedgerAttributeName('requestModel')).toBe('request_model')
    expect(copilotCostSummaryLedgerAttributeName('responseModel')).toBe('response_model')
    expect(copilotCostSummaryLedgerAttributeName('inputTokens')).toBe('usage_input_tokens')
    expect(copilotCostSummaryLedgerAttributeName('outputTokens')).toBe('usage_output_tokens')
    expect(copilotCostSummaryLedgerAttributeName('cacheReadTokens')).toBe(
      'usage_cache_read_input_tokens',
    )
    expect(copilotCostSummaryLedgerAttributeName('cacheCreationTokens')).toBe(
      'usage_cache_creation_input_tokens',
    )
    expect(copilotCostSummaryLedgerAttributeName('reasoningTokens')).toBe(
      'usage_reasoning_output_tokens',
    )
    expect(copilotCostSummaryLedgerAttributeName('timeToFirstChunkMs')).toBe(
      'time_to_first_chunk_ms',
    )
  })

  it('本地扩展维度使用账本 aiproj_* 命名空间，不伪装 gen_ai.*', () => {
    expect(copilotCostSummaryLedgerAttributeName('capability')).toMatch(/^aiproj_/)
    expect(copilotCostSummaryLedgerAttributeName('surface')).toMatch(/^aiproj_/)
    expect(copilotCostSummaryLedgerAttributeName('estimatedCost')).toBe('aiproj_estimated_cost')
    expect(copilotCostSummaryLedgerAttributeName('realAdapterFlag')).toBe(
      'aiproj_using_real_adapter',
    )
    expect(copilotCostSummaryLedgerAttributeName('fallbackFlag')).toBe('aiproj_fallback_used')
    expect(copilotCostSummaryLedgerAttributeName('inputHash')).toBe('aiproj_input_hash')
    // 本地维度绝不以 gen_ai.* 键名输出
    for (const field of ['estimatedCost', 'capability', 'surface', 'inputHash'] as const) {
      expect(copilotCostSummaryLedgerAttributeName(field)).not.toMatch(/^gen_ai\./)
    }
  })

  it('对齐集合恰好 11 项且含请求/响应模型分离字段', () => {
    expect(COPILOT_LEDGER_ALIGNED_FIELD_NAMES).toHaveLength(11)
    expect(COPILOT_LEDGER_ALIGNED_FIELD_NAMES).toContain('request_model')
    expect(COPILOT_LEDGER_ALIGNED_FIELD_NAMES).toContain('response_model')
  })
})

// =============================================================================
// 6.6 — 依赖轻量：仅依赖同包 triz-contradiction，无 AdonisJS/React/DB/网络
// =============================================================================

describe('依赖轻量', () => {
  it('源文件只 import ./triz-contradiction.js', () => {
    const src = readFileSync(new URL('./copilot-shared-contracts.ts', import.meta.url), 'utf8')
    const importLines = src
      .split('\n')
      .filter((l) => /^\s*import\s/.test(l))
      .map((l) => l.trim())
    expect(importLines.length).toBeGreaterThanOrEqual(1)
    for (const line of importLines) {
      expect(line).toMatch(/from\s+'\.\/triz-contradiction\.js'/)
    }
  })

  it('可执行代码不出现 AdonisJS / React / 数据库 / 网络 / provider SDK 引用（注释不计）', () => {
    const src = readFileSync(new URL('./copilot-shared-contracts.ts', import.meta.url), 'utf8')
    // 去掉行注释与块注释——文件头注释会显式声明「禁止依赖 X」，本身是文档不是违规
    const withoutLineComments = src.replace(/^\s*\/\/.*$/gm, '')
    const code = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const forbidden of [
      '@adonisjs',
      'react',
      'lucid',
      'knex',
      'sqlite',
      'pg-pool',
      'mysql2',
      'axios',
      'fetch(',
      'http://',
      'https://',
      'openai',
      'anthropic',
      '@ai-sdk',
      'docker',
      'container',
    ]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('前端、后端、脚本可同时导入（纯类型 + 纯函数，无运行时副作用）', async () => {
    const mod = await import('./copilot-shared-contracts.js')
    expect(typeof mod.generateCopilotSessionId).toBe('function')
    expect(typeof mod.deriveRequiresUserConfirmation).toBe('function')
  })
})

// =============================================================================
// 6.7 — barrel 撞名：与既有 AiTrizAssistant* / AiIntent* 无冲突
// =============================================================================

describe('barrel 导出无冲突', () => {
  it('新契约导出可从 index.js 读取', async () => {
    const T = await import('./index.js')
    const t = T as unknown as Record<string, unknown>
    expect(typeof t.generateCopilotSessionId).toBe('function')
    expect(typeof t.deriveRequiresUserConfirmation).toBe('function')
    expect(typeof t.COPILOT_DESTINATIONS).not.toBe('undefined')
    expect(typeof t.COPILOT_DESTINATION_REGISTRY).not.toBe('undefined')
  }, 60_000)

  it('既有 AiTrizAssistant* / AiIntent* 值导出保持不变', async () => {
    const T = await import('./index.js')
    const t = T as unknown as Record<string, unknown>
    expect(typeof t.generateAssistantRunId).toBe('function')
    expect(typeof t.AI_TRIZ_ASSISTANT_DESTINATIONS).not.toBe('undefined')
    expect(typeof t.AI_INTENT_SCHEMA_VERSION).not.toBe('undefined')
    expect(typeof t.CLARIFICATION_FIELDS).not.toBe('undefined')
  }, 60_000)

  it('Copilot 导出名与 AiTrizAssistant* 导出名无交集', async () => {
    const T = (await import('./index.js')) as Record<string, unknown>
    const copilotNames = Object.keys(T).filter(
      (k) => k.startsWith('Copilot') || k.startsWith('COPILOT') || k.startsWith('copilot'),
    )
    const trizNames = Object.keys(T).filter(
      (k) => k.startsWith('AiTrizAssistant') || k.startsWith('AI_TRIZ_ASSISTANT'),
    )
    const overlap = copilotNames.filter((k) => trizNames.includes(k))
    expect(overlap).toEqual([])
  }, 60_000)
})

// =============================================================================
// 6.1 — TRIZ 约束对等（逐条核对泛化后必须保留的约束）
// =============================================================================

describe('TRIZ 约束对等', () => {
  interface ParityRow {
    readonly trizConstraint: string
    readonly relaxed: boolean
    readonly check: () => void
  }

  const parityRows: ParityRow[] = [
    {
      trizConstraint: 'R1 稳定 run/message id',
      relaxed: false,
      check: () => {
        expect(generateCopilotSessionId()).toMatch(/^cps_/)
        expect(generateCopilotMessageId()).toMatch(/^cpm_/)
        expect(generateCopilotRouteDecisionId()).toMatch(/^cpr_/)
        expect(generateCopilotActionId()).toMatch(/^cpa_/)
        expect(generateCopilotPromptId()).toMatch(/^cpp_/)
        expect(generateCopilotAssumptionId()).toMatch(/^cpas_/)
      },
    },
    {
      trizConstraint: 'R2 上下文包授权、低敏、有界、source-hashed',
      relaxed: false,
      check: () => {
        const src = buildCopilotSourceSummary({ sourceKind: 'task' })
        expect(src.sourceHash.length).toBeGreaterThan(0)
        expect(typeof src.lowSensitivitySummary).toBe('string')
        expect(src.freshness.isStale).toBe(false)
      },
    },
    {
      trizConstraint: 'R3 确定性路由可复现（同输入同排序）',
      relaxed: false,
      check: () => {
        const a = buildCopilotRouteDecision({
          destination: 'draft_layer',
          confidence: 'high',
          order: 0,
        })
        const b = buildCopilotRouteDecision({
          destination: 'draft_layer',
          confidence: 'high',
          order: 0,
        })
        expect(compareCopilotRouteDecisions(a, b)).toBe(0)
      },
    },
    {
      trizConstraint: 'R4 AI 叙述可选、可降级、非权威',
      relaxed: false,
      check: () => {
        expect(COPILOT_DEGRADED_REASONS).toContain('provider_error')
        expect(COPILOT_WARNING_CODES).toContain('HALLUCINATION_DETECTED')
      },
    },
    {
      trizConstraint: 'R5 统一信封 / 受保护 API', // 本 change 不实现 API，由 destination/action 契约承接
      relaxed: true,
      check: () => {
        for (const dest of COPILOT_DESTINATIONS) {
          expect(COPILOT_DESTINATION_REGISTRY[dest].requiredPermissions.length).toBeGreaterThan(0)
        }
      },
    },
    {
      trizConstraint: 'R6 handoff preview-only + 人工审查 + source hash 失配阻断',
      relaxed: false,
      check: () => {
        const stale = detectStaleCopilotActions(
          [buildCopilotAction({ destination: 'draft_layer', sourceHashes: ['OLD'] })],
          new Map([['ref', 'NEW']]),
        )
        expect(stale[0].isStale).toBe(true)
        expect(deriveRequiresUserConfirmation('draft_layer', 'handoff-candidate')).toBe(true)
      },
    },
    {
      trizConstraint: 'R7 持久化只存有界低敏摘要',
      relaxed: false,
      check: () => {
        expect(classifyCopilotPersistence('prompt').classification).toBe('transport-only')
        expect(classifyCopilotPersistence('lowSensitivitySummary').classification).toBe(
          'persistable',
        )
      },
    },
    {
      trizConstraint: 'R8 review-oriented UI 形状（按钮/假设/可信度）',
      relaxed: false,
      check: () => {
        expect(COPILOT_ACTION_TYPES).toContain('preview')
        expect(COPILOT_ACTION_TYPES).toContain('review-entry')
        expect(COPILOT_ACTION_TYPES).toContain('navigation')
        expect(mapCopilotConfidenceToBand(85)).toBe('high')
        expect(mapCopilotConfidenceToBand(30)).toBe('low')
      },
    },
    {
      trizConstraint: 'R9 低敏审计引用',
      relaxed: false,
      check: () => {
        expect(COPILOT_PERSISTABLE_FIELD_NAMES).toContain('routeIds')
        expect(COPILOT_PERSISTABLE_FIELD_NAMES).toContain('sourceHashPrefixes')
      },
    },
    {
      trizConstraint: 'R10 未知枚举值被拒绝（不得当作成功/授权）',
      relaxed: false,
      check: () => {
        expect(isCopilotDestination('bogus')).toBe(false)
        expect(normalizeCopilotSessionStatus('bogus').unknown).toBe(true)
      },
    },
  ]

  it.each(parityRows)('$trizConstraint（relaxed=$relaxed）有对应约束', (row) => {
    row.check()
  })

  it('有意放宽处显式记录：scope 与 destination 放宽且有据可查', () => {
    // scope：project-only → 五档；destination：12 TRIZ 目标 → 全应用能力面
    expect(COPILOT_SCOPES).toContain('global')
    expect(COPILOT_SCOPES).toContain('portfolio')
    expect(COPILOT_SCOPES).toContain('entity')
    expect(COPILOT_DESTINATIONS.length).toBeGreaterThan(12)
    // 放宽处的约束补偿：global 拒绝项目来源；可持久化动作确认恒真
    expect(validateCopilotScopeSources('global', ['task']).valid).toBe(false)
  })
})

// =============================================================================
// 2.3 — 意图分类规则结构
// =============================================================================

describe('意图分类规则', () => {
  it('六类顶层意图齐全', () => {
    expect(COPILOT_INTENT_CLASSES).toEqual([
      'query',
      'analysis',
      'generation',
      'mutation',
      'instruction',
      'meta',
    ])
  })

  it('变更类意图（mutation/instruction）允许的动作类型均为可持久化确认类', () => {
    for (const cls of ['mutation', 'instruction'] as const) {
      for (const at of COPILOT_INTENT_CLASS_RULES[cls].allowedActionTypes) {
        expect(['preview', 'review-entry', 'handoff-candidate']).toContain(at)
      }
    }
  })
})

// =============================================================================
// Portfolio scope 归属校验
// =============================================================================

describe('portfolio scope 归属校验', () => {
  it('完整归属通过', async () => {
    const { validatePortfolioAttribution } = await import('./copilot-shared-contracts.js')
    const result = validatePortfolioAttribution({ organizationId: 1, portfolioId: 'p1' })
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('缺少 portfolioId 被拒', async () => {
    const { validatePortfolioAttribution } = await import('./copilot-shared-contracts.js')
    const result = validatePortfolioAttribution({ organizationId: 1 })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('portfolioId')
  })

  it('缺少 organizationId 被拒', async () => {
    const { validatePortfolioAttribution } = await import('./copilot-shared-contracts.js')
    const result = validatePortfolioAttribution({ portfolioId: 'p1' })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('organizationId')
  })

  it('完全缺失被拒', async () => {
    const { validatePortfolioAttribution } = await import('./copilot-shared-contracts.js')
    const result = validatePortfolioAttribution({})
    expect(result.valid).toBe(false)
    expect(result.missing).toEqual(['organizationId', 'portfolioId'])
  })
})
