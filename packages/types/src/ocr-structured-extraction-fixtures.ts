/**
 * V3 OCR Structured Extraction — Fixture Builders
 *
 * 为测试提供确定性、可复用的 profile、accepted extraction 输入、
 * field/table 候选、preview payload 和 snapshot fixture。
 */

import type {
  OcrExtractionProfileSchema,
  OcrExtractionProfileSummary,
  OcrExtractionProfileDetail,
  OcrExtractionRunSummary,
  OcrExtractionRunDetail,
  OcrFieldCandidate,
  OcrTableCandidate,
  OcrTableRowCandidate,
  OcrTypedTableCellValue,
  OcrTypedTextValue,
  OcrTypedDateValue,
  OcrTypedNumberValue,
  OcrTypedEnumValue,
  OcrTypedPersonNameValue,
  OcrTypedProjectRefValue,
  OcrSourceSpanRef,
  OcrExtractionSourceSummary,
  OcrStructuredExtractionPreviewResponse,
  OcrStructuredSnapshotSummary,
  OcrExtractionWarning,
  OcrExtractionWarningSummary,
  OcrStructuredExtractionRedlineSummary,
} from './ocr-structured-extraction.js'

// ─── 简单 fixture builders ────────────────────────────────────────────────

export function buildSourceSpanRef(overrides?: Partial<OcrSourceSpanRef>): OcrSourceSpanRef {
  return { pageIndex: 0, charStart: 0, charEnd: 50, ...overrides }
}

export function buildTypedTextValue(
  raw: string,
  overrides?: Partial<OcrTypedTextValue>,
): OcrTypedTextValue {
  return {
    kind: 'text',
    raw,
    normalized: raw.trim(),
    ...overrides,
  }
}

export function buildTypedDateValue(
  raw: string,
  overrides?: Partial<OcrTypedDateValue>,
): OcrTypedDateValue {
  return {
    kind: 'date',
    raw,
    normalized: '2025-06-15',
    parsed: { year: 2025, month: 6, day: 15 },
    ...overrides,
  }
}

export function buildTypedNumberValue(
  raw: string,
  overrides?: Partial<OcrTypedNumberValue>,
): OcrTypedNumberValue {
  return {
    kind: 'number',
    raw,
    normalized: Number(raw),
    ...overrides,
  }
}

export function buildTypedEnumValue(
  raw: string,
  matchedValue: string | null,
  overrides?: Partial<OcrTypedEnumValue>,
): OcrTypedEnumValue {
  return { kind: 'enum', raw, normalized: raw.trim(), matchedValue, ...overrides }
}

export function buildTypedPersonNameValue(
  raw: string,
  overrides?: Partial<OcrTypedPersonNameValue>,
): OcrTypedPersonNameValue {
  return {
    kind: 'person_name',
    raw,
    normalized: raw.trim(),
    matchType: 'none',
    ...overrides,
  }
}

export function buildTypedProjectRefValue(
  raw: string,
  overrides?: Partial<OcrTypedProjectRefValue>,
): OcrTypedProjectRefValue {
  return {
    kind: 'project_ref',
    raw,
    normalized: raw.trim(),
    matchedProjectId: null,
    matchType: 'none',
    ...overrides,
  }
}

export function buildTableCellValue(
  fieldKey: string,
  raw: string,
  overrides?: Partial<OcrTypedTableCellValue>,
): OcrTypedTableCellValue {
  return {
    fieldKey,
    fieldType: 'text',
    raw,
    value: buildTypedTextValue(raw),
    spanRef: null,
    ...overrides,
  }
}

export function buildExtractionWarning(
  code: string,
  overrides?: Partial<OcrExtractionWarning>,
): OcrExtractionWarning {
  return {
    code: code as OcrExtractionWarning['code'],
    message: `Warning: ${code}`,
    severity: 'warn',
    ...overrides,
  }
}

export function buildEmptyWarningSummary(): OcrExtractionWarningSummary {
  return {
    totalWarnings: 0,
    totalErrors: 0,
    topCodes: [],
    topFields: [],
    hasBlockingErrors: false,
  }
}

export function buildRedlineSummary(): OcrStructuredExtractionRedlineSummary {
  return {
    tasks: 'unchanged',
    wbs: 'unchanged',
    risks: 'unchanged',
    milestones: 'unchanged',
    resources: 'unchanged',
    reports: 'unchanged',
    documentBody: 'unchanged',
    compilerArtifacts: 'unchanged',
    aiDrafts: 'unchanged',
    searchIndexes: 'unchanged',
    knowledgeBases: 'unchanged',
    externalSystems: 'unchanged',
  }
}

// ─── Profile Schema Fixtures ──────────────────────────────────────────────

export function buildMeetingMinutesProfileSchema(): OcrExtractionProfileSchema {
  return {
    schemaKey: 'meeting-minutes',
    version: 1,
    label: '会议纪要',
    description: '提取会议纪要中的结构化字段：主题、日期、参会人、决议',
    sections: [
      {
        key: 'meeting_info',
        label: '会议信息',
        fields: [
          { key: 'subject', label: '会议主题', fieldType: 'text', required: true },
          { key: 'date', label: '会议日期', fieldType: 'date', required: true },
          { key: 'location', label: '会议地点', fieldType: 'text', required: false },
          { key: 'organizer', label: '组织者', fieldType: 'person_name', required: false },
        ],
        optional: false,
        repeatable: false,
      },
      {
        key: 'attendees',
        label: '参会人员',
        fields: [
          { key: 'name', label: '姓名', fieldType: 'person_name', required: true },
          {
            key: 'role',
            label: '角色',
            fieldType: 'enum',
            required: false,
            enumValues: ['主持人', '记录人', '参会人', '旁听'],
          },
        ],
        optional: true,
        repeatable: true,
        hint: '可重复的参会人员列表',
      },
      {
        key: 'decisions',
        label: '决议事项',
        fields: [
          { key: 'description', label: '决议内容', fieldType: 'text', required: true },
          { key: 'owner', label: '负责人', fieldType: 'person_name', required: false },
          { key: 'deadline', label: '截止日期', fieldType: 'date', required: false },
        ],
        optional: true,
        repeatable: true,
        hint: '会议决议事项',
      },
    ],
    tables: [],
    validationRules: {
      maxFieldsPerRun: 200,
      maxTableRowsPerRun: 500,
      maxTotalCandidates: 500,
      forbidExternalUrls: true,
      forbidArbitraryCode: true,
      forbidDownstreamWrites: true,
    },
    redactionHints: { fields: [], patterns: [] },
  }
}

export function buildActionItemsProfileSchema(): OcrExtractionProfileSchema {
  return {
    schemaKey: 'action-items',
    version: 1,
    label: '行动事项表',
    description: '提取行动事项表格：事项、负责人、截止日期、状态',
    sections: [],
    tables: [
      {
        key: 'action_items',
        label: '行动事项',
        columns: [
          { key: 'item', label: '事项', fieldType: 'text', required: true },
          { key: 'owner', label: '负责人', fieldType: 'person_name', required: true },
          { key: 'deadline', label: '截止日期', fieldType: 'date', required: true },
          {
            key: 'status',
            label: '状态',
            fieldType: 'enum',
            required: false,
            enumValues: ['未开始', '进行中', '已完成', '已取消'],
          },
          { key: 'notes', label: '备注', fieldType: 'text', required: false },
        ],
        maxRows: 200,
        maxCellsPerRow: 100,
        allowExtraColumns: false,
      },
    ],
    validationRules: {
      maxFieldsPerRun: 50,
      maxTableRowsPerRun: 1000,
      maxTotalCandidates: 1000,
      forbidExternalUrls: true,
      forbidArbitraryCode: true,
      forbidDownstreamWrites: true,
    },
    redactionHints: { fields: [], patterns: [] },
  }
}

export function buildMilestoneListProfileSchema(): OcrExtractionProfileSchema {
  return {
    schemaKey: 'milestone-list',
    version: 1,
    label: '里程碑清单',
    description: '提取里程碑清单：名称、日期、状态',
    sections: [
      {
        key: 'project_info',
        label: '项目信息',
        fields: [{ key: 'project_name', label: '项目名称', fieldType: 'text', required: true }],
        optional: false,
        repeatable: false,
      },
    ],
    tables: [
      {
        key: 'milestones',
        label: '里程碑',
        columns: [
          { key: 'name', label: '里程碑名称', fieldType: 'text', required: true },
          { key: 'date', label: '计划日期', fieldType: 'date', required: true },
          {
            key: 'status',
            label: '状态',
            fieldType: 'enum',
            required: false,
            enumValues: ['未开始', '进行中', '已完成', '延迟'],
          },
          { key: 'owner', label: '负责人', fieldType: 'person_name', required: false },
        ],
        maxRows: 100,
        maxCellsPerRow: 100,
        allowExtraColumns: false,
      },
    ],
    validationRules: {
      maxFieldsPerRun: 50,
      maxTableRowsPerRun: 500,
      maxTotalCandidates: 500,
      forbidExternalUrls: true,
      forbidArbitraryCode: true,
      forbidDownstreamWrites: true,
    },
    redactionHints: { fields: [], patterns: [] },
  }
}

export function buildRiskRegisterProfileSchema(): OcrExtractionProfileSchema {
  return {
    schemaKey: 'risk-register',
    version: 1,
    label: '风险登记册',
    description: '提取风险登记册表格：风险描述、概率、影响、等级、缓解措施',
    sections: [],
    tables: [
      {
        key: 'risks',
        label: '风险',
        columns: [
          { key: 'description', label: '风险描述', fieldType: 'text', required: true },
          {
            key: 'probability',
            label: '概率',
            fieldType: 'enum',
            required: false,
            enumValues: ['高', '中', '低'],
          },
          {
            key: 'impact',
            label: '影响',
            fieldType: 'enum',
            required: false,
            enumValues: ['高', '中', '低'],
          },
          {
            key: 'level',
            label: '风险等级',
            fieldType: 'enum',
            required: false,
            enumValues: ['严重', '高', '中', '低'],
          },
          { key: 'mitigation', label: '缓解措施', fieldType: 'text', required: false },
          { key: 'owner', label: '负责人', fieldType: 'person_name', required: false },
        ],
        maxRows: 200,
        maxCellsPerRow: 100,
        allowExtraColumns: false,
      },
    ],
    validationRules: {
      maxFieldsPerRun: 50,
      maxTableRowsPerRun: 1000,
      maxTotalCandidates: 1000,
      forbidExternalUrls: true,
      forbidArbitraryCode: true,
      forbidDownstreamWrites: true,
    },
    redactionHints: { fields: [], patterns: [] },
  }
}

export function buildRequirementSheetProfileSchema(): OcrExtractionProfileSchema {
  return {
    schemaKey: 'requirement-sheet',
    version: 1,
    label: '需求清单',
    description: '提取需求清单表格：编号、标题、优先级、状态',
    sections: [],
    tables: [
      {
        key: 'requirements',
        label: '需求',
        columns: [
          { key: 'id', label: '编号', fieldType: 'text', required: true },
          { key: 'title', label: '标题', fieldType: 'text', required: true },
          {
            key: 'priority',
            label: '优先级',
            fieldType: 'enum',
            required: false,
            enumValues: ['P0', 'P1', 'P2', 'P3'],
          },
          {
            key: 'status',
            label: '状态',
            fieldType: 'enum',
            required: false,
            enumValues: ['待定', '已确认', '开发中', '已交付'],
          },
          { key: 'owner', label: '负责人', fieldType: 'person_name', required: false },
          { key: 'notes', label: '备注', fieldType: 'text', required: false },
        ],
        maxRows: 300,
        maxCellsPerRow: 100,
        allowExtraColumns: false,
      },
    ],
    validationRules: {
      maxFieldsPerRun: 50,
      maxTableRowsPerRun: 1500,
      maxTotalCandidates: 1500,
      forbidExternalUrls: true,
      forbidArbitraryCode: true,
      forbidDownstreamWrites: true,
    },
    redactionHints: { fields: [], patterns: [] },
  }
}

// ─── Profile Summary Fixtures ────────────────────────────────────────────

export function buildProfileSummary(
  overrides?: Partial<OcrExtractionProfileSummary>,
): OcrExtractionProfileSummary {
  return {
    profileId: 1,
    name: '会议纪要',
    scope: 'builtin',
    status: 'active',
    schemaKey: 'meeting-minutes',
    currentVersion: 1,
    totalRuns: 0,
    description: '提取会议纪要结构化字段',
    organizationId: 1,
    projectId: null,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    ...overrides,
  }
}

export function buildProfileDetail(
  overrides?: Partial<OcrExtractionProfileDetail>,
): OcrExtractionProfileDetail {
  return {
    ...buildProfileSummary(overrides),
    schemaDefinition: buildMeetingMinutesProfileSchema(),
    versionHistory: [
      {
        versionId: 1,
        version: 1,
        status: 'active',
        createdAt: '2025-06-01T00:00:00.000Z',
        createdBy: null,
      },
    ],
    ...overrides,
  }
}

// ─── Source Summary Fixture ──────────────────────────────────────────────

export function buildExtractionSourceSummary(
  overrides?: Partial<OcrExtractionSourceSummary>,
): OcrExtractionSourceSummary {
  return {
    extractionId: 1,
    sourceHash: 'abcd1234',
    candidateHash: 'efgh5678',
    selectedTextHash: 'ijkl9012',
    pageRefs: [0, 1],
    sourceKind: 'attachment',
    sourceName: 'meeting-notes.pdf',
    confirmedAt: '2025-06-15T10:00:00.000Z',
    status: 'current',
    ...overrides,
  }
}

// ─── Field Candidate Fixture ─────────────────────────────────────────────

export function buildFieldCandidate(overrides?: Partial<OcrFieldCandidate>): OcrFieldCandidate {
  return {
    candidateId: 1,
    runId: 1,
    sectionKey: 'meeting_info',
    fieldKey: 'subject',
    fieldType: 'text',
    raw: 'Q3项目启动会议',
    value: buildTypedTextValue('Q3项目启动会议'),
    confidence: 'high',
    confidenceScore: 0.95,
    spanRef: buildSourceSpanRef(),
    sourceSpanHash: 'span001',
    candidateHash: 'cand001',
    warnings: [],
    provenance: 'deterministic',
    status: 'generated',
    createdAt: '2025-06-15T10:00:00.000Z',
    ...overrides,
  }
}

export function buildDateFieldCandidate(overrides?: Partial<OcrFieldCandidate>): OcrFieldCandidate {
  return {
    candidateId: 2,
    runId: 1,
    sectionKey: 'meeting_info',
    fieldKey: 'date',
    fieldType: 'date',
    raw: '2025年6月15日',
    value: buildTypedDateValue('2025年6月15日'),
    confidence: 'high',
    confidenceScore: 0.9,
    spanRef: buildSourceSpanRef({ charStart: 20, charEnd: 40 }),
    sourceSpanHash: 'span002',
    candidateHash: 'cand002',
    warnings: [],
    provenance: 'deterministic',
    status: 'generated',
    createdAt: '2025-06-15T10:00:00.000Z',
    ...overrides,
  }
}

export function buildAmbiguousDateFieldCandidate(
  overrides?: Partial<OcrFieldCandidate>,
): OcrFieldCandidate {
  return {
    candidateId: 3,
    runId: 1,
    sectionKey: 'meeting_info',
    fieldKey: 'date',
    fieldType: 'date',
    raw: '6/15',
    value: {
      kind: 'date',
      raw: '6/15',
      normalized: '2025-06-15',
      parsed: { year: 2025, month: 6, day: 15 },
    },
    confidence: 'medium',
    confidenceScore: 0.45,
    spanRef: buildSourceSpanRef({ charStart: 40, charEnd: 45 }),
    sourceSpanHash: 'span003',
    candidateHash: 'cand003',
    warnings: [
      buildExtractionWarning('AMBIGUOUS_DATE', {
        message: '日期格式模糊：6/15，可能是 6月15日或15日6月',
        fieldKey: 'date',
        severity: 'warn',
      }),
    ],
    provenance: 'deterministic',
    status: 'generated',
    createdAt: '2025-06-15T10:00:00.000Z',
    ...overrides,
  }
}

// ─── Table Candidate Fixture ─────────────────────────────────────────────

export function buildTableRowCandidate(
  rowIndex: number,
  overrides?: Partial<OcrTableRowCandidate>,
): OcrTableRowCandidate {
  return {
    rowKey: `row_${rowIndex}`,
    rowIndex,
    cells: [
      buildTableCellValue('item', `事项${rowIndex}`),
      buildTableCellValue('owner', `负责人${rowIndex}`),
      buildTableCellValue('deadline', '2025-12-31'),
      buildTableCellValue('status', '未开始'),
      buildTableCellValue('notes', ''),
    ],
    spanRefs: [buildSourceSpanRef({ charStart: rowIndex * 100, charEnd: rowIndex * 100 + 80 })],
    sourceSpanHash: `span_row_${rowIndex}`,
    candidateHash: `cand_row_${rowIndex}`,
    confidence: 'high',
    confidenceScore: 0.85,
    warnings: [],
    provenance: 'deterministic',
    status: 'generated',
    ...overrides,
  }
}

export function buildTableCandidate(overrides?: Partial<OcrTableCandidate>): OcrTableCandidate {
  return {
    candidateId: 100,
    runId: 1,
    tableKey: 'action_items',
    columnCount: 5,
    rows: [buildTableRowCandidate(0), buildTableRowCandidate(1), buildTableRowCandidate(2)],
    maxRows: 200,
    confidence: 'high',
    confidenceScore: 0.88,
    warnings: [],
    provenance: 'deterministic',
    status: 'generated',
    createdAt: '2025-06-15T10:00:00.000Z',
    ...overrides,
  }
}

// ─── Run Fixtures ────────────────────────────────────────────────────────

export function buildRunSummary(
  overrides?: Partial<OcrExtractionRunSummary>,
): OcrExtractionRunSummary {
  return {
    runId: 1,
    extractionId: 1,
    profileId: 1,
    profileName: '会议纪要',
    profileVersion: 1,
    status: 'completed',
    totalFieldCandidates: 5,
    totalTableCandidates: 1,
    warningCount: 2,
    errorCount: 0,
    provenance: 'deterministic',
    createdBy: 1,
    createdAt: '2025-06-15T10:00:00.000Z',
    completedAt: '2025-06-15T10:01:00.000Z',
    allowedActions: ['view', 'review', 'preview_confirm', 'confirm'],
    ...overrides,
  }
}

export function buildRunDetail(
  overrides?: Partial<OcrExtractionRunDetail>,
): OcrExtractionRunDetail {
  return {
    ...buildRunSummary(overrides),
    extractionSummary: buildExtractionSourceSummary(),
    inputSignature: 'sig001',
    idempotencyKey: 'idem_key_001',
    sourceHash: 'abcd1234',
    fieldCandidates: [buildFieldCandidate(), buildDateFieldCandidate()],
    tableCandidates: [buildTableCandidate()],
    warningSummary: {
      totalWarnings: 1,
      totalErrors: 0,
      topCodes: ['AMBIGUOUS_DATE'],
      topFields: ['date'],
      hasBlockingErrors: false,
    },
    ...overrides,
  }
}

// ─── Preview / Save Fixtures ─────────────────────────────────────────────

export function buildPreviewResponse(
  overrides?: Partial<OcrStructuredExtractionPreviewResponse>,
): OcrStructuredExtractionPreviewResponse {
  return {
    previewHash: 'prev_hash_001',
    runId: 1,
    sourceHash: 'abcd1234',
    profileId: 1,
    profileVersion: 1,
    selectedFields: [buildFieldCandidate(), buildDateFieldCandidate()],
    selectedTables: [buildTableCandidate()],
    snapshot: {
      extractionId: 1,
      sourceHash: 'abcd1234',
      profileId: 1,
      profileVersion: 1,
      fieldValues: {
        subject: buildTypedTextValue('Q3项目启动会议'),
        date: buildTypedDateValue('2025年6月15日'),
      },
      tableValues: {
        action_items: [buildTableRowCandidate(0), buildTableRowCandidate(1)],
      },
      sourceSpanHashes: ['span001', 'span002', 'span_row_0', 'span_row_1'],
      candidateHashes: ['cand001', 'cand002', 'cand_row_0', 'cand_row_1'],
    },
    redlineSummary: buildRedlineSummary(),
    staleWarnings: [],
    requiresExplicitConfirmation: true,
    ...overrides,
  }
}

// ─── Snapshot Fixtures ───────────────────────────────────────────────────

export function buildSnapshotSummary(
  overrides?: Partial<OcrStructuredSnapshotSummary>,
): OcrStructuredSnapshotSummary {
  return {
    snapshotId: 1,
    extractionId: 1,
    profileId: 1,
    profileName: '会议纪要',
    profileVersion: 1,
    sourceHash: 'abcd1234',
    snapshotHash: 'snap_hash_001',
    fieldCount: 2,
    tableCount: 1,
    reviewerId: 1,
    reviewNote: null,
    status: 'current',
    supersededById: null,
    confirmedAt: '2025-06-15T10:05:00.000Z',
    supersededAt: null,
    ...overrides,
  }
}

// ─── Accepted Extraction (Input) Fixtures ────────────────────────────────

/** 模拟已接受提取文本——会议纪要 */
export function meetingMinutesAcceptedText(): string {
  return `
Q3项目启动会议

日期：2025年6月15日
地点：A座3层会议室
组织者：张经理

参会人员：
- 王工（主持人）
- 李工（记录人）
- 赵工（参会人）
- 钱工（旁听）

决议事项：
1. 确定Q3开发里程碑为9月30日——负责人：王工，截止日期：2025-07-15
2. 完成技术方案评审——负责人：赵工，截止日期：2025-07-01
3. 安排安全审计——负责人：李工，截止日期：2025-08-01
`.trim()
}

/** 模拟已接受提取文本——行动事项表 */
export function actionItemsAcceptedText(): string {
  return `
行动事项跟踪表

| 事项 | 负责人 | 截止日期 | 状态 | 备注 |
|------|--------|----------|------|------|
| 前端UI重构 | 张工 | 2025-08-01 | 进行中 | 按新设计稿 |
| 后端API升级 | 李工 | 2025-07-20 | 已完成 | v2接口 |
| 数据库迁移 | 王工 | 2025-08-15 | 未开始 | 从SQLite到PG |
| 安全审计 | 赵工 | 2025-09-01 | 未开始 | 第三方审计 |
| 性能测试 | 钱工 | 2025-08-30 | 进行中 | 压测报告 |
`.trim()
}

/** 模拟已接受提取文本——里程碑清单 */
export function milestoneListAcceptedText(): string {
  return `
项目名称：开项Kaiplan V3

里程碑清单：
1. M1 - 需求评审完成：2025-07-01（已完成）
2. M2 - 原型验证通过：2025-07-15（已完成）
3. M3 - Alpha版本发布：2025-08-01（进行中）
4. M4 - Beta测试完成：2025-08-30（未开始）
5. M5 - GA发布：2025-09-30（未开始）
`.trim()
}

/** 模拟已接受提取文本——风险登记册 */
export function riskRegisterAcceptedText(): string {
  return `
项目风险登记册

| 风险描述 | 概率 | 影响 | 风险等级 | 缓解措施 | 负责人 |
|----------|------|------|----------|----------|--------|
| 关键技术栈不成熟 | 中 | 高 | 高 | 提前POC验证 | 张工 |
| 第三方API不稳定 | 高 | 中 | 高 | 实现fallback机制 | 李工 |
| 人员不足 | 低 | 高 | 中 | 优先分配资源 | 王工 |
| 需求变更频繁 | 中 | 中 | 中 | 建立变更审批流程 | 赵工 |
`.trim()
}

/** 模拟已接受提取文本——需求清单 */
export function requirementSheetAcceptedText(): string {
  return `
需求清单 V3.0

| 编号 | 标题 | 优先级 | 状态 | 负责人 | 备注 |
|------|------|--------|------|--------|------|
| REQ-001 | OCR文档上传 | P0 | 已交付 | 张工 | V3核心功能 |
| REQ-002 | 结构化提取 | P0 | 开发中 | 李工 | 依赖REQ-001 |
| REQ-003 | 实体链接 | P1 | 待定 | 王工 | |
| REQ-004 | 搜索索引 | P1 | 已确认 | 赵工 | |
| REQ-005 | 数据看板 | P2 | 待定 | 钱工 | |
`.trim()
}

// ─── 性能测试 fixtures（§7.1）─────────────────────────────────────────────

/** 大型已接受提取文本——性能探针（~5KB 文本） */
export function largeAcceptedText(): string {
  const sections: string[] = []
  // 生成大量会议纪要仿真文本
  for (let i = 1; i <= 50; i++) {
    sections.push(`第${i}次会议纪要`)
    sections.push(
      `日期：2025年${String((i % 12) + 1).padStart(2, '0')}月${String((i % 28) + 1).padStart(2, '0')}日`,
    )
    sections.push(`主题：Q${Math.ceil(i / 4)}项目第${i}次进度评审`)
    sections.push(`参会人员：张工、李工、王工、赵工、钱工`)
    sections.push(`决议事项：`)
    for (let j = 1; j <= 5; j++) {
      sections.push(
        `${j}. 事项${i}-${j}：负责人${String.fromCharCode(65 + (j % 5))}工，截止日期2025-${String((i % 12) + 1).padStart(2, '0')}-${String(((j * 5) % 28) + 1).padStart(2, '0')}`,
      )
    }
    sections.push('')
  }
  return sections.join('\n')
}

/** 大型表格已接受提取文本——表格性能探针（100 行） */
export function largeTableAcceptedText(): string {
  const rows: string[] = [
    '| 事项 | 负责人 | 截止日期 | 状态 | 备注 |',
    '|------|--------|----------|------|------|',
  ]
  for (let i = 1; i <= 100; i++) {
    rows.push(
      `| 事项${i} | 张工 | 2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')} | ${['未开始', '进行中', '已完成', '已取消'][i % 4]} | 备注${i} |`,
    )
  }
  return `大型行动事项表\n\n${rows.join('\n')}`
}

// ─── 低敏导出摘要 helper（§7.6）────────────────────────────────────────

/**
 * 为已确认的结构化提取快照生成低敏导出摘要。
 * 不含完整 OCR 源文本，只包含结构化的字段/表格值和哈希。
 */
export function buildLowSensitiveExportSummary(params: {
  snapshotId: number
  profileName: string
  profileVersion: number
  sourceHash: string
  snapshotHash: string
  fieldCount: number
  tableCount: number
  confirmedAt: string
  fieldKeys: string[]
  tableKeys: string[]
}): Record<string, unknown> {
  return {
    snapshotId: params.snapshotId,
    profileName: params.profileName,
    profileVersion: params.profileVersion,
    sourceHash: params.sourceHash,
    snapshotHash: params.snapshotHash,
    fieldCount: params.fieldCount,
    tableCount: params.tableCount,
    confirmedAt: params.confirmedAt,
    fieldKeys: params.fieldKeys,
    tableKeys: params.tableKeys,
  }
}
