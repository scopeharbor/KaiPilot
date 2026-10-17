/**
 * V3 OCR Entity Linking — Fixture Builders
 *
 * 为 OCR 实体链接测试提供稳定的 fixture 数据构建器。
 * 所有 builder 返回可序列化的纯对象，不依赖数据库或外部服务。
 */

import type {
  OcrEntityLinkCandidate,
  OcrEntityLinkConfirmedLink,
  OcrEntityLinkPreview,
  OcrEntityLinkRunSummary,
  OcrEntityLinkSourceExtractionRef,
  OcrEntityLinkTargetSuggestion,
  OcrEntityLinkTargetSummary,
  OcrEntityLinkAdvisoryPayload,
  OcrEntityLinkStaleSummary,
  OcrEntityLinkWarning,
  OcrEntityLinkSpanOffset,
  OcrEntityLinkWarningCode,
} from './ocr-entity-linking.js'

import { computeCandidateKey, computePreviewHash } from './ocr-entity-linking.js'

// ─── Span 偏移 ──────────────────────────────────────────────────────────────

export function buildSpanOffset(
  overrides?: Partial<OcrEntityLinkSpanOffset>,
): OcrEntityLinkSpanOffset {
  return { start: 10, end: 25, ...overrides }
}

// ─── 来源提取引用 ──────────────────────────────────────────────────────────

export function buildSourceExtractionRef(
  overrides?: Partial<OcrEntityLinkSourceExtractionRef>,
): OcrEntityLinkSourceExtractionRef {
  return {
    extractionId: 1,
    sourceHash: 'abc123source',
    selectedTextHash: 'def456selected',
    pageRefs: [0],
    status: 'current',
    confirmedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

// ─── 目标建议 ──────────────────────────────────────────────────────────────

export function buildTargetSuggestion(
  overrides?: Partial<OcrEntityLinkTargetSuggestion>,
): OcrEntityLinkTargetSuggestion {
  return {
    targetKind: 'task',
    targetId: 42,
    title: '测试任务 A',
    matchReason: 'exact_label',
    confidence: 0.95,
    navigationRef: '/projects/1/tasks/42',
    redacted: false,
    ...overrides,
  }
}

// ─── 目标摘要 ──────────────────────────────────────────────────────────────

export function buildTargetSummary(
  overrides?: Partial<OcrEntityLinkTargetSummary>,
): OcrEntityLinkTargetSummary {
  return {
    targetKind: 'task',
    targetId: 42,
    title: '测试任务 A',
    isAccessible: true,
    isActive: true,
    matchableLabel: '测试任务 A',
    ...overrides,
  }
}

// ─── 警告 ──────────────────────────────────────────────────────────────────

export function buildWarning(
  code: OcrEntityLinkWarningCode = 'LOW_CONFIDENCE',
  overrides?: Partial<OcrEntityLinkWarning>,
): OcrEntityLinkWarning {
  return { code, message: `警告: ${code}`, severity: 'warn', ...overrides }
}

// ─── 陈旧摘要 ──────────────────────────────────────────────────────────────

export function buildStaleSummary(
  overrides?: Partial<OcrEntityLinkStaleSummary>,
): OcrEntityLinkStaleSummary {
  return {
    isStale: false,
    staleReason: null,
    staleSince: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

// ─── 候选 ──────────────────────────────────────────────────────────────────

export function buildCandidate(
  overrides?: Partial<OcrEntityLinkCandidate>,
): OcrEntityLinkCandidate {
  const extractionId = overrides?.extractionId ?? 1
  const pageRefs = overrides?.pageRefs ?? [0]
  const spanOffset = overrides?.spanOffset ?? buildSpanOffset()
  const mentionType = overrides?.mentionType ?? 'task_ref'
  const normalizedLabel = overrides?.normalizedLabel ?? '测试任务 A'

  const candidateKey =
    overrides?.candidateKey ??
    computeCandidateKey(extractionId, pageRefs, spanOffset, mentionType, normalizedLabel)

  return {
    candidateId: 1,
    runId: 1,
    extractionId,
    pageRefs,
    spanOffset,
    mentionType,
    normalizedLabel,
    selectedTextHash: 'def456selected',
    spanHash: 'spanhash001',
    confidence: 0.95,
    status: 'matched',
    targetSuggestion: buildTargetSuggestion(),
    warnings: [],
    candidateKey,
    ...overrides,
  }
}

/** 创建一条 unmatched 候选 */
export function buildUnmatchedCandidate(
  overrides?: Partial<OcrEntityLinkCandidate>,
): OcrEntityLinkCandidate {
  return buildCandidate({
    candidateId: 2,
    mentionType: 'person_name',
    normalizedLabel: '张三',
    confidence: 0.6,
    status: 'unmatched',
    targetSuggestion: null,
    warnings: ['TARGET_NOT_FOUND'],
    ...overrides,
  })
}

// ─── 运行摘要 ──────────────────────────────────────────────────────────────

export function buildRunSummary(
  overrides?: Partial<OcrEntityLinkRunSummary>,
): OcrEntityLinkRunSummary {
  return {
    runId: 1,
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    inputSignature: 'inputsig001',
    ruleVersion: '1.0.0',
    status: 'completed',
    candidateCount: 5,
    confirmedCount: 2,
    staleSummary: null,
    createdAt: '2026-08-01T10:30:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

// ─── Advisory Payload ──────────────────────────────────────────────────────

export function buildAdvisoryPayload(
  overrides?: Partial<OcrEntityLinkAdvisoryPayload>,
): OcrEntityLinkAdvisoryPayload {
  const payload: OcrEntityLinkAdvisoryPayload = {
    organizationId: 1,
    projectId: 1,
    extractionId: 1,
    sourceHash: 'abc123source',
    selectedTextHash: 'def456selected',
    spanHash: 'spanhash001',
    targetKind: 'task',
    targetId: 42,
    normalizedLabel: '测试任务 A',
    confidence: 0.95,
    matchReason: 'exact_label',
    ...overrides,
  }
  return payload
}

// ─── 确认预览 ──────────────────────────────────────────────────────────────

export function buildPreview(overrides?: Partial<OcrEntityLinkPreview>): OcrEntityLinkPreview {
  const payload = overrides?.advisoryLinkPayload ?? buildAdvisoryPayload()
  const previewHash = overrides?.previewHash ?? computePreviewHash(payload)
  return {
    runId: 1,
    candidateId: 1,
    sourceSpan: {
      extractionId: 1,
      sourceHash: 'abc123source',
      selectedTextHash: 'def456selected',
      spanHash: 'spanhash001',
      pageRefs: [0],
      spanOffset: buildSpanOffset(),
    },
    target: buildTargetSuggestion(),
    confidence: 0.95,
    warnings: [],
    advisoryLinkPayload: payload,
    previewHash,
    requiresUserConfirmation: true,
    redlineSummary: {
      taskFields: false,
      wbsFields: false,
      riskFields: false,
      milestoneFields: false,
      fileBytes: false,
      documentBody: false,
      searchIndexes: false,
      knowledgeBases: false,
      compilerArtifacts: false,
      aiDrafts: false,
      externalSystems: false,
    },
    ...overrides,
  }
}

// ─── 已确认 Advisory Link ──────────────────────────────────────────────────

export function buildConfirmedLink(
  overrides?: Partial<OcrEntityLinkConfirmedLink>,
): OcrEntityLinkConfirmedLink {
  return {
    linkId: 1,
    runId: 1,
    organizationId: 1,
    projectId: 1,
    extractionId: 1,
    sourceHash: 'abc123source',
    selectedTextHash: 'def456selected',
    spanHash: 'spanhash001',
    targetKind: 'task',
    targetId: 42,
    normalizedLabel: '测试任务 A',
    confidence: 0.95,
    matchReason: 'exact_label',
    reviewerId: 1,
    lifecycleStatus: 'active',
    confirmationHash: 'confirmhash001',
    supersededById: null,
    confirmedAt: '2026-08-01T11:00:00.000Z',
    auditRef: 'audit-ref-001',
    ...overrides,
  }
}

// ─── 文本输入（用于规则引擎测试） ──────────────────────────────────────────

/** 标准接受提取文本（含多种实体提及） */
export function fixtureAcceptedTextSmall(): string {
  return [
    '项目进度报告 - 2026年8月',
    '任务 TASK-001: 完成前端开发，负责人张三，截止2026-08-15',
    '里程碑 M1: 原型评审通过',
    'WBS 1.2.3: 数据库设计，预算 ¥50,000',
    '风险 R-004: 人员短缺可能导致延期',
    '附件: 需求规格说明书 v2.1.pdf',
  ].join('\n')
}

/** 长文本（用于边界测试） */
export function fixtureAcceptedTextLarge(): string {
  const lines: string[] = []
  for (let i = 0; i < 200; i++) {
    lines.push(
      `Section ${i + 1}: 任务 TASK-${String(i + 100).padStart(3, '0')} - ` +
        `完成模块 ${String.fromCharCode(65 + (i % 26))} 的开发工作，` +
        `负责人${['张三', '李四', '王五', '赵六'][i % 4]}，` +
        `预算 ¥${(Math.random() * 100000).toFixed(0)}，` +
        `截止日期 2026-${String(8 + (i % 5)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    )
  }
  return lines.join('\n')
}

// ─── 多候选集合 ────────────────────────────────────────────────────────────

/** 生成多类型候选的示例数组 */
export function fixtureCandidateSet(runId = 1): OcrEntityLinkCandidate[] {
  const base = {
    runId,
    extractionId: 1,
    pageRefs: [0],
    spanOffset: buildSpanOffset(),
  }
  return [
    buildCandidate({
      ...base,
      candidateId: 1,
      mentionType: 'task_ref',
      normalizedLabel: 'TASK-001',
    }),
    buildCandidate({
      ...base,
      candidateId: 2,
      mentionType: 'milestone_ref',
      normalizedLabel: 'M1',
    }),
    buildCandidate({ ...base, candidateId: 3, mentionType: 'wbs_ref', normalizedLabel: '1.2.3' }),
    buildCandidate({ ...base, candidateId: 4, mentionType: 'risk_ref', normalizedLabel: 'R-004' }),
    buildCandidate({
      ...base,
      candidateId: 5,
      mentionType: 'person_name',
      normalizedLabel: '张三',
      status: 'unmatched',
      targetSuggestion: null,
      confidence: 0.6,
    }),
    buildCandidate({
      ...base,
      candidateId: 6,
      mentionType: 'amount_expression',
      normalizedLabel: '¥50,000',
      status: 'unmatched',
      targetSuggestion: null,
      confidence: 0.8,
    }),
    buildCandidate({
      ...base,
      candidateId: 7,
      mentionType: 'file_ref',
      normalizedLabel: '需求规格说明书 v2.1.pdf',
      status: 'unmatched',
      targetSuggestion: null,
      confidence: 0.7,
    }),
    buildCandidate({
      ...base,
      candidateId: 8,
      mentionType: 'date_expression',
      normalizedLabel: '2026-08-15',
    }),
  ]
}
