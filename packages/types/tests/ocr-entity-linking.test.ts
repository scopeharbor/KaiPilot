/**
 * V3 OCR Entity Linking — Shared Contract Tests
 *
 * 测试共享类型的枚举、类型守卫、哈希纯函数、幂等键、脱敏和 fixture。
 */

import { describe, it, expect } from 'vitest'
import {
  // 枚举
  OCR_ENTITY_MENTION_TYPES,
  OCR_ENTITY_LINK_RUN_STATUSES,
  OCR_ENTITY_LINK_CANDIDATE_STATUSES,
  OCR_ENTITY_LINK_LIFECYCLE_STATUSES,
  OCR_TARGET_KINDS,
  OCR_MATCH_REASONS,
  OCR_ENTITY_LINK_WARNING_CODES,
  OCR_ENTITY_LINK_PERMISSION_ACTIONS,
  OCR_ENTITY_LINK_AUDIT_ACTIONS,
  // 类型守卫
  isOcrEntityMentionType,
  isOcrEntityLinkRunStatus,
  isOcrEntityLinkCandidateStatus,
  isOcrEntityLinkLifecycleStatus,
  isOcrTargetKind,
  isOcrMatchReason,
  isOcrEntityLinkWarningCode,
  isOcrEntityLinkPermissionAction,
  isOcrEntityLinkAuditAction,
  // 纯函数
  computeEntityLinkRunInputSignature,
  computeCandidateKey,
  computePreviewHash,
  computeConfirmationHash,
  redactTargetTitle,
  aggregateWarnings,
  redactSummary,
  DEFAULT_REDLINE_SUMMARY,
} from '../src/ocr-entity-linking.js'

import {
  buildSpanOffset,
  buildSourceExtractionRef,
  buildTargetSuggestion,
  buildTargetSummary,
  buildWarning,
  buildStaleSummary,
  buildCandidate,
  buildUnmatchedCandidate,
  buildRunSummary,
  buildAdvisoryPayload,
  buildPreview,
  buildConfirmedLink,
  fixtureAcceptedTextSmall,
  fixtureAcceptedTextLarge,
  fixtureCandidateSet,
} from '../src/ocr-entity-linking-fixtures.js'

// ─── 枚举 ──────────────────────────────────────────────────────────────────

describe('OCR Entity Linking — enums', () => {
  it('OCR_ENTITY_MENTION_TYPES 包含 12 个类型', () => {
    expect(OCR_ENTITY_MENTION_TYPES).toHaveLength(12)
  })

  it('OCR_ENTITY_LINK_RUN_STATUSES 包含 4 个状态', () => {
    expect(OCR_ENTITY_LINK_RUN_STATUSES).toHaveLength(4)
    expect(OCR_ENTITY_LINK_RUN_STATUSES).toContain('running')
    expect(OCR_ENTITY_LINK_RUN_STATUSES).toContain('completed')
    expect(OCR_ENTITY_LINK_RUN_STATUSES).toContain('stale')
    expect(OCR_ENTITY_LINK_RUN_STATUSES).toContain('failed')
  })

  it('OCR_ENTITY_LINK_CANDIDATE_STATUSES 包含 5 个状态', () => {
    expect(OCR_ENTITY_LINK_CANDIDATE_STATUSES).toHaveLength(5)
  })

  it('OCR_ENTITY_LINK_LIFECYCLE_STATUSES 包含 3 个状态', () => {
    expect(OCR_ENTITY_LINK_LIFECYCLE_STATUSES).toHaveLength(3)
    expect(OCR_ENTITY_LINK_LIFECYCLE_STATUSES).toContain('active')
    expect(OCR_ENTITY_LINK_LIFECYCLE_STATUSES).toContain('superseded')
    expect(OCR_ENTITY_LINK_LIFECYCLE_STATUSES).toContain('rejected')
  })

  it('OCR_TARGET_KINDS 包含 8 个种类', () => {
    expect(OCR_TARGET_KINDS).toHaveLength(8)
  })

  it('OCR_MATCH_REASONS 包含 5 个原因', () => {
    expect(OCR_MATCH_REASONS).toHaveLength(5)
  })

  it('OCR_ENTITY_LINK_WARNING_CODES 包含 21 个代码', () => {
    expect(OCR_ENTITY_LINK_WARNING_CODES).toHaveLength(21)
  })

  it('OCR_ENTITY_LINK_PERMISSION_ACTIONS 包含 4 个动作', () => {
    expect(OCR_ENTITY_LINK_PERMISSION_ACTIONS).toHaveLength(4)
  })

  it('OCR_ENTITY_LINK_AUDIT_ACTIONS 包含 12 个动作', () => {
    expect(OCR_ENTITY_LINK_AUDIT_ACTIONS).toHaveLength(12)
  })
})

// ─── 类型守卫 ──────────────────────────────────────────────────────────────

describe('OCR Entity Linking — type guards', () => {
  it('isOcrEntityMentionType 正确识别有效类型', () => {
    expect(isOcrEntityMentionType('task_ref')).toBe(true)
    expect(isOcrEntityMentionType('person_name')).toBe(true)
    expect(isOcrEntityMentionType('invalid_type')).toBe(false)
    expect(isOcrEntityMentionType(null)).toBe(false)
    expect(isOcrEntityMentionType(undefined)).toBe(false)
    expect(isOcrEntityMentionType(123)).toBe(false)
  })

  it('isOcrEntityLinkRunStatus 正确识别有效状态', () => {
    expect(isOcrEntityLinkRunStatus('completed')).toBe(true)
    expect(isOcrEntityLinkRunStatus('running')).toBe(true)
    expect(isOcrEntityLinkRunStatus('invalid')).toBe(false)
  })

  it('isOcrEntityLinkCandidateStatus 正确识别有效状态', () => {
    expect(isOcrEntityLinkCandidateStatus('matched')).toBe(true)
    expect(isOcrEntityLinkCandidateStatus('pending')).toBe(true)
    expect(isOcrEntityLinkCandidateStatus('invalid')).toBe(false)
  })

  it('isOcrEntityLinkLifecycleStatus 正确识别有效状态', () => {
    expect(isOcrEntityLinkLifecycleStatus('active')).toBe(true)
    expect(isOcrEntityLinkLifecycleStatus('rejected')).toBe(true)
    expect(isOcrEntityLinkLifecycleStatus('unknown')).toBe(false)
  })

  it('isOcrTargetKind 正确识别有效种类', () => {
    expect(isOcrTargetKind('task')).toBe(true)
    expect(isOcrTargetKind('project')).toBe(true)
    expect(isOcrTargetKind('project_member')).toBe(true)
    expect(isOcrTargetKind('unknown_kind')).toBe(false)
  })

  it('isOcrMatchReason 正确识别有效原因', () => {
    expect(isOcrMatchReason('exact_label')).toBe(true)
    expect(isOcrMatchReason('fuzzy')).toBe(true)
    expect(isOcrMatchReason('invalid')).toBe(false)
  })

  it('isOcrEntityLinkWarningCode 正确识别有效代码', () => {
    expect(isOcrEntityLinkWarningCode('TRUNCATED_TEXT')).toBe(true)
    expect(isOcrEntityLinkWarningCode('SOURCE_HASH_STALE')).toBe(true)
    expect(isOcrEntityLinkWarningCode('INVALID_CODE')).toBe(false)
  })

  it('isOcrEntityLinkPermissionAction 正确识别有效动作', () => {
    expect(isOcrEntityLinkPermissionAction('view')).toBe(true)
    expect(isOcrEntityLinkPermissionAction('confirm')).toBe(true)
    expect(isOcrEntityLinkPermissionAction('delete')).toBe(false)
  })

  it('isOcrEntityLinkAuditAction 正确识别有效审计动作', () => {
    expect(isOcrEntityLinkAuditAction('OCR_ENTITY_LINK_RUN_CREATED')).toBe(true)
    expect(isOcrEntityLinkAuditAction('OCR_ENTITY_LINK_CONFIRMED')).toBe(true)
    expect(isOcrEntityLinkAuditAction('INVALID_AUDIT')).toBe(false)
  })
})

// ─── 哈希稳定性 ────────────────────────────────────────────────────────────

describe('OCR Entity Linking — hash stability', () => {
  it('computeEntityLinkRunInputSignature 对相同输入产生相同哈希', () => {
    const input = {
      organizationId: 1,
      projectId: 1,
      actorId: 1,
      acceptedExtractionIds: [1, 2],
      extractionHashes: ['hash1', 'hash2'],
      sourceHashes: ['src1', 'src2'],
      ruleVersion: '1.0.0',
      targetKinds: ['task', 'milestone'] as const,
    }
    const sig1 = computeEntityLinkRunInputSignature(input)
    const sig2 = computeEntityLinkRunInputSignature({ ...input })
    expect(sig1).toBe(sig2)
    expect(sig1).toHaveLength(16) // 8+8 hex chars
  })

  it('computeEntityLinkRunInputSignature 对不同输入产生不同哈希', () => {
    const base = {
      organizationId: 1,
      projectId: 1,
      actorId: 1,
      acceptedExtractionIds: [1],
      extractionHashes: ['hash1'],
      sourceHashes: ['src1'],
      ruleVersion: '1.0.0',
      targetKinds: ['task'] as const,
    }
    const sig1 = computeEntityLinkRunInputSignature(base)
    const sig2 = computeEntityLinkRunInputSignature({ ...base, projectId: 2 })
    expect(sig1).not.toBe(sig2)
  })

  it('computeEntityLinkRunInputSignature 对排序不同的相同集合产生相同哈希', () => {
    const input1 = {
      organizationId: 1,
      projectId: 1,
      actorId: 1,
      acceptedExtractionIds: [2, 1],
      extractionHashes: ['hash2', 'hash1'],
      sourceHashes: ['src2', 'src1'],
      ruleVersion: '1.0.0',
      targetKinds: ['milestone', 'task'] as const,
    }
    const input2 = {
      organizationId: 1,
      projectId: 1,
      actorId: 1,
      acceptedExtractionIds: [1, 2],
      extractionHashes: ['hash1', 'hash2'],
      sourceHashes: ['src1', 'src2'],
      ruleVersion: '1.0.0',
      targetKinds: ['task', 'milestone'] as const,
    }
    expect(computeEntityLinkRunInputSignature(input1)).toBe(
      computeEntityLinkRunInputSignature(input2),
    )
  })

  it('computeCandidateKey 对相同输入产生相同键', () => {
    const key1 = computeCandidateKey(1, [0], { start: 10, end: 25 }, 'task_ref', '测试任务')
    const key2 = computeCandidateKey(1, [0], { start: 10, end: 25 }, 'task_ref', '测试任务')
    expect(key1).toBe(key2)
  })

  it('computeCandidateKey 对不同 span 产生不同键', () => {
    const key1 = computeCandidateKey(1, [0], { start: 10, end: 25 }, 'task_ref', '测试任务')
    const key2 = computeCandidateKey(1, [0], { start: 11, end: 25 }, 'task_ref', '测试任务')
    expect(key1).not.toBe(key2)
  })

  it('computeCandidateKey 对不同 label 产生不同键', () => {
    const key1 = computeCandidateKey(1, [0], { start: 10, end: 25 }, 'task_ref', '测试任务 A')
    const key2 = computeCandidateKey(1, [0], { start: 10, end: 25 }, 'task_ref', '测试任务 B')
    expect(key1).not.toBe(key2)
  })

  it('computeCandidateKey 对 pageRefs 排序不敏感', () => {
    const key1 = computeCandidateKey(1, [1, 0], { start: 10, end: 25 }, 'task_ref', '测试任务')
    const key2 = computeCandidateKey(1, [0, 1], { start: 10, end: 25 }, 'task_ref', '测试任务')
    expect(key1).toBe(key2)
  })

  it('computePreviewHash 对相同 payload 产生相同哈希', () => {
    const payload = buildAdvisoryPayload()
    const h1 = computePreviewHash(payload)
    const h2 = computePreviewHash({ ...payload })
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  it('computePreviewHash 对不同 target 产生不同哈希', () => {
    const p1 = buildAdvisoryPayload()
    const p2 = buildAdvisoryPayload({ targetId: 99 })
    expect(computePreviewHash(p1)).not.toBe(computePreviewHash(p2))
  })

  it('computeConfirmationHash 稳定', () => {
    const h1 = computeConfirmationHash('previewHash', 1, '2026-08-01T10:00:00Z')
    const h2 = computeConfirmationHash('previewHash', 1, '2026-08-01T10:00:00Z')
    expect(h1).toBe(h2)
  })

  it('computeConfirmationHash 对不同 reviewer 产生不同哈希', () => {
    const h1 = computeConfirmationHash('previewHash', 1, '2026-08-01T10:00:00Z')
    const h2 = computeConfirmationHash('previewHash', 2, '2026-08-01T10:00:00Z')
    expect(h1).not.toBe(h2)
  })
})

// ─── 脱敏 ──────────────────────────────────────────────────────────────────

describe('OCR Entity Linking — redaction', () => {
  it('redactTargetTitle 对可访问目标返回原标题', () => {
    expect(redactTargetTitle('测试任务 A', true)).toBe('测试任务 A')
  })

  it('redactTargetTitle 对不可访问目标返回占位符', () => {
    expect(redactTargetTitle('机密任务', false)).toBe('[不可访问]')
  })

  it('redactSummary 对已标记 redacted 的目标完全脱敏', () => {
    const summary = buildTargetSuggestion({ redacted: true, title: '机密' })
    const redacted = redactSummary(summary)
    expect(redacted.title).toBe('[已脱敏]')
    expect(redacted.targetId).toBe(0)
    expect(redacted.navigationRef).toBeNull()
  })

  it('redactSummary 对未标记 redacted 的目标保留原值', () => {
    const summary = buildTargetSuggestion({ redacted: false })
    const result = redactSummary(summary)
    expect(result.title).toBe(summary.title)
    expect(result.targetId).toBe(summary.targetId)
  })
})

// ─── 警告聚合 ──────────────────────────────────────────────────────────────

describe('OCR Entity Linking — warning aggregation', () => {
  const severityMap = {
    DUPLICATE_CONFIRMED: 'error' as const,
    SOURCE_HASH_STALE: 'error' as const,
    TARGET_INACCESSIBLE: 'warn' as const,
    LOW_CONFIDENCE: 'warn' as const,
    TRUNCATED_TEXT: 'info' as const,
  } as const

  it('aggregateWarnings 去重', () => {
    const warnings = aggregateWarnings(
      ['LOW_CONFIDENCE', 'LOW_CONFIDENCE', 'TRUNCATED_TEXT'],
      severityMap,
    )
    expect(warnings).toHaveLength(2)
  })

  it('aggregateWarnings 按 severity 排序 (error > warn > info)', () => {
    const warnings = aggregateWarnings(
      ['TRUNCATED_TEXT', 'DUPLICATE_CONFIRMED', 'LOW_CONFIDENCE'],
      severityMap,
    )
    expect(warnings[0].code).toBe('DUPLICATE_CONFIRMED')
    expect(warnings[1].code).toBe('LOW_CONFIDENCE')
    expect(warnings[2].code).toBe('TRUNCATED_TEXT')
  })

  it('aggregateWarnings 空列表返回空数组', () => {
    const warnings = aggregateWarnings([], severityMap)
    expect(warnings).toHaveLength(0)
  })

  it('aggregateWarnings 消息正确', () => {
    const warnings = aggregateWarnings(['SOURCE_HASH_STALE'], severityMap)
    expect(warnings[0].message).toBe('来源文件哈希已变更')
    expect(warnings[0].severity).toBe('error')
  })
})

// ─── 默认红线 ──────────────────────────────────────────────────────────────

describe('OCR Entity Linking — default redline', () => {
  it('DEFAULT_REDLINE_SUMMARY 所有字段为 false', () => {
    const r = DEFAULT_REDLINE_SUMMARY
    expect(r.taskFields).toBe(false)
    expect(r.wbsFields).toBe(false)
    expect(r.riskFields).toBe(false)
    expect(r.milestoneFields).toBe(false)
    expect(r.fileBytes).toBe(false)
    expect(r.documentBody).toBe(false)
    expect(r.searchIndexes).toBe(false)
    expect(r.knowledgeBases).toBe(false)
    expect(r.compilerArtifacts).toBe(false)
    expect(r.aiDrafts).toBe(false)
    expect(r.externalSystems).toBe(false)
  })
})

// ─── Fixtures ──────────────────────────────────────────────────────────────

describe('OCR Entity Linking — fixtures', () => {
  it('buildSpanOffset 默认值正确', () => {
    const span = buildSpanOffset()
    expect(span.start).toBe(10)
    expect(span.end).toBe(25)
  })

  it('buildSpanOffset 覆盖', () => {
    const span = buildSpanOffset({ start: 5, end: 30 })
    expect(span.start).toBe(5)
    expect(span.end).toBe(30)
  })

  it('buildSourceExtractionRef 返回 current 状态', () => {
    const ref = buildSourceExtractionRef()
    expect(ref.status).toBe('current')
    expect(ref.extractionId).toBe(1)
  })

  it('buildTargetSuggestion 默认不是 redacted', () => {
    const ts = buildTargetSuggestion()
    expect(ts.redacted).toBe(false)
    expect(ts.targetKind).toBe('task')
  })

  it('buildCandidate 返回 matched 候选', () => {
    const c = buildCandidate()
    expect(c.status).toBe('matched')
    expect(c.targetSuggestion).not.toBeNull()
  })

  it('buildUnmatchedCandidate 无 targetSuggestion', () => {
    const c = buildUnmatchedCandidate()
    expect(c.status).toBe('unmatched')
    expect(c.targetSuggestion).toBeNull()
    expect(c.warnings).toContain('TARGET_NOT_FOUND')
  })

  it('buildRunSummary 默认 completed', () => {
    const r = buildRunSummary()
    expect(r.status).toBe('completed')
    expect(r.candidateCount).toBe(5)
  })

  it('buildPreview 生成有效的 previewHash', () => {
    const p = buildPreview()
    expect(p.previewHash).toBeTruthy()
    expect(p.requiresUserConfirmation).toBe(true)
  })

  it('buildConfirmedLink 默认 active', () => {
    const l = buildConfirmedLink()
    expect(l.lifecycleStatus).toBe('active')
    expect(l.supersededById).toBeNull()
  })

  it('fixtureCandidateSet 返回 8 个候选', () => {
    const set = fixtureCandidateSet(1)
    expect(set).toHaveLength(8)
    // 包含多种 mentionType
    const types = set.map((c) => c.mentionType)
    expect(types).toContain('task_ref')
    expect(types).toContain('milestone_ref')
    expect(types).toContain('wbs_ref')
    expect(types).toContain('risk_ref')
    expect(types).toContain('person_name')
    expect(types).toContain('amount_expression')
    expect(types).toContain('file_ref')
    expect(types).toContain('date_expression')
  })

  it('fixtureAcceptedTextSmall 包含中文实体', () => {
    const text = fixtureAcceptedTextSmall()
    expect(text).toContain('TASK-001')
    expect(text).toContain('M1')
    expect(text).toContain('R-004')
    expect(text).toContain('张三')
  })

  it('fixtureAcceptedTextLarge 超过 100 行', () => {
    const text = fixtureAcceptedTextLarge()
    const lines = text.split('\n')
    expect(lines.length).toBeGreaterThan(100)
  })

  it('fixtureAcceptedTextLarge 包含中文', () => {
    const text = fixtureAcceptedTextLarge()
    expect(text).toContain('任务')
    expect(text).toContain('预算')
  })
})

// ─── 幂等键 ────────────────────────────────────────────────────────────────

describe('OCR Entity Linking — idempotency keys', () => {
  it('buildPreview 对相同 payload 的 preview hash 一致', () => {
    const p1 = buildPreview()
    const p2 = buildPreview({
      advisoryLinkPayload: p1.advisoryLinkPayload,
    })
    expect(p1.previewHash).toBe(p2.previewHash)
  })

  it('buildCandidate 的 candidateKey 稳定', () => {
    const c1 = buildCandidate()
    const c2 = buildCandidate({
      extractionId: c1.extractionId,
      pageRefs: c1.pageRefs,
      spanOffset: c1.spanOffset,
      mentionType: c1.mentionType,
      normalizedLabel: c1.normalizedLabel,
    })
    expect(c1.candidateKey).toBe(c2.candidateKey)
  })
})
