/**
 * OCR Result Persistence And Retention — 共享契约测试
 *
 * v3-ocr-result-persistence-and-retention §2.6/§2.7
 * 覆盖：策略解析、哈希稳定性、生命周期迁移、保留资格、越界拒绝、
 * 摘要/tombstone/审计载荷的敏感内容排除。
 */

import { describe, expect, it } from 'vitest'
import {
  OCR_RETENTION_SENSITIVITY_CATEGORIES,
  OCR_RETENTION_LIFECYCLE_STATES,
  OCR_RETENTION_SYSTEM_BOUNDS,
  OCR_RETENTION_SYSTEM_DEFAULT_DAYS,
  OCR_RETENTION_HOLD_NOTE_MAX_LENGTH,
  buildSystemDefaultCategoryPolicies,
  buildLowSensitiveTombstonePayload,
  buildOcrRetentionAuditMetadata,
  computeCleanupPreviewHash,
  computeRetentionDeadlineIso,
  computeRetentionPolicyHash,
  computeRecordFingerprint,
  computeTombstoneHash,
  computeHoldScopeHash,
  containsSensitiveMarkers,
  findInvalidCategoryPolicies,
  isOcrRetentionBlockedReason,
  isOcrRetentionHoldReasonCode,
  isOcrRetentionHoldScopeKind,
  isOcrRetentionLifecycleState,
  isOcrRetentionRecordKind,
  isOcrRetentionSensitivityCategory,
  isRetentionDeadlineReached,
  isValidHoldNote,
  isValidOcrRetentionLifecycleTransition,
  looksLikeAbsolutePath,
  mergeRetentionPolicyOverride,
  redactRetentionSensitiveFields,
  resolveOcrRetentionAllowedActions,
  resolveSystemDefaultRetentionPolicy,
  retentionDaysForCategory,
} from './ocr-result-retention.js'
import {
  buildAcceptedExtractionRetentionSummary,
  buildCleanupPreviewResponse,
  buildCleanupResult,
  buildProjectOverridePolicy,
  buildRetentionHold,
  buildRetentionPolicy,
  buildRetentionRecordSummary,
  buildRetentionTombstone,
} from './ocr-result-retention-fixtures.js'

describe('枚举与类型守卫', () => {
  it('敏感度分类覆盖 design 的 9 类', () => {
    expect(OCR_RETENTION_SENSITIVITY_CATEGORIES).toHaveLength(9)
    for (const c of [
      'job_metadata',
      'page_state',
      'candidate_text',
      'candidate_metadata',
      'accepted_extraction_text',
      'accepted_extraction_metadata',
      'provider_summary',
      'audit_metadata',
      'tombstone',
    ]) {
      expect(isOcrRetentionSensitivityCategory(c)).toBe(true)
    }
    expect(isOcrRetentionSensitivityCategory('raw_provider_body')).toBe(false)
  })

  it('生命周期状态覆盖 8 态', () => {
    expect(OCR_RETENTION_LIFECYCLE_STATES).toHaveLength(8)
    for (const s of [
      'active',
      'reviewable',
      'accepted',
      'superseded',
      'expired',
      'purge_pending',
      'purged',
      'hold_blocked',
    ]) {
      expect(isOcrRetentionLifecycleState(s)).toBe(true)
    }
    expect(isOcrRetentionLifecycleState('deleted')).toBe(false)
  })

  it('record kind / blocked reason / hold 枚举守卫', () => {
    expect(isOcrRetentionRecordKind('candidate')).toBe(true)
    expect(isOcrRetentionRecordKind('task')).toBe(false)
    expect(isOcrRetentionBlockedReason('hold_active')).toBe(true)
    expect(isOcrRetentionBlockedReason('random')).toBe(false)
    expect(isOcrRetentionHoldScopeKind('accepted_extraction')).toBe(true)
    expect(isOcrRetentionHoldScopeKind('organization')).toBe(false)
    expect(isOcrRetentionHoldReasonCode('audit_request')).toBe(true)
    expect(isOcrRetentionHoldReasonCode('legal')).toBe(false)
  })
})

describe('策略解析（§2.6）', () => {
  it('系统默认策略覆盖全部 9 类且天数在边界内', () => {
    const cats = buildSystemDefaultCategoryPolicies()
    expect(cats).toHaveLength(9)
    for (const c of cats) {
      expect(c.retentionDays).toBeGreaterThanOrEqual(OCR_RETENTION_SYSTEM_BOUNDS.minDays)
      expect(c.retentionDays).toBeLessThanOrEqual(OCR_RETENTION_SYSTEM_BOUNDS.maxDays)
      expect(c.retentionDays).toBe(OCR_RETENTION_SYSTEM_DEFAULT_DAYS[c.category])
    }
  })

  it('resolveSystemDefaultRetentionPolicy 返回确定性哈希', () => {
    const p1 = resolveSystemDefaultRetentionPolicy({ organizationId: 1, projectId: 10 })
    const p2 = resolveSystemDefaultRetentionPolicy({ organizationId: 1, projectId: 10 })
    expect(p1.policyHash).toBe(p2.policyHash)
    expect(p1.source).toBe('system')
    const p3 = resolveSystemDefaultRetentionPolicy({ organizationId: 2, projectId: 10 })
    expect(p3.policyHash).not.toBe(p1.policyHash)
  })

  it('override 只覆盖显式分类，其余沿用基础策略', () => {
    const base = buildSystemDefaultCategoryPolicies()
    const merged = mergeRetentionPolicyOverride(base, [
      { category: 'candidate_text', retentionDays: 14, actionAfterExpiry: 'purge' },
    ])
    const cand = merged.find((c) => c.category === 'candidate_text')!
    expect(cand.retentionDays).toBe(14)
    const accepted = merged.find((c) => c.category === 'accepted_extraction_text')!
    expect(accepted.retentionDays).toBe(OCR_RETENTION_SYSTEM_DEFAULT_DAYS.accepted_extraction_text)
  })

  it('越界天数被拒绝（out_of_bounds）', () => {
    const invalid = findInvalidCategoryPolicies([
      { category: 'candidate_text', retentionDays: 0, actionAfterExpiry: 'purge' },
      { category: 'tombstone', retentionDays: 99999, actionAfterExpiry: 'purge' },
      { category: 'job_metadata', retentionDays: 30, actionAfterExpiry: 'expire' },
    ])
    expect(invalid).toHaveLength(2)
    expect(invalid.every((i) => i.reason === 'out_of_bounds')).toBe(true)
  })

  it('未知分类与重复分类被拒绝', () => {
    const invalid = findInvalidCategoryPolicies([
      // @ts-expect-error 故意传入未知分类
      { category: 'mystery', retentionDays: 30, actionAfterExpiry: 'expire' },
      { category: 'candidate_text', retentionDays: 30, actionAfterExpiry: 'purge' },
      { category: 'candidate_text', retentionDays: 60, actionAfterExpiry: 'purge' },
    ])
    expect(invalid.map((i) => i.reason).sort()).toEqual(['duplicate', 'unknown_category'])
  })

  it('retentionDaysForCategory 回退到系统默认', () => {
    const policy = buildRetentionPolicy({
      categories: [{ category: 'candidate_text', retentionDays: 7, actionAfterExpiry: 'purge' }],
    })
    expect(retentionDaysForCategory(policy, 'candidate_text')).toBe(7)
    expect(retentionDaysForCategory(policy, 'tombstone')).toBe(
      OCR_RETENTION_SYSTEM_DEFAULT_DAYS.tombstone,
    )
  })
})

describe('哈希稳定性（§2.6）', () => {
  it('策略哈希与分类顺序无关', () => {
    const cats = buildSystemDefaultCategoryPolicies()
    const reversed = [...cats].reverse()
    const h1 = computeRetentionPolicyHash({ organizationId: 1, projectId: 10, categories: cats })
    const h2 = computeRetentionPolicyHash({
      organizationId: 1,
      projectId: 10,
      categories: reversed,
    })
    expect(h1).toBe(h2)
  })

  it('preview 哈希对指纹排序稳定且随 now 变化', () => {
    const h1 = computeCleanupPreviewHash({
      organizationId: 1,
      projectId: 10,
      policyHash: 'p',
      recordFingerprints: ['b', 'a'],
      nowIso: '2026-08-02T00:00:00.000Z',
    })
    const h2 = computeCleanupPreviewHash({
      organizationId: 1,
      projectId: 10,
      policyHash: 'p',
      recordFingerprints: ['a', 'b'],
      nowIso: '2026-08-02T00:00:00.000Z',
    })
    expect(h1).toBe(h2)
    const h3 = computeCleanupPreviewHash({
      organizationId: 1,
      projectId: 10,
      policyHash: 'p',
      recordFingerprints: ['a', 'b'],
      nowIso: '2026-08-03T00:00:00.000Z',
    })
    expect(h3).not.toBe(h1)
  })

  it('record fingerprint 不含敏感文本字段', () => {
    const fp = computeRecordFingerprint({
      recordKind: 'candidate',
      recordId: 1,
      lifecycleState: 'reviewable',
      sourceHash: 's',
      contentHash: 'c',
    })
    expect(fp).toMatch(/^[0-9a-f]{8}$/)
  })

  it('tombstone / hold scope 哈希确定性', () => {
    const t1 = computeTombstoneHash({
      recordKind: 'candidate',
      recordId: 1,
      cleanupReason: 'retention_expired',
      policyHash: 'p',
      purgedAtIso: '2026-08-02T00:00:00.000Z',
    })
    const t2 = computeTombstoneHash({
      recordKind: 'candidate',
      recordId: 1,
      cleanupReason: 'retention_expired',
      policyHash: 'p',
      purgedAtIso: '2026-08-02T00:00:00.000Z',
    })
    expect(t1).toBe(t2)
    const s1 = computeHoldScopeHash({
      organizationId: 1,
      projectId: 10,
      scopeKind: 'job',
      scopeRef: '42',
    })
    expect(s1).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('生命周期迁移（§2.6）', () => {
  it('purged 是终态', () => {
    for (const s of OCR_RETENTION_LIFECYCLE_STATES) {
      expect(isValidOcrRetentionLifecycleTransition('purged', s)).toBe(false)
    }
  })

  it('active/reviewable 可以进入 accepted', () => {
    expect(isValidOcrRetentionLifecycleTransition('active', 'accepted')).toBe(true)
    expect(isValidOcrRetentionLifecycleTransition('reviewable', 'accepted')).toBe(true)
    expect(isValidOcrRetentionLifecycleTransition('expired', 'accepted')).toBe(false)
  })

  it('accepted → superseded 合法，反向非法', () => {
    expect(isValidOcrRetentionLifecycleTransition('accepted', 'superseded')).toBe(true)
    expect(isValidOcrRetentionLifecycleTransition('superseded', 'accepted')).toBe(false)
  })

  it('hold_blocked 可释放回非终态，但不能直接 purged', () => {
    expect(isValidOcrRetentionLifecycleTransition('hold_blocked', 'expired')).toBe(true)
    expect(isValidOcrRetentionLifecycleTransition('hold_blocked', 'accepted')).toBe(true)
    expect(isValidOcrRetentionLifecycleTransition('hold_blocked', 'purged')).toBe(false)
  })

  it('expired → purge_pending → purged 链路合法', () => {
    expect(isValidOcrRetentionLifecycleTransition('expired', 'purge_pending')).toBe(true)
    expect(isValidOcrRetentionLifecycleTransition('purge_pending', 'purged')).toBe(true)
    expect(isValidOcrRetentionLifecycleTransition('active', 'purged')).toBe(false)
  })
})

describe('保留资格（§2.6）', () => {
  it('deadline 计算与到达判定', () => {
    const deadline = computeRetentionDeadlineIso('2026-08-01T00:00:00.000Z', 30)
    expect(deadline).toBe('2026-08-31T00:00:00.000Z')
    expect(
      isRetentionDeadlineReached({
        baseIso: '2026-08-01T00:00:00.000Z',
        retentionDays: 30,
        nowIso: '2026-08-30T00:00:00.000Z',
      }),
    ).toBe(false)
    expect(
      isRetentionDeadlineReached({
        baseIso: '2026-08-01T00:00:00.000Z',
        retentionDays: 30,
        nowIso: '2026-08-31T00:00:00.000Z',
      }),
    ).toBe(true)
  })
})

describe('脱敏（§2.4/§2.7）', () => {
  it('绝对路径探测', () => {
    expect(looksLikeAbsolutePath('/var/data/ocr/1.png')).toBe(true)
    expect(looksLikeAbsolutePath('C:\\storage\\ocr\\1.png')).toBe(true)
    expect(looksLikeAbsolutePath('D:/storage/ocr/1.png')).toBe(true)
    expect(looksLikeAbsolutePath('\\\\nas\\share\\1.png')).toBe(true)
    expect(looksLikeAbsolutePath('documents/report.pdf')).toBe(false)
    expect(looksLikeAbsolutePath('第 1 页文本')).toBe(false)
  })

  it('redactRetentionSensitiveFields 剥离完整文本/provider body/prompt/secret', () => {
    const dirty = {
      candidateHash: 'abc',
      extractedText: '完整的 OCR 敏感文本',
      selected_text: '确认的完整文本',
      rawProviderBody: '{"result": "..."}',
      promptHint: 'system prompt 内容',
      apiKey: 'sk-live-123',
      authorization: 'Bearer x',
      nested: { storagePath: '/abs/path/1.png', note: 'ok' },
    }
    const clean = redactRetentionSensitiveFields(dirty) as Record<string, unknown>
    expect(clean.candidateHash).toBe('abc')
    expect(clean.extractedText).toBe('[REDACTED]')
    expect(clean.selected_text).toBe('[REDACTED]')
    expect(clean.rawProviderBody).toBe('[REDACTED]')
    expect(clean.promptHint).toBe('[REDACTED]')
    expect(clean.apiKey).toBe('[REDACTED]')
    expect(clean.authorization).toBe('[REDACTED]')
    const nested = clean.nested as Record<string, unknown>
    expect(nested.storagePath).toBe('[REDACTED]')
    expect(nested.note).toBe('ok')
  })

  it('字符串值形似绝对路径时也被脱敏', () => {
    const clean = redactRetentionSensitiveFields({ ref: 'C:\\data\\secret.pdf' }) as Record<
      string,
      unknown
    >
    expect(clean.ref).toBe('[REDACTED]')
  })

  it('containsSensitiveMarkers 检测敏感键名', () => {
    expect(containsSensitiveMarkers({ extractedText: 'x' })).toBe(true)
    expect(containsSensitiveMarkers({ candidateHash: 'x' })).toBe(false)
  })
})

describe('tombstone 与审计载荷（§2.7）', () => {
  it('buildLowSensitiveTombstonePayload 不含完整文本且哈希确定', () => {
    const payload = buildLowSensitiveTombstonePayload({
      organizationId: 1,
      projectId: 10,
      recordKind: 'candidate',
      recordId: 101,
      sourceKind: 'attachment',
      sourceHash: 'src',
      contentHash: 'cand',
      lifecycleAction: 'purge',
      cleanupReason: 'retention_expired',
      policyHash: 'pol',
      purgedAtIso: '2026-08-02T00:00:00.000Z',
    })
    expect(payload.tombstoneHash).toMatch(/^[0-9a-f]{8}$/)
    const json = JSON.stringify(payload)
    expect(json).not.toContain('extractedText')
    expect(json).not.toContain('selectedText')
    expect(json).not.toContain('rawProviderBody')
    expect(json).not.toContain('prompt')
    expect(containsSensitiveMarkers(payload)).toBe(false)
  })

  it('buildOcrRetentionAuditMetadata 只含低敏字段', () => {
    const meta = buildOcrRetentionAuditMetadata({
      actorId: 7,
      organizationId: 1,
      projectId: 10,
      action: 'OCR_RETENTION_CLEANUP_EXECUTED',
      policyHash: 'p',
      previewHash: 'pv',
      runId: 9001,
      counts: { purged: 3 },
    })
    expect(meta.actor).toBe(7)
    expect(meta.runId).toBe(9001)
    expect(containsSensitiveMarkers(meta)).toBe(false)
  })

  it('夹具 tombstone / hold / preview / result 均通过敏感标记检查', () => {
    expect(containsSensitiveMarkers(buildRetentionTombstone())).toBe(false)
    expect(containsSensitiveMarkers(buildRetentionHold())).toBe(false)
    expect(containsSensitiveMarkers(buildCleanupPreviewResponse())).toBe(false)
    expect(containsSensitiveMarkers(buildCleanupResult())).toBe(false)
    expect(containsSensitiveMarkers(buildRetentionRecordSummary())).toBe(false)
    expect(containsSensitiveMarkers(buildAcceptedExtractionRetentionSummary())).toBe(false)
  })
})

describe('hold note 与 allowed actions（§2.6/§2.7）', () => {
  it('hold note 有界且拒绝绝对路径', () => {
    expect(isValidHoldNote(null)).toBe(true)
    expect(isValidHoldNote('审查中')).toBe(true)
    expect(isValidHoldNote('x'.repeat(OCR_RETENTION_HOLD_NOTE_MAX_LENGTH))).toBe(true)
    expect(isValidHoldNote('x'.repeat(OCR_RETENTION_HOLD_NOTE_MAX_LENGTH + 1))).toBe(false)
    expect(isValidHoldNote('/abs/path/note')).toBe(false)
  })

  it('allowed actions 按权限派生', () => {
    expect(
      resolveOcrRetentionAllowedActions({ canView: true, canManage: false, canHold: false }),
    ).toEqual(['view_status'])
    const full = resolveOcrRetentionAllowedActions({
      canView: true,
      canManage: true,
      canHold: true,
    })
    expect(full).toContain('execute_cleanup')
    expect(full).toContain('set_hold')
    const holdOnly = resolveOcrRetentionAllowedActions({
      canView: false,
      canManage: false,
      canHold: true,
    })
    expect(holdOnly).toEqual(['set_hold', 'release_hold'])
  })
})

describe('夹具一致性（§2.5）', () => {
  it('项目 override 策略只收窄 candidate_text', () => {
    const p = buildProjectOverridePolicy()
    expect(p.source).toBe('project')
    expect(p.categories.find((c) => c.category === 'candidate_text')!.retentionDays).toBe(14)
    expect(p.policyHash).not.toBe(buildRetentionPolicy().policyHash)
  })

  it('preview 夹具要求显式确认且不截断', () => {
    const preview = buildCleanupPreviewResponse()
    expect(preview.requiresExplicitConfirmation).toBe(true)
    expect(preview.truncated).toBe(false)
    expect(preview.eligible.length).toBeGreaterThan(0)
  })
})
