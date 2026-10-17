/**
 * v3-unified-ai-output-quality-ledger —— 测试夹具。
 *
 * 覆盖八态：全通过、单项失败、多项失败、自动修复成功、自动修复后仍失败、
 * can_confirm=false、投影去重、阈值越界。
 */

import type {
  QualityAutoFixTrace,
  QualityCheckResult,
  QualityRecordingInput,
  QualitySanitizedReportEntry,
  QualityThresholdDeclaration,
  QualityValidationRecord,
  QualityHealthIndicator,
} from './unified-ai-output-quality.js'

// ---------------------------------------------------------------------------
// 基础夹具构建器
// ---------------------------------------------------------------------------

let _sequence = 0
function nextSeq(): number {
  return ++_sequence
}

export function buildCheckResult(overrides: Partial<QualityCheckResult> = {}): QualityCheckResult {
  return {
    checkId: 'HL-001',
    hit: false,
    severity: 'info',
    locationRef: null,
    contentHash: null,
    message: '检查通过',
    ...overrides,
  }
}

export function buildAutoFixTrace(
  overrides: Partial<QualityAutoFixTrace> = {},
): QualityAutoFixTrace {
  return {
    attemptedCount: 0,
    successCount: 0,
    stillFailingAfterFix: false,
    ...overrides,
  }
}

export function buildSanitizedReportEntry(
  overrides: Partial<QualitySanitizedReportEntry> = {},
): QualitySanitizedReportEntry {
  return {
    checkId: 'HL-001',
    hit: false,
    severity: 'info',
    locationRef: null,
    contentHash: null,
    ...overrides,
  }
}

export function buildQualityRecord(
  overrides: Partial<QualityValidationRecord> = {},
): QualityValidationRecord {
  return {
    id: nextSeq(),
    organizationId: 1,
    artifactRef: `draft:v1:attempt:${nextSeq()}`,
    capabilitySurface: 'draft',
    validatorCategory: 'hard',
    validatorVersion: '1.0.0',
    checkResults: [
      buildCheckResult({ checkId: 'HL-001', hit: false, severity: 'blocking' }),
      buildCheckResult({ checkId: 'HL-002', hit: false, severity: 'blocking' }),
    ],
    hitCheckIds: [],
    confidenceScore: 100,
    overallRiskLevel: 'low',
    canConfirm: true,
    autoFixTrace: null,
    sanitizedReport: [],
    idempotencyKey: `idem-${nextSeq()}`,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildQualityRecordingInput(
  overrides: Partial<QualityRecordingInput> = {},
): QualityRecordingInput {
  return {
    organizationId: 1,
    artifactRef: `draft:v1:attempt:${nextSeq()}`,
    capabilitySurface: 'draft',
    validatorVersion: '1.0.0',
    checkResults: [buildCheckResult({ checkId: 'HL-001', hit: false, severity: 'blocking' })],
    hitCheckIds: [],
    confidenceScore: 100,
    overallRiskLevel: 'low',
    canConfirm: true,
    autoFixTrace: null,
    idempotencyKey: `idem-${nextSeq()}`,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 八态夹具
// ---------------------------------------------------------------------------

/** 态 1：全通过（零问题）。 */
export function fixtureAllPass(): QualityValidationRecord {
  return buildQualityRecord({
    checkResults: [
      buildCheckResult({ checkId: 'HL-001', hit: false, severity: 'blocking' }),
      buildCheckResult({ checkId: 'HL-002', hit: false, severity: 'blocking' }),
      buildCheckResult({ checkId: 'HL-003', hit: false, severity: 'blocking' }),
    ],
    hitCheckIds: [],
    confidenceScore: 100,
    overallRiskLevel: 'low',
    canConfirm: true,
    sanitizedReport: [
      buildSanitizedReportEntry({ checkId: 'HL-001', hit: false }),
      buildSanitizedReportEntry({ checkId: 'HL-002', hit: false }),
      buildSanitizedReportEntry({ checkId: 'HL-003', hit: false }),
    ],
  })
}

/** 态 2：单项失败（HL-002 命中）。 */
export function fixtureSingleFailure(): QualityValidationRecord {
  return buildQualityRecord({
    checkResults: [
      buildCheckResult({ checkId: 'HL-001', hit: false, severity: 'blocking' }),
      buildCheckResult({
        checkId: 'HL-002',
        hit: true,
        severity: 'blocking',
        locationRef: 'tasks[0].durationDays',
        contentHash: 'a1b2c3d4e5f6',
        message: 'Task duration must stay between 0.5 and 30 days.',
      }),
    ],
    hitCheckIds: ['HL-002'],
    confidenceScore: 75,
    overallRiskLevel: 'high',
    canConfirm: false,
    sanitizedReport: [
      buildSanitizedReportEntry({ checkId: 'HL-001', hit: false }),
      buildSanitizedReportEntry({
        checkId: 'HL-002',
        hit: true,
        severity: 'blocking',
        locationRef: 'tasks[0].durationDays',
        contentHash: 'a1b2c3d4e5f6',
      }),
    ],
  })
}

/** 态 3：多项失败（HL-002 + HL-007 命中）。 */
export function fixtureMultiFailure(): QualityValidationRecord {
  return buildQualityRecord({
    checkResults: [
      buildCheckResult({
        checkId: 'HL-002',
        hit: true,
        severity: 'blocking',
        locationRef: 'tasks[2].durationDays',
        contentHash: 'b2c3d4e5f6a1',
        message: 'Task duration exceeds 30 days.',
      }),
      buildCheckResult({
        checkId: 'HL-007',
        hit: true,
        severity: 'blocking',
        locationRef: 'dependencies',
        contentHash: 'c3d4e5f6a1b2',
        message: 'Dependency graph contains a cycle.',
      }),
      buildCheckResult({ checkId: 'HL-001', hit: false, severity: 'blocking' }),
    ],
    hitCheckIds: ['HL-002', 'HL-007'],
    confidenceScore: 50,
    overallRiskLevel: 'critical',
    canConfirm: false,
  })
}

/** 态 4：自动修复成功（尝试 2，成功 2，修后通过）。 */
export function fixtureAutoFixSuccess(): QualityValidationRecord {
  return buildQualityRecord({
    checkResults: [
      buildCheckResult({ checkId: 'HL-001', hit: false, severity: 'blocking' }),
      buildCheckResult({ checkId: 'HL-002', hit: false, severity: 'blocking' }),
    ],
    hitCheckIds: [],
    confidenceScore: 95,
    overallRiskLevel: 'low',
    canConfirm: true,
    autoFixTrace: buildAutoFixTrace({
      attemptedCount: 2,
      successCount: 2,
      stillFailingAfterFix: false,
    }),
  })
}

/** 态 5：自动修复后仍失败（尝试 1，成功 0，修后仍失败）。 */
export function fixtureAutoFixStillFailing(): QualityValidationRecord {
  return buildQualityRecord({
    checkResults: [
      buildCheckResult({
        checkId: 'HL-007',
        hit: true,
        severity: 'blocking',
        locationRef: 'dependencies',
        contentHash: 'd4e5f6a1b2c3',
        message: 'Dependency cycle persists after fix attempt.',
      }),
    ],
    hitCheckIds: ['HL-007'],
    confidenceScore: 40,
    overallRiskLevel: 'critical',
    canConfirm: false,
    autoFixTrace: buildAutoFixTrace({
      attemptedCount: 1,
      successCount: 0,
      stillFailingAfterFix: true,
    }),
  })
}

/** 态 6：can_confirm=false（blocking 项阻止确认）。 */
export function fixtureCannotConfirm(): QualityValidationRecord {
  return buildQualityRecord({
    checkResults: [
      buildCheckResult({
        checkId: 'VE-010',
        hit: true,
        severity: 'blocking',
        locationRef: 'charter.title',
        contentHash: null,
        message: 'Project title is required.',
      }),
    ],
    hitCheckIds: ['VE-010'],
    confidenceScore: 60,
    overallRiskLevel: 'high',
    canConfirm: false,
  })
}

/** 态 7：投影去重（既有草案校验投影 + 新记录同源）。 */
export function fixtureProjectionDedup(): {
  projection: {
    id: number
    draftId: number
    version: number
    artifactRef: string
    confidenceScore: number
  }
  newRecord: QualityValidationRecord
} {
  return {
    projection: {
      id: 42,
      draftId: 42,
      version: 1,
      artifactRef: 'draft:v1:attempt:42:1',
      confidenceScore: 85,
    },
    newRecord: buildQualityRecord({
      artifactRef: 'draft:v1:attempt:42:1', // 同一产物引用
      confidenceScore: 85,
      checkResults: [buildCheckResult({ checkId: 'HL-001', hit: false, severity: 'blocking' })],
      hitCheckIds: [],
      canConfirm: true,
    }),
  }
}

/** 态 8：阈值越界。 */
export function fixtureThresholdBreach(): {
  threshold: QualityThresholdDeclaration
  health: QualityHealthIndicator
} {
  return {
    threshold: {
      checkId: 'HL-002',
      warningThreshold: 0.3,
      criticalThreshold: 0.6,
      runbookRef: 'docs/runbooks/hl002-threshold.md',
    },
    health: {
      state: 'critical',
      reasonCode: 'hit_rate_critical',
      runbookRef: 'docs/runbooks/hl002-threshold.md',
      triggeredCheckId: 'HL-002',
    },
  }
}

// ---------------------------------------------------------------------------
// 跨能力面接线夹具
// ---------------------------------------------------------------------------

/** 六面各自的接线输入。 */
export function fixtureSixSurfaceInputs(): QualityRecordingInput[] {
  return [
    buildQualityRecordingInput({
      capabilitySurface: 'risk',
      artifactRef: 'risk-suggestion:proj1:run5',
      checkResults: [
        buildCheckResult({
          checkId: 'HL-001',
          hit: false,
          severity: 'blocking',
          message: 'Risk suggestion references are traceable.',
        }),
      ],
      hitCheckIds: [],
      confidenceScore: 92,
      canConfirm: true,
    }),
    buildQualityRecordingInput({
      capabilitySurface: 'prediction',
      artifactRef: 'prediction:proj1:signal3',
      checkResults: [
        buildCheckResult({
          checkId: 'HL-001',
          hit: false,
          severity: 'blocking',
          message: 'Prediction explanation is traceable.',
        }),
      ],
      hitCheckIds: [],
      confidenceScore: 88,
      canConfirm: true,
    }),
    buildQualityRecordingInput({
      capabilitySurface: 'pmo',
      artifactRef: 'pmo-recommendation:org1:batch2',
      checkResults: [
        buildCheckResult({
          checkId: 'HL-001',
          hit: false,
          severity: 'blocking',
          message: 'PMO recommendation references are valid.',
        }),
      ],
      hitCheckIds: [],
      confidenceScore: 90,
      canConfirm: true,
    }),
    buildQualityRecordingInput({
      capabilitySurface: 'triz',
      artifactRef: 'triz-narrative:proj1:scheme7',
      checkResults: [
        buildCheckResult({
          checkId: 'HL-001',
          hit: false,
          severity: 'blocking',
          message: 'TRIZ narrative references are traceable.',
        }),
      ],
      hitCheckIds: [],
      confidenceScore: 85,
      canConfirm: true,
    }),
    buildQualityRecordingInput({
      capabilitySurface: 'report',
      artifactRef: 'report-draft:proj1:v2',
      checkResults: [
        buildCheckResult({
          checkId: 'HL-001',
          hit: false,
          severity: 'blocking',
          message: 'Report draft content is grounded.',
        }),
      ],
      hitCheckIds: [],
      confidenceScore: 87,
      canConfirm: true,
    }),
    buildQualityRecordingInput({
      capabilitySurface: 'health',
      artifactRef: 'health-diagnosis:proj1:run1',
      checkResults: [
        buildCheckResult({
          checkId: 'HL-001',
          hit: false,
          severity: 'blocking',
          message: 'Health diagnosis is grounded in project data.',
        }),
      ],
      hitCheckIds: [],
      confidenceScore: 91,
      canConfirm: true,
    }),
  ]
}

// ---------------------------------------------------------------------------
// 脱敏报告夹具（含负例：不应出现产物正文）
// ---------------------------------------------------------------------------

/** 正常脱敏报告。 */
export function fixtureSanitizedReport(): QualitySanitizedReportEntry[] {
  return [
    {
      checkId: 'HL-002',
      hit: true,
      severity: 'blocking',
      locationRef: 'tasks[0].durationDays',
      contentHash: 'a1b2c3d4e5f6',
    },
    {
      checkId: 'HL-001',
      hit: false,
      severity: 'blocking',
      locationRef: null,
      contentHash: null,
    },
  ]
}

/** 负例：包含产物正文的 report（应被 sanitizer 拒绝）。 */
export function fixtureForbiddenReport(): Record<string, unknown> {
  return {
    results: [
      {
        checkId: 'HL-002',
        hit: true,
        severity: 'blocking',
        // 以下字段包含被校验产物正文，应被拒绝
        content: 'The task "Implement login" has duration 0.2 days which is below minimum.',
        prompt: 'You are a project validation assistant...',
        outputText: 'Duration validation failed for task T001',
        token: 'sk-abc123',
      },
    ],
  }
}
