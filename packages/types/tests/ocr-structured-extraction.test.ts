/**
 * V3 OCR Structured Extraction — Shared Contract Tests
 *
 * 测试共享类型的枚举、类型守卫、哈希纯函数、profile 验证、脱敏和生命周期守卫。
 */

import { describe, it, expect } from 'vitest'
import {
  // 枚举
  OCR_EXTRACTION_PROFILE_STATUSES,
  OCR_EXTRACTION_PROFILE_SCOPES,
  OCR_STRUCTURED_FIELD_TYPES,
  OCR_EXTRACTION_RUN_STATUSES,
  OCR_EXTRACTION_CANDIDATE_STATUSES,
  OCR_EXTRACTION_WARNING_CODES,
  OCR_EXTRACTION_PROVENANCE_KINDS,
  OCR_EXTRACTION_CONFIDENCE_LEVELS,
  OCR_EXTRACTION_RUN_ACTIONS,
  OCR_STRUCTURED_EXTRACTION_AUDIT_ACTIONS,
  // 类型守卫
  isOcrExtractionProfileStatus,
  isOcrExtractionProfileScope,
  isOcrStructuredFieldType,
  isOcrExtractionRunStatus,
  isOcrExtractionCandidateStatus,
  isOcrExtractionWarningCode,
  isOcrExtractionProvenanceKind,
  isOcrExtractionConfidenceLevel,
  isOcrExtractionRunAction,
  // 哈希
  computeSourceSpanHash,
  computeFieldCandidateHash,
  computeTableRowHash,
  computeStructuredExtractionPreviewHash,
  computeStructuredExtractionSnapshotHash,
  computeStructuredExtractionInputSignature,
  normalizeStructuredExtractionIdempotencyKey,
  stableJson,
  // Profile 验证
  validateOcrExtractionProfileSchema,
  // 生命周期
  isAcceptedExtractionEligible,
  isStructuredExtractionSourceVisible,
  // Confidence
  resolveConfidenceLevel,
  aggregateExtractionWarningSummary,
  // 红线
  buildStructuredExtractionRedlineSummary,
  // 脱敏
  redactStructuredExtractionMetadata,
  buildStructuredExtractionAuditMetadata,
  // 动作
  resolveStructuredExtractionActions,
  sortFieldCandidates,
  sortTableRows,
} from '../src/ocr-structured-extraction.js'

import {
  buildMeetingMinutesProfileSchema,
  buildActionItemsProfileSchema,
  buildMilestoneListProfileSchema,
  buildRiskRegisterProfileSchema,
  buildRequirementSheetProfileSchema,
  buildProfileSummary,
  buildProfileDetail,
  buildExtractionSourceSummary,
  buildFieldCandidate,
  buildDateFieldCandidate,
  buildAmbiguousDateFieldCandidate,
  buildTableRowCandidate,
  buildTableCandidate,
  buildRunSummary,
  buildRunDetail,
  buildPreviewResponse,
  buildSnapshotSummary,
  buildSourceSpanRef,
  buildTypedTextValue,
  buildTypedDateValue,
  buildTypedNumberValue,
  buildTypedEnumValue,
  buildTypedPersonNameValue,
  buildTypedProjectRefValue,
  buildTableCellValue,
  buildExtractionWarning,
  buildEmptyWarningSummary,
  buildRedlineSummary,
  meetingMinutesAcceptedText,
  actionItemsAcceptedText,
  milestoneListAcceptedText,
  riskRegisterAcceptedText,
  requirementSheetAcceptedText,
  largeAcceptedText,
  largeTableAcceptedText,
} from '../src/ocr-structured-extraction-fixtures.js'

// ─── 枚举测试 ───────────────────────────────────────────────────────────

describe('OCR structured extraction enums', () => {
  it('has all expected profile statuses', () => {
    expect(OCR_EXTRACTION_PROFILE_STATUSES).toContain('draft')
    expect(OCR_EXTRACTION_PROFILE_STATUSES).toContain('active')
    expect(OCR_EXTRACTION_PROFILE_STATUSES).toContain('archived')
    expect(OCR_EXTRACTION_PROFILE_STATUSES).toHaveLength(3)
  })

  it('has all expected profile scopes', () => {
    expect(OCR_EXTRACTION_PROFILE_SCOPES).toContain('builtin')
    expect(OCR_EXTRACTION_PROFILE_SCOPES).toContain('project')
    expect(OCR_EXTRACTION_PROFILE_SCOPES).toContain('organization')
    expect(OCR_EXTRACTION_PROFILE_SCOPES).toHaveLength(3)
  })

  it('has all expected field types', () => {
    expect(OCR_STRUCTURED_FIELD_TYPES).toContain('text')
    expect(OCR_STRUCTURED_FIELD_TYPES).toContain('date')
    expect(OCR_STRUCTURED_FIELD_TYPES).toContain('number')
    expect(OCR_STRUCTURED_FIELD_TYPES).toContain('enum')
    expect(OCR_STRUCTURED_FIELD_TYPES).toContain('person_name')
    expect(OCR_STRUCTURED_FIELD_TYPES).toContain('project_ref')
    expect(OCR_STRUCTURED_FIELD_TYPES).toContain('table')
    expect(OCR_STRUCTURED_FIELD_TYPES).toHaveLength(7)
  })

  it('has all expected run statuses', () => {
    expect(OCR_EXTRACTION_RUN_STATUSES).toContain('pending')
    expect(OCR_EXTRACTION_RUN_STATUSES).toContain('processing')
    expect(OCR_EXTRACTION_RUN_STATUSES).toContain('completed')
    expect(OCR_EXTRACTION_RUN_STATUSES).toContain('completed_with_warnings')
    expect(OCR_EXTRACTION_RUN_STATUSES).toContain('failed')
    expect(OCR_EXTRACTION_RUN_STATUSES).toContain('canceled')
    expect(OCR_EXTRACTION_RUN_STATUSES).toHaveLength(6)
  })

  it('has all expected warning codes', () => {
    expect(OCR_EXTRACTION_WARNING_CODES).toContain('AMBIGUOUS_DATE')
    expect(OCR_EXTRACTION_WARNING_CODES).toContain('LOW_CONFIDENCE_MATCH')
    expect(OCR_EXTRACTION_WARNING_CODES).toContain('MISSING_REQUIRED_FIELD')
    expect(OCR_EXTRACTION_WARNING_CODES).toContain('AI_FALLBACK_USED')
    expect(OCR_EXTRACTION_WARNING_CODES).toHaveLength(12)
  })

  it('has all expected provenance kinds', () => {
    expect(OCR_EXTRACTION_PROVENANCE_KINDS).toContain('deterministic')
    expect(OCR_EXTRACTION_PROVENANCE_KINDS).toContain('ai_assisted')
    expect(OCR_EXTRACTION_PROVENANCE_KINDS).toContain('ai_fallback')
    expect(OCR_EXTRACTION_PROVENANCE_KINDS).toHaveLength(3)
  })
})

// ─── 类型守卫测试 ────────────────────────────────────────────────────────

describe('OCR structured extraction type guards', () => {
  it('isOcrExtractionProfileStatus validates correctly', () => {
    expect(isOcrExtractionProfileStatus('active')).toBe(true)
    expect(isOcrExtractionProfileStatus('draft')).toBe(true)
    expect(isOcrExtractionProfileStatus('archived')).toBe(true)
    expect(isOcrExtractionProfileStatus('invalid')).toBe(false)
    expect(isOcrExtractionProfileStatus(null)).toBe(false)
    expect(isOcrExtractionProfileStatus(undefined)).toBe(false)
    expect(isOcrExtractionProfileStatus(123)).toBe(false)
  })

  it('isOcrExtractionProfileScope validates correctly', () => {
    expect(isOcrExtractionProfileScope('builtin')).toBe(true)
    expect(isOcrExtractionProfileScope('project')).toBe(true)
    expect(isOcrExtractionProfileScope('organization')).toBe(true)
    expect(isOcrExtractionProfileScope('global')).toBe(false)
    expect(isOcrExtractionProfileScope('')).toBe(false)
  })

  it('isOcrStructuredFieldType validates correctly', () => {
    expect(isOcrStructuredFieldType('text')).toBe(true)
    expect(isOcrStructuredFieldType('date')).toBe(true)
    expect(isOcrStructuredFieldType('table')).toBe(true)
    expect(isOcrStructuredFieldType('image')).toBe(false)
    expect(isOcrStructuredFieldType('')).toBe(false)
  })

  it('isOcrExtractionRunStatus validates correctly', () => {
    expect(isOcrExtractionRunStatus('pending')).toBe(true)
    expect(isOcrExtractionRunStatus('completed')).toBe(true)
    expect(isOcrExtractionRunStatus('running')).toBe(false)
    expect(isOcrExtractionRunStatus('')).toBe(false)
  })

  it('isOcrExtractionWarningCode validates correctly', () => {
    expect(isOcrExtractionWarningCode('AMBIGUOUS_DATE')).toBe(true)
    expect(isOcrExtractionWarningCode('AI_FALLBACK_USED')).toBe(true)
    expect(isOcrExtractionWarningCode('UNKNOWN_WARNING')).toBe(false)
    expect(isOcrExtractionWarningCode('')).toBe(false)
  })

  it('isOcrExtractionProvenanceKind validates correctly', () => {
    expect(isOcrExtractionProvenanceKind('deterministic')).toBe(true)
    expect(isOcrExtractionProvenanceKind('ai_assisted')).toBe(true)
    expect(isOcrExtractionProvenanceKind('ai_fallback')).toBe(true)
    expect(isOcrExtractionProvenanceKind('machine_learned')).toBe(false)
  })

  it('isOcrExtractionConfidenceLevel validates correctly', () => {
    expect(isOcrExtractionConfidenceLevel('high')).toBe(true)
    expect(isOcrExtractionConfidenceLevel('medium')).toBe(true)
    expect(isOcrExtractionConfidenceLevel('low')).toBe(true)
    expect(isOcrExtractionConfidenceLevel('unknown')).toBe(true)
    expect(isOcrExtractionConfidenceLevel('extreme')).toBe(false)
  })
})

// ─── 哈希测试 ───────────────────────────────────────────────────────────

describe('OCR structured extraction hashes', () => {
  it('computesourceSpanHash deterministically', () => {
    const text = 'Q3项目启动会议 2025年6月15日'
    const h1 = computeSourceSpanHash(text, 0, 0, 20)
    const h2 = computeSourceSpanHash(text, 0, 0, 20)
    expect(h1).toBe(h2)
    expect(typeof h1).toBe('string')
    expect(h1.length).toBe(8)
  })

  it('computeSourceSpanHash varies with different inputs', () => {
    const text = '不同的文本内容'
    const h1 = computeSourceSpanHash(text, 0, 0, 5)
    const h2 = computeSourceSpanHash(text, 0, 5, 10)
    expect(h1).not.toBe(h2)
  })

  it('computeFieldCandidateHash is deterministic', () => {
    const h1 = computeFieldCandidateHash('subject', 'meeting_info', 'Q3项目启动', {
      pageIndex: 0,
      charStart: 0,
      charEnd: 20,
    })
    const h2 = computeFieldCandidateHash('subject', 'meeting_info', 'Q3项目启动', {
      pageIndex: 0,
      charStart: 0,
      charEnd: 20,
    })
    expect(h1).toBe(h2)
  })

  it('computeFieldCandidateHash varies by fieldKey', () => {
    const h1 = computeFieldCandidateHash('subject', 'meeting_info', 'text', null)
    const h2 = computeFieldCandidateHash('date', 'meeting_info', 'text', null)
    expect(h1).not.toBe(h2)
  })

  it('computeTableRowHash is deterministic', () => {
    const h1 = computeTableRowHash('action_items', 0, ['事项1', '张工', '2025-12-31'])
    const h2 = computeTableRowHash('action_items', 0, ['事项1', '张工', '2025-12-31'])
    expect(h1).toBe(h2)
  })

  it('computeTableRowHash varies by rowIndex', () => {
    const cells = ['事项1', '张工', '2025-12-31']
    const h1 = computeTableRowHash('action_items', 0, cells)
    const h2 = computeTableRowHash('action_items', 1, cells)
    expect(h1).not.toBe(h2)
  })

  it('computeStructuredExtractionPreviewHash is deterministic', () => {
    const h1 = computeStructuredExtractionPreviewHash('src_hash', 1, 1, ['fh1', 'fh2'], ['th1'])
    const h2 = computeStructuredExtractionPreviewHash('src_hash', 1, 1, ['fh1', 'fh2'], ['th1'])
    expect(h1).toBe(h2)
  })

  it('computeStructuredExtractionPreviewHash is order-independent for hashes', () => {
    const h1 = computeStructuredExtractionPreviewHash('src_hash', 1, 1, ['fh2', 'fh1'], ['th1'])
    const h2 = computeStructuredExtractionPreviewHash('src_hash', 1, 1, ['fh1', 'fh2'], ['th1'])
    // 排序后应该相同
    expect(h1).toBe(h2)
  })

  it('computeStructuredExtractionSnapshotHash is deterministic', () => {
    const h1 = computeStructuredExtractionSnapshotHash(1, 'src_hash', 1, 1, ['fh1'], ['th1'])
    const h2 = computeStructuredExtractionSnapshotHash(1, 'src_hash', 1, 1, ['fh1'], ['th1'])
    expect(h1).toBe(h2)
  })

  it('computeStructuredExtractionInputSignature is deterministic', () => {
    const s1 = computeStructuredExtractionInputSignature(1, 'hash', 1, 1)
    const s2 = computeStructuredExtractionInputSignature(1, 'hash', 1, 1)
    expect(s1).toBe(s2)
  })

  it('computeStructuredExtractionInputSignature changes with different inputs', () => {
    const s1 = computeStructuredExtractionInputSignature(1, 'hashA', 1, 1)
    const s2 = computeStructuredExtractionInputSignature(1, 'hashB', 1, 1)
    expect(s1).not.toBe(s2)
  })

  it('normalizeStructuredExtractionIdempotencyKey trims and lowercases', () => {
    expect(normalizeStructuredExtractionIdempotencyKey('  KEY-123  ')).toBe('key-123')
    expect(normalizeStructuredExtractionIdempotencyKey('UPPERCASE')).toBe('uppercase')
  })

  it('stableJson produces deterministic output', () => {
    const obj = { b: 2, a: 1, c: [3, 2, 1] }
    const j1 = stableJson(obj)
    const j2 = stableJson(obj)
    expect(j1).toBe(j2)
    // 应该按 key 排序
    expect(j1).toContain('"a"')
    expect(j1.indexOf('"a"')).toBeLessThan(j1.indexOf('"b"'))
  })
})

// ─── Profile 验证测试 ──────────────────────────────────────────────────

describe('validateOcrExtractionProfileSchema', () => {
  it('accepts a valid meeting minutes schema', () => {
    const schema = buildMeetingMinutesProfileSchema()
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('accepts a valid action items schema', () => {
    const schema = buildActionItemsProfileSchema()
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(true)
  })

  it('accepts a valid milestone list schema', () => {
    const schema = buildMilestoneListProfileSchema()
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(true)
  })

  it('accepts a valid risk register schema', () => {
    const schema = buildRiskRegisterProfileSchema()
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(true)
  })

  it('accepts a valid requirement sheet schema', () => {
    const schema = buildRequirementSheetProfileSchema()
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(true)
  })

  it('rejects schema without forbidExternalUrls', () => {
    const schema = buildMeetingMinutesProfileSchema()
    schema.validationRules.forbidExternalUrls = false as any
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('forbidExternalUrls'))).toBe(true)
  })

  it('rejects schema without forbidArbitraryCode', () => {
    const schema = buildMeetingMinutesProfileSchema()
    schema.validationRules.forbidArbitraryCode = false as any
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('forbidArbitraryCode'))).toBe(true)
  })

  it('rejects schema without forbidDownstreamWrites', () => {
    const schema = buildMeetingMinutesProfileSchema()
    schema.validationRules.forbidDownstreamWrites = false as any
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('forbidDownstreamWrites'))).toBe(true)
  })

  it('rejects schema with external URL in field pattern', () => {
    const schema = buildMeetingMinutesProfileSchema()
    schema.sections[0].fields.push({
      key: 'ext_link',
      label: '外部链接',
      fieldType: 'project_ref',
      required: false,
      pattern: 'https://evil.com/api',
    })
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('external URL'))).toBe(true)
  })

  it('rejects schema with unknown field type', () => {
    const schema = buildMeetingMinutesProfileSchema()
    schema.sections[0].fields.push({
      key: 'bad_field',
      label: '坏字段',
      fieldType: 'binary' as any,
      required: false,
    })
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('unknown field type'))).toBe(true)
  })

  it('rejects schema with unsafe enum value', () => {
    const schema = buildMeetingMinutesProfileSchema()
    schema.sections[0].fields[0].enumValues = ['<script>alert("xss")</script>']
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('unsafe content'))).toBe(true)
  })

  it('rejects table with excessive maxRows', () => {
    const schema = buildActionItemsProfileSchema()
    schema.tables[0].maxRows = 20000
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('maxRows'))).toBe(true)
  })

  it('rejects duplicate field keys', () => {
    const schema = buildMeetingMinutesProfileSchema()
    // 添加重复的 field key
    schema.sections[0].fields.push({
      key: 'subject',
      label: '重复主题',
      fieldType: 'text',
      required: false,
    })
    const result = validateOcrExtractionProfileSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('duplicate field key'))).toBe(true)
  })
})

// ─── 生命周期守卫测试 ──────────────────────────────────────────────────

describe('lifecycle guards', () => {
  it('isAcceptedExtractionEligible returns true for eligible extraction', () => {
    expect(
      isAcceptedExtractionEligible({
        status: 'current',
        isExpired: false,
        isPurged: false,
        isHeld: false,
      }),
    ).toBe(true)
  })

  it('isAcceptedExtractionEligible returns false for superseded', () => {
    expect(
      isAcceptedExtractionEligible({
        status: 'superseded',
        isExpired: false,
        isPurged: false,
        isHeld: false,
      }),
    ).toBe(false)
  })

  it('isAcceptedExtractionEligible returns false for expired', () => {
    expect(
      isAcceptedExtractionEligible({
        status: 'current',
        isExpired: true,
        isPurged: false,
        isHeld: false,
      }),
    ).toBe(false)
  })

  it('isAcceptedExtractionEligible returns false for held', () => {
    expect(
      isAcceptedExtractionEligible({
        status: 'current',
        isExpired: false,
        isPurged: false,
        isHeld: true,
      }),
    ).toBe(false)
  })

  it('isStructuredExtractionSourceVisible requires same org and project', () => {
    expect(
      isStructuredExtractionSourceVisible({
        sameOrganization: true,
        sameProject: true,
        hasViewPermission: true,
      }),
    ).toBe(true)

    expect(
      isStructuredExtractionSourceVisible({
        sameOrganization: false,
        sameProject: true,
        hasViewPermission: true,
      }),
    ).toBe(false)

    expect(
      isStructuredExtractionSourceVisible({
        sameOrganization: true,
        sameProject: true,
        hasViewPermission: false,
      }),
    ).toBe(false)
  })
})

// ─── Confidence 测试 ─────────────────────────────────────────────────────

describe('confidence helpers', () => {
  it('resolveConfidenceLevel maps scores correctly', () => {
    expect(resolveConfidenceLevel(0.95)).toBe('high')
    expect(resolveConfidenceLevel(0.8)).toBe('high')
    expect(resolveConfidenceLevel(0.75)).toBe('medium')
    expect(resolveConfidenceLevel(0.5)).toBe('medium')
    expect(resolveConfidenceLevel(0.3)).toBe('low')
    expect(resolveConfidenceLevel(0.1)).toBe('low')
    expect(resolveConfidenceLevel(0.05)).toBe('unknown')
    expect(resolveConfidenceLevel(0)).toBe('unknown')
  })

  it('aggregateExtractionWarningSummary counts warnings and errors', () => {
    const fieldWarnings = [
      buildExtractionWarning('AMBIGUOUS_DATE', { severity: 'warn', fieldKey: 'date' }),
    ]
    const tableWarnings = [
      buildExtractionWarning('MISSING_REQUIRED_FIELD', { severity: 'error', fieldKey: 'item' }),
    ]
    const summary = aggregateExtractionWarningSummary({ fieldWarnings, tableWarnings })
    expect(summary.totalWarnings).toBe(1)
    expect(summary.totalErrors).toBe(1)
    expect(summary.topCodes).toContain('MISSING_REQUIRED_FIELD')
    expect(summary.hasBlockingErrors).toBe(true)
  })

  it('aggregateExtractionWarningSummary handles empty warnings', () => {
    const summary = aggregateExtractionWarningSummary({ fieldWarnings: [], tableWarnings: [] })
    expect(summary.totalWarnings).toBe(0)
    expect(summary.totalErrors).toBe(0)
    expect(summary.hasBlockingErrors).toBe(false)
  })
})

// ─── 红线测试 ─────────────────────────────────────────────────────────────

describe('redline summary', () => {
  it('buildStructuredExtractionRedlineSummary is deterministic and immutable', () => {
    const r1 = buildStructuredExtractionRedlineSummary()
    const r2 = buildStructuredExtractionRedlineSummary()
    expect(r1).toEqual(r2)
    expect(r1.tasks).toBe('unchanged')
    expect(r1.wbs).toBe('unchanged')
    expect(r1.risks).toBe('unchanged')
    expect(r1.milestones).toBe('unchanged')
    expect(r1.resources).toBe('unchanged')
    expect(r1.reports).toBe('unchanged')
    expect(r1.documentBody).toBe('unchanged')
    expect(r1.compilerArtifacts).toBe('unchanged')
    expect(r1.aiDrafts).toBe('unchanged')
    expect(r1.searchIndexes).toBe('unchanged')
    expect(r1.knowledgeBases).toBe('unchanged')
    expect(r1.externalSystems).toBe('unchanged')
  })
})

// ─── 脱敏测试 ───────────────────────────────────────────────────────────

describe('redaction helpers', () => {
  it('redactStructuredExtractionMetadata removes sensitive keys', () => {
    const input = {
      runId: 1,
      apiKey: 'secret-123',
      token: 'bearer-token',
      sourceHash: 'abc',
      normalField: 'safe_value',
    }
    const redacted = redactStructuredExtractionMetadata(input) as any
    expect(redacted.apiKey).toBe('[REDACTED]')
    expect(redacted.token).toBe('[REDACTED]')
    expect(redacted.sourceHash).toBe('abc')
    expect(redacted.normalField).toBe('safe_value')
    expect(redacted.runId).toBe(1)
  })

  it('redactStructuredExtractionMetadata handles arrays', () => {
    const input = [{ apiKey: 's1' }, { token: 's2' }]
    const redacted = redactStructuredExtractionMetadata(input) as any[]
    expect(redacted[0].apiKey).toBe('[REDACTED]')
    expect(redacted[1].token).toBe('[REDACTED]')
  })

  it('buildStructuredExtractionAuditMetadata builds clean metadata', () => {
    const meta = buildStructuredExtractionAuditMetadata({
      actorId: 1,
      organizationId: 2,
      projectId: 3,
      action: 'OCR_STRUCTURED_RUN_CREATED',
      runId: 10,
      profileId: 5,
      sourceHash: 'hash123',
    })
    expect(meta.actor).toBe(1)
    expect(meta.org).toBe(2)
    expect(meta.project).toBe(3)
    expect(meta.action).toBe('OCR_STRUCTURED_RUN_CREATED')
    expect(meta.runId).toBe(10)
    expect(meta.sourceHash).toBe('hash123')
    // 不应该包含全量文本
    expect(meta.selectedText).toBeUndefined()
    expect(meta.fullText).toBeUndefined()
  })
})

// ─── 允许动作测试 ─────────────────────────────────────────────────────────

describe('resolveStructuredExtractionActions', () => {
  it('returns view+review for complete run with view permission', () => {
    const actions = resolveStructuredExtractionActions({
      canView: true,
      canManage: false,
      canRun: false,
      canConfirm: false,
      isStale: false,
      isComplete: true,
      hasCandidates: true,
      hasConfirmedSnapshots: false,
    })
    expect(actions).toContain('view')
    expect(actions).toContain('review')
    expect(actions).not.toContain('confirm')
  })

  it('returns confirm actions when canConfirm and not stale', () => {
    const actions = resolveStructuredExtractionActions({
      canView: true,
      canManage: false,
      canRun: false,
      canConfirm: true,
      isStale: false,
      isComplete: true,
      hasCandidates: true,
      hasConfirmedSnapshots: false,
    })
    expect(actions).toContain('preview_confirm')
    expect(actions).toContain('confirm')
  })

  it('blocks confirm when stale', () => {
    const actions = resolveStructuredExtractionActions({
      canView: true,
      canManage: false,
      canRun: false,
      canConfirm: true,
      isStale: true,
      isComplete: true,
      hasCandidates: true,
      hasConfirmedSnapshots: false,
    })
    expect(actions).not.toContain('preview_confirm')
    expect(actions).not.toContain('confirm')
  })

  it('includes supersede when has confirmed snapshots', () => {
    const actions = resolveStructuredExtractionActions({
      canView: true,
      canManage: false,
      canRun: false,
      canConfirm: true,
      isStale: false,
      isComplete: true,
      hasCandidates: true,
      hasConfirmedSnapshots: true,
    })
    expect(actions).toContain('supersede')
  })

  it('includes cancel for canManage', () => {
    const actions = resolveStructuredExtractionActions({
      canView: true,
      canManage: true,
      canRun: false,
      canConfirm: false,
      isStale: false,
      isComplete: false,
      hasCandidates: false,
      hasConfirmedSnapshots: false,
    })
    expect(actions).toContain('cancel')
  })

  it('returns empty for no permissions', () => {
    const actions = resolveStructuredExtractionActions({
      canView: false,
      canManage: false,
      canRun: false,
      canConfirm: false,
      isStale: false,
      isComplete: true,
      hasCandidates: true,
      hasConfirmedSnapshots: false,
    })
    expect(actions).toHaveLength(0)
  })
})

// ─── 排序测试 ─────────────────────────────────────────────────────────────

describe('sorting helpers', () => {
  it('sortFieldCandidates sorts by section then field', () => {
    const candidates = [
      buildFieldCandidate({ sectionKey: 'b', fieldKey: 'z' }),
      buildFieldCandidate({ sectionKey: 'a', fieldKey: 'y' }),
      buildFieldCandidate({ sectionKey: 'a', fieldKey: 'x' }),
      buildFieldCandidate({ sectionKey: 'b', fieldKey: 'a' }),
    ]
    const sorted = sortFieldCandidates(candidates)
    expect(sorted[0].sectionKey).toBe('a')
    expect(sorted[0].fieldKey).toBe('x')
    expect(sorted[1].sectionKey).toBe('a')
    expect(sorted[1].fieldKey).toBe('y')
    expect(sorted[2].sectionKey).toBe('b')
    expect(sorted[2].fieldKey).toBe('a')
    expect(sorted[3].sectionKey).toBe('b')
    expect(sorted[3].fieldKey).toBe('z')
  })

  it('sortTableRows sorts by rowIndex', () => {
    const rows = [buildTableRowCandidate(3), buildTableRowCandidate(1), buildTableRowCandidate(2)]
    const sorted = sortTableRows(rows)
    expect(sorted[0].rowIndex).toBe(1)
    expect(sorted[1].rowIndex).toBe(2)
    expect(sorted[2].rowIndex).toBe(3)
  })
})

// ─── 输入文本 fixture 测试 ──────────────────────────────────────────────

describe('accepted extraction text fixtures', () => {
  it('meetingMinutesAcceptedText contains expected content', () => {
    const text = meetingMinutesAcceptedText()
    expect(text).toContain('Q3项目启动会议')
    expect(text).toContain('2025年6月15日')
    expect(text).toContain('张经理')
    expect(text).toContain('决议事项')
  })

  it('actionItemsAcceptedText contains expected table', () => {
    const text = actionItemsAcceptedText()
    expect(text).toContain('前端UI重构')
    expect(text).toContain('张工')
    expect(text).toContain('进行中')
  })

  it('milestoneListAcceptedText contains milestones', () => {
    const text = milestoneListAcceptedText()
    expect(text).toContain('开项Kaiplan V3')
    expect(text).toContain('M1 - 需求评审完成')
    expect(text).toContain('M5 - GA发布')
  })

  it('riskRegisterAcceptedText contains risks', () => {
    const text = riskRegisterAcceptedText()
    expect(text).toContain('关键技术栈不成熟')
    expect(text).toContain('第三方API不稳定')
    expect(text).toContain('缓解措施')
  })

  it('requirementSheetAcceptedText contains requirements', () => {
    const text = requirementSheetAcceptedText()
    expect(text).toContain('REQ-001')
    expect(text).toContain('OCR文档上传')
    expect(text).toContain('P0')
  })
})

// ─── 幂等性测试 ─────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('input signature is stable for same inputs', () => {
    const sig1 = computeStructuredExtractionInputSignature(1, 'hash', 2, 3, {
      maxFieldCandidates: 100,
      maxTableRows: 500,
    })
    const sig2 = computeStructuredExtractionInputSignature(1, 'hash', 2, 3, {
      maxFieldCandidates: 100,
      maxTableRows: 500,
    })
    expect(sig1).toBe(sig2)
  })

  it('input signature changes with different options', () => {
    const sig1 = computeStructuredExtractionInputSignature(1, 'hash', 2, 3, {
      maxFieldCandidates: 100,
    })
    const sig2 = computeStructuredExtractionInputSignature(1, 'hash', 2, 3, {
      maxFieldCandidates: 200,
    })
    expect(sig1).not.toBe(sig2)
  })

  it('preview hash is stable and order-independent', () => {
    const h1 = computeStructuredExtractionPreviewHash('src', 1, 1, ['a', 'b'], ['c'])
    const h2 = computeStructuredExtractionPreviewHash('src', 1, 1, ['b', 'a'], ['c'])
    expect(h1).toBe(h2)
  })
})

// ─── Profile summary fixture 测试 ───────────────────────────────────────

describe('profile summary fixtures', () => {
  it('buildProfileSummary returns valid profile', () => {
    const p = buildProfileSummary()
    expect(p.profileId).toBe(1)
    expect(p.scope).toBe('builtin')
    expect(p.status).toBe('active')
    expect(isOcrExtractionProfileStatus(p.status)).toBe(true)
    expect(isOcrExtractionProfileScope(p.scope)).toBe(true)
  })

  it('buildProfileDetail includes schema definition', () => {
    const d = buildProfileDetail()
    expect(d.schemaDefinition.schemaKey).toBe('meeting-minutes')
    expect(d.versionHistory).toHaveLength(1)
  })
})

// ─── Run fixture 测试 ───────────────────────────────────────────────────

describe('run fixtures', () => {
  it('buildRunSummary has correct defaults', () => {
    const r = buildRunSummary()
    expect(r.status).toBe('completed')
    expect(r.provenance).toBe('deterministic')
    expect(r.allowedActions).toContain('view')
  })

  it('buildRunDetail includes candidates', () => {
    const d = buildRunDetail()
    expect(d.fieldCandidates.length).toBeGreaterThan(0)
    expect(d.tableCandidates.length).toBeGreaterThan(0)
    expect(d.warningSummary.hasBlockingErrors).toBe(false)
  })
})

// ─── Snapshot fixture 测试 ──────────────────────────────────────────────

describe('snapshot fixtures', () => {
  it('buildSnapshotSummary has correct defaults', () => {
    const s = buildSnapshotSummary()
    expect(s.status).toBe('current')
    expect(s.fieldCount).toBe(2)
    expect(s.tableCount).toBe(1)
  })
})

// ─── Preview fixture 测试 ───────────────────────────────────────────────

describe('preview fixtures', () => {
  it('buildPreviewResponse requires explicit confirmation', () => {
    const p = buildPreviewResponse()
    expect(p.requiresExplicitConfirmation).toBe(true)
    expect(p.snapshot.fieldValues).toBeDefined()
    expect(p.snapshot.tableValues).toBeDefined()
    expect(p.redlineSummary.tasks).toBe('unchanged')
  })
})

// ─── 性能 fixtures 测试（§7.1）─────────────────────────────────────────

describe('performance fixtures', () => {
  it('largeAcceptedText generates significant content', () => {
    const text = largeAcceptedText()
    expect(text.length).toBeGreaterThan(1000)
    expect(text).toContain('第1次会议纪要')
    expect(text).toContain('第50次会议纪要')
  })

  it('largeTableAcceptedText generates 100+ rows', () => {
    const text = largeTableAcceptedText()
    const lines = text.split('\n')
    // header (1) + separator (1) + 100 data rows
    expect(lines.length).toBeGreaterThanOrEqual(102)
    expect(text).toContain('事项1')
    expect(text).toContain('事项100')
  })
})

// ─── 低敏导出 helper 测试（§7.6）──────────────────────────────────────

describe('low-sensitive export summary', () => {
  it('export summary contains only safe metadata', async () => {
    const { buildLowSensitiveExportSummary } =
      await import('../src/ocr-structured-extraction-fixtures.js')
    const summary = buildLowSensitiveExportSummary({
      snapshotId: 1,
      profileName: '会议纪要',
      profileVersion: 1,
      sourceHash: 'abc123',
      snapshotHash: 'def456',
      fieldCount: 5,
      tableCount: 1,
      confirmedAt: '2025-06-15T10:00:00Z',
      fieldKeys: ['subject', 'date'],
      tableKeys: ['action_items'],
    })
    expect(summary.snapshotId).toBe(1)
    expect(summary.sourceHash).toBe('abc123')
    expect(summary.fieldKeys).toContain('subject')
    // 不应包含全量文本
    expect(summary).not.toHaveProperty('fullText')
    expect(summary).not.toHaveProperty('selectedText')
    expect(summary).not.toHaveProperty('ocrRawBody')
  })
})
