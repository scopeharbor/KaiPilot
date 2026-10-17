/**
 * OCR Permission & Audit — 共享契约测试
 *
 * 测试动作映射确定性、已知动作覆盖、未知动作拒绝、决策快照守卫、
 * 低敏感字段、被禁止载荷形状、哈希稳定与脱敏回归。
 */

import { describe, it, expect } from 'vitest'
import {
  OCR_PERMISSION_ACTIONS,
  OCR_PERMISSION_DECISION_RESULTS,
  OCR_PERMISSION_OUTPUT_MODES,
  OCR_PERMISSION_REASON_CODES,
  OCR_PERMISSION_AUDIT_ACTIONS,
  OCR_PERMISSION_AUDIT_EVENTS,
  isOcrPermissionAction,
  isOcrPermissionDecisionResult,
  isOcrPermissionOutputMode,
  isOcrPermissionReasonCode,
  isOcrPermissionAuditAction,
  isOcrPermissionAuditEvent,
  isOcrLifecycleState,
  isOcrRetentionState,
  isOcrStaleStatus,
  isOcrGrantedSource,
  resolveActionMapping,
  isMutationAction,
  resolveAllowedActionsFromSnapshot,
  computeDecisionHash,
  computeStatusHash,
  computeAuditSummaryHash,
  computeSourceRefHash,
  computeContentHash,
  computeIdempotencyKey,
  buildOcrPermissionAuditMetadata,
  isRedactedMetadata,
  redactAuditMetadataSafe,
  buildDecisionSnapshot,
  type OcrAuthorizationDecisionSnapshot,
} from '@aiproj/types'
import {
  buildDecisionSnapshotFixture,
  buildProjectManagerRole,
  buildMemberRole,
  buildReadonlyObserverRole,
  buildExternalCollaboratorRole,
  buildDecisionPreview,
  buildPermissionStatus,
  buildAuditSummary,
  buildSourceRefHashFixture,
  buildAuditSummaryHashFixture,
  buildStaleSourceHashFixture,
  buildDeniedDecisionFixture,
  buildSensitiveDecisionFixture,
  buildPrivacyBlockedDecisionFixture,
  buildRetentionHeldDecisionFixture,
  buildStaleBlockedDecisionFixture,
  buildHiddenSourceDecisionFixture,
  buildDegradedDecisionFixture,
} from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// 枚举守卫与覆盖
// ═══════════════════════════════════════════════════════════════════════════════

describe('enum guards', () => {
  it.each(OCR_PERMISSION_ACTIONS)('isOcrPermissionAction(%s) => true', (v) => {
    expect(isOcrPermissionAction(v)).toBe(true)
    expect(isOcrPermissionAction('not_an_action')).toBe(false)
    expect(isOcrPermissionAction(null)).toBe(false)
    expect(isOcrPermissionAction(123)).toBe(false)
  })

  it.each(OCR_PERMISSION_DECISION_RESULTS)('isOcrPermissionDecisionResult(%s) => true', (v) => {
    expect(isOcrPermissionDecisionResult(v)).toBe(true)
    expect(isOcrPermissionDecisionResult('unknown')).toBe(false)
  })

  it.each(OCR_PERMISSION_OUTPUT_MODES)('isOcrPermissionOutputMode(%s) => true', (v) => {
    expect(isOcrPermissionOutputMode(v)).toBe(true)
    expect(isOcrPermissionOutputMode('unknown')).toBe(false)
  })

  it.each(OCR_PERMISSION_REASON_CODES)('isOcrPermissionReasonCode(%s) => true', (v) => {
    expect(isOcrPermissionReasonCode(v)).toBe(true)
    expect(isOcrPermissionReasonCode('custom_reason')).toBe(false)
  })

  it.each(OCR_PERMISSION_AUDIT_ACTIONS)('isOcrPermissionAuditAction(%s) => true', (v) => {
    expect(isOcrPermissionAuditAction(v)).toBe(true)
    expect(isOcrPermissionAuditAction('CUSTOM_AUDIT')).toBe(false)
  })

  it.each(OCR_PERMISSION_AUDIT_EVENTS)('isOcrPermissionAuditEvent(%s) => true', (v) => {
    expect(isOcrPermissionAuditEvent(v)).toBe(true)
    expect(isOcrPermissionAuditEvent('custom.event')).toBe(false)
  })

  it('细分状态守卫', () => {
    expect(isOcrLifecycleState('active')).toBe(true)
    expect(isOcrLifecycleState('invalid')).toBe(false)
    expect(isOcrRetentionState('held')).toBe(true)
    expect(isOcrStaleStatus('stale')).toBe(true)
    expect(isOcrGrantedSource('system_admin_bypass')).toBe(true)
    expect(isOcrGrantedSource('random')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 动作映射确定性（spec 2.3）
// ═══════════════════════════════════════════════════════════════════════════════

describe('action mapping', () => {
  it('覆盖全部已知动作', () => {
    for (const action of OCR_PERMISSION_ACTIONS) {
      const mapping = resolveActionMapping(action)
      expect(mapping).not.toBeNull()
      expect(mapping!.permission.length).toBeGreaterThan(0)
      expect(mapping!.displayAction.length).toBeGreaterThan(0)
      expect(mapping!.auditAction.length).toBeGreaterThan(0)
    }
  })

  it('覆盖关键动作解析', () => {
    expect(resolveActionMapping('accepted_text_read')!.permission).toBe('ocr:review')
    expect(resolveActionMapping('review_confirm')!.permission).toBe('ocr:confirm')
    expect(resolveActionMapping('copy_export_execution')!.auditAction).toBe('export_execute')
    expect(resolveActionMapping('search_indexing_execution')!.displayAction).toBe('index_execute')
    expect(resolveActionMapping('entity_linking_run')!.permission).toBe('ocr_entity_link:manage')
    expect(resolveActionMapping('ocr_audit_read')!.permission).toBe(
      'ocr_permission_audit:audit_read',
    )
  })

  it('未知动作返回 null', () => {
    expect(resolveActionMapping('auto_apply')).toBeNull()
    expect(resolveActionMapping('')).toBeNull()
    expect(resolveActionMapping('unknown_action')).toBeNull()
  })

  it('动作分类不含自动 apply —— 写类动作均需确认/幂等', () => {
    for (const action of OCR_PERMISSION_ACTIONS) {
      const mapping = resolveActionMapping(action)!
      if (mapping.isMutation) {
        // 写类动作必须是端到端受控动作，且无任何"自动 apply"键
        expect(action).not.toContain('auto_apply')
        expect(action).not.toContain('automatic')
        const mutationSet = new Set([
          'provider_run',
          'review_confirm',
          'supersede',
          'retention_hold',
          'search_indexing_execution',
          'structured_extraction_run',
          'entity_linking_run',
          'copy_export_execution',
          'optional_ai_handoff',
        ])
        expect(mutationSet.has(action)).toBe(true)
      }
    }
  })

  it('确定性：同一动作多次解析结果一致', () => {
    const a = resolveActionMapping('review_confirm')
    const b = resolveActionMapping('review_confirm')
    expect(a).toEqual(b)
  })

  it('isMutationAction 分类正确', () => {
    expect(isMutationAction('review_confirm')).toBe(true)
    expect(isMutationAction('accepted_text_read')).toBe(false)
    expect(isMutationAction('permission_status_read')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 决策快照 DTO 守卫与低敏感字段（spec 2.5）
// ═══════════════════════════════════════════════════════════════════════════════

describe('decision snapshot DTO', () => {
  it('快照包含全部必需低敏感字段', () => {
    const s = buildSensitiveDecisionFixture()
    expect(s.action).toBe('accepted_text_read')
    expect(s.result).toBe('allow')
    expect(s.requiredPermission).toBe('ocr:review')
    expect(s.grantedPermissionSource).toBe('role')
    expect(s.roleVersion).toBeDefined()
    expect(s.actorRef.id).toBe(100)
    expect(s.organizationRef.id).toBe(1)
    expect(s.projectRef.id).toBe(10)
    expect(s.sourceRef).not.toBeNull()
    expect(s.artifactRef).not.toBeNull()
    expect(s.sourceHash).toBeDefined()
    expect(s.lifecycleState).toBeDefined()
    expect(s.retentionState).toBeDefined()
    expect(s.staleStatus).toBeDefined()
    expect(s.outputMode).toBeDefined()
    expect(s.requiresConfirmation).toBeDefined()
    expect(Array.isArray(s.reasonCodes)).toBe(true)
    expect(s.decisionHash.length).toBe(8)
  })

  it('快照不含被禁止载荷形状', () => {
    const s = buildSensitiveDecisionFixture() as unknown as Record<string, unknown>
    const json = JSON.stringify(s)
    expect(json).not.toContain('fullText')
    expect(json).not.toContain('ocrText')
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('modelOutput')
    expect(json).not.toContain('apiKey')
    expect(json).not.toContain('authorization')
    expect(json).not.toContain('absolutePath')
    expect(json).not.toContain('rawBody')
  })

  it('decisionHash 确定性：同输入同哈希', () => {
    const a = buildDecisionSnapshotFixture({ action: 'review_confirm' })
    const b = buildDecisionSnapshotFixture({ action: 'review_confirm' })
    expect(a.decisionHash).toBe(b.decisionHash)
  })

  it('allow 与 deny 决策哈希不同', () => {
    const allow = buildDecisionSnapshotFixture({ action: 'review_confirm' })
    const denied = buildDeniedDecisionFixture()
    expect(allow.decisionHash).not.toBe(denied.decisionHash)
  })

  it('grantedSource=none 表示 denied（无授权来源）', () => {
    const denied = buildDeniedDecisionFixture()
    expect(denied.grantedPermissionSource).toBe('none')
    expect(denied.result).toBe('denied')
    expect(denied.reasonCodes).toContain('permission_missing')
  })

  it('resolveAllowedActionsFromSnapshot 只对 allow/confirm_required 返回动作', () => {
    expect(resolveAllowedActionsFromSnapshot(buildSensitiveDecisionFixture())).toEqual([
      'accepted_text_read',
    ])
    expect(resolveAllowedActionsFromSnapshot(buildDeniedDecisionFixture())).toEqual([])
    expect(resolveAllowedActionsFromSnapshot(buildHiddenSourceDecisionFixture())).toEqual([])
    expect(resolveAllowedActionsFromSnapshot(buildDegradedDecisionFixture())).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 哈希确定性（spec 2.6）
// ═══════════════════════════════════════════════════════════════════════════════

describe('deterministic hashes', () => {
  it('computeDecisionHash 同输入同哈希 / 异输入异哈希', () => {
    const base = {
      action: 'review_confirm' as const,
      result: 'allow' as const,
      requiredPermission: 'ocr:confirm',
      grantedPermissionSource: 'role' as const,
      roleVersion: 3,
      organizationId: 1,
      projectId: 10,
      sourceRefId: 1,
      artifactRefId: 1,
      sourceHash: 'sh1',
      lifecycleState: 'active' as const,
      retentionState: 'none' as const,
      holdActive: false,
      staleStatus: 'current' as const,
      privacyHash: null,
      outputMode: 'full' as const,
      reasonCodes: [],
    }
    expect(computeDecisionHash(base)).toBe(computeDecisionHash(base))
    expect(computeDecisionHash(base)).not.toBe(computeDecisionHash({ ...base, result: 'denied' }))
    expect(computeDecisionHash(base)).not.toBe(computeDecisionHash({ ...base, holdActive: true }))
  })

  it('computeStatusHash 稳定', () => {
    const a = computeStatusHash({
      organizationId: 1,
      projectId: 10,
      sourceRefId: 1,
      allowedActions: ['view'],
      blockedHashes: [],
      outputMode: 'full',
    })
    const b = computeStatusHash({
      organizationId: 1,
      projectId: 10,
      sourceRefId: 1,
      allowedActions: ['view'],
      blockedHashes: [],
      outputMode: 'full',
    })
    expect(a).toBe(b)
    expect(a.length).toBe(8)
  })

  it('computeAuditSummaryHash 稳定且含时间戳', () => {
    const a = computeAuditSummaryHash({
      event: 'e',
      action: 'a',
      result: 'r',
      actorId: 1,
      organizationId: 1,
      projectId: 10,
      sourceRefId: 1,
      artifactRefId: 1,
      sourceHash: 's',
      contentHash: 'c',
      createdAt: '2026-08-03T00:00:00.000Z',
    })
    const b = computeAuditSummaryHash({
      event: 'e',
      action: 'a',
      result: 'r',
      actorId: 1,
      organizationId: 1,
      projectId: 10,
      sourceRefId: 1,
      artifactRefId: 1,
      sourceHash: 's',
      contentHash: 'c',
      createdAt: '2026-08-03T00:00:00.000Z',
    })
    expect(a).toBe(b)
    expect(a).not.toBe(
      computeAuditSummaryHash({ ...baseHashInput(), createdAt: '2026-08-04T00:00:00.000Z' }),
    )
  })

  it('computeSourceRefHash 稳定', () => {
    expect(buildSourceRefHashFixture()).toBe(buildSourceRefHashFixture())
    expect(buildSourceRefHashFixture().length).toBe(8)
  })

  it('computeContentHash 不含完整文本（长度变则哈希变）', () => {
    const a = computeContentHash({
      extractionId: 1,
      sourceHash: 'sh',
      selectedTextHash: 'sel',
      textLength: 100,
      pageCount: 2,
    })
    const b = computeContentHash({
      extractionId: 1,
      sourceHash: 'sh',
      selectedTextHash: 'sel',
      textLength: 200,
      pageCount: 2,
    })
    expect(a).not.toBe(b)
  })

  it('computeIdempotencyKey 幂等', () => {
    const a = computeIdempotencyKey({
      organizationId: 1,
      projectId: 10,
      action: 'export',
      decisionHash: 'dh',
      artifactRefId: 1,
    })
    const b = computeIdempotencyKey({
      organizationId: 1,
      projectId: 10,
      action: 'export',
      decisionHash: 'dh',
      artifactRefId: 1,
    })
    expect(a).toBe(b)
    expect(a).not.toBe(
      computeIdempotencyKey({
        organizationId: 1,
        projectId: 10,
        action: 'export',
        decisionHash: 'dh2',
        artifactRefId: 1,
      }),
    )
  })
})

function baseHashInput() {
  return {
    event: 'e',
    action: 'a',
    result: 'r',
    actorId: 1,
    organizationId: 1,
    projectId: 10,
    sourceRefId: 1,
    artifactRefId: 1,
    sourceHash: 's',
    contentHash: 'c',
    createdAt: '2026-08-03T00:00:00.000Z',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 脱敏回归（spec 2.8）
// ═══════════════════════════════════════════════════════════════════════════════

describe('redaction regression', () => {
  const REPRESENTATIVE_OCR_TEXT =
    '这是一段完整的 OCR 识别文本，包含敏感的项目内容与客户姓名，长度超过 2000 字符以验证脱敏。'.repeat(
      200,
    )

  it('buildAuditMetadata 只含低敏感字段', () => {
    const meta = buildOcrPermissionAuditMetadata({
      event: 'ocr.permission.review_confirm',
      action: 'review_confirm',
      result: 'allow',
      sourceRefKind: 'attachment',
      sourceHash: 'src_hash_001',
      artifactRefKind: 'accepted_extraction',
      artifactRefId: 1,
      contentHash: 'content_hash_001',
      lifecycleState: 'active',
      retentionState: 'none',
      privacyHash: null,
      decisionHash: 'decision_hash_001',
      reasonCodes: [],
      countSummaries: { acceptedExtractions: 3 },
      warningCodes: ['REVIEW_WARNING'],
    })
    expect(isRedactedMetadata(meta)).toBe(true)
    expect(meta.sourceHash).toBe('src_hash_001')
    expect((meta as Record<string, unknown>).countSummaries).toEqual({ acceptedExtractions: 3 })
  })

  it('isRedactedMetadata 拒绝完整 OCR 文本', () => {
    expect(isRedactedMetadata({ fullText: REPRESENTATIVE_OCR_TEXT })).toBe(false)
    expect(isRedactedMetadata({ content: REPRESENTATIVE_OCR_TEXT })).toBe(false)
    expect(isRedactedMetadata({ prompt: 'prompt text' })).toBe(false)
    expect(isRedactedMetadata({ authorization: 'Bearer abc' })).toBe(false)
    expect(isRedactedMetadata({ apiKey: 'sk-123' })).toBe(false)
    expect(isRedactedMetadata({ absolutePath: 'C:\\tmp\\file.txt' })).toBe(false)
    expect(isRedactedMetadata({ rawBody: '{"provider":"x"}' })).toBe(false)
  })

  it('isRedactedMetadata 拒绝深嵌套敏感字段', () => {
    expect(isRedactedMetadata({ nested: { deep: { modelOutput: 'out' } } })).toBe(false)
    expect(isRedactedMetadata({ nested: { deep: { searchSnippet: 'snip' } } })).toBe(false)
  })

  it('redactAuditMetadataSafe 递归脱敏敏感键', () => {
    const redacted = redactAuditMetadataSafe({
      sourceHash: 'ok',
      apiKey: 'sk-secret',
      nested: { prompt: 'p', keep: 'yes' },
    }) as Record<string, unknown>
    expect(redacted.sourceHash).toBe('ok')
    // 递归脱敏后敏感键被替换为 [REDACTED]
    expect(JSON.stringify(redacted)).toContain('REDACTED')
    expect(JSON.stringify(redacted)).not.toContain('sk-secret')
  })

  it('拒绝审计元数据含超长疑似文本', () => {
    expect(isRedactedMetadata({ meta: { note: REPRESENTATIVE_OCR_TEXT } })).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 夹具构建器
// ═══════════════════════════════════════════════════════════════════════════════

describe('fixture builders', () => {
  it('角色夹具按最小权限', () => {
    expect(buildProjectManagerRole().permissions).toContain('ocr:confirm')
    expect(buildMemberRole().permissions).not.toContain('ocr:confirm')
    expect(buildReadonlyObserverRole().permissions).not.toContain('ocr:confirm')
    expect(buildExternalCollaboratorRole().permissions).toEqual(['ocr_document:view'])
  })

  it('决策快照夹具覆盖各状态', () => {
    expect(buildStaleBlockedDecisionFixture().result).toBe('stale_blocked')
    expect(buildRetentionHeldDecisionFixture().result).toBe('retention_blocked')
    expect(buildPrivacyBlockedDecisionFixture().result).toBe('privacy_blocked')
    expect(buildHiddenSourceDecisionFixture().result).toBe('metadata_only')
    expect(buildDegradedDecisionFixture().result).toBe('degraded')
    expect(buildDeniedDecisionFixture().result).toBe('denied')
  })

  it('决策预览/权限状态/审计摘要夹具有效', () => {
    expect(buildDecisionPreview().action).toBe('review_confirm')
    expect(buildPermissionStatus().allowedActions).toContain('permission_status_read')
    expect(buildAuditSummary().event).toBe('ocr.permission.review_confirm')
    expect(buildAuditSummaryHashFixture().length).toBe(8)
    expect(buildStaleSourceHashFixture()).toBe('stale_hash_999')
  })

  it('被拒/敏感/隐藏决策夹具不含敏感文本', () => {
    for (const s of [
      buildDeniedDecisionFixture(),
      buildSensitiveDecisionFixture(),
      buildHiddenSourceDecisionFixture(),
    ]) {
      expect(JSON.stringify(s)).not.toContain('fullText')
      expect(JSON.stringify(s)).not.toContain('prompt')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 快照构建纯函数
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildDecisionSnapshot', () => {
  it('计算确定性哈希并填充快照', () => {
    const s = buildDecisionSnapshot({
      action: 'review_confirm',
      result: 'allow',
      requiredPermission: 'ocr:confirm',
      grantedPermissionSource: 'role',
      roleVersion: 3,
      actorRef: { type: 'user', id: 100 },
      organizationRef: { type: 'organization', id: 1 },
      projectRef: { type: 'project', id: 10 },
      sourceRef: { type: 'ocr_source', id: 1, kind: 'attachment' },
      artifactRef: { type: 'ocr_artifact', id: 1, kind: 'accepted_extraction' },
      sourceHash: 'sh1',
      lifecycleState: 'active',
      retentionState: 'none',
      holdActive: false,
      staleStatus: 'current',
      privacyRef: null,
      privacyHash: null,
      outputMode: 'full',
      requiresConfirmation: false,
      reasonCodes: [],
    })
    expect(s.decisionHash.length).toBe(8)
    const s2: OcrAuthorizationDecisionSnapshot = buildDecisionSnapshot({
      action: 'review_confirm',
      result: 'allow',
      requiredPermission: 'ocr:confirm',
      grantedPermissionSource: 'role',
      roleVersion: 3,
      actorRef: { type: 'user', id: 100 },
      organizationRef: { type: 'organization', id: 1 },
      projectRef: { type: 'project', id: 10 },
      sourceRef: { type: 'ocr_source', id: 1, kind: 'attachment' },
      artifactRef: { type: 'ocr_artifact', id: 1, kind: 'accepted_extraction' },
      sourceHash: 'sh1',
      lifecycleState: 'active',
      retentionState: 'none',
      holdActive: false,
      staleStatus: 'current',
      privacyRef: null,
      privacyHash: null,
      outputMode: 'full',
      requiresConfirmation: false,
      reasonCodes: [],
    })
    expect(s.decisionHash).toBe(s2.decisionHash)
  })
})
