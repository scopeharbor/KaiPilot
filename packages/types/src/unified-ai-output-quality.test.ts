/**
 * unified-ai-output-quality 类型契约测试。
 *
 * 覆盖：
 * - 逐检查项记录与聚合一致性
 * - 校验置信度与主观质量评分字段分离
 * - 脱敏报告不含产物正文
 * - 自动修复留痕区分修后成功/仍失败
 * - 阈值判定只产健康状态
 * - 记账降级与确认阻断独立
 * - 六面能力面接线
 * - 幂等键防重复写入
 * - 稳定检查项标识
 */

import { describe, it, expect } from 'vitest'
import {
  QUALITY_CHECK_IDS,
  QUALITY_LEDGER_CAPABILITY_SURFACES,
  QUALITY_SEVERITIES,
  QUALITY_RISK_LEVELS,
  QUALITY_HEALTH_STATES,
  QUALITY_HEALTH_REASON_CODES,
  QUALITY_VALIDATOR_CATEGORIES,
  QUALITY_AGGREGATION_DIMENSIONS,
  DEFAULT_QUALITY_THRESHOLDS,
  qualityReportDetectForbiddenKeys,
  qualityReportHasForbiddenKeys,
  sanitizeQualityReport,
  evaluateQualityHealth,
  validateRecordingDegradation,
  aggregateQualityRecords,
  groupRecordsByValidatorVersion,
  computeQualityContentHash,
  computeQualityFragmentHash,
  type QualityValidationRecord,
  type QualityCheckResult,
  type QualityRecordingInput,
} from './unified-ai-output-quality'
import {
  fixtureAllPass,
  fixtureSingleFailure,
  fixtureMultiFailure,
  fixtureAutoFixSuccess,
  fixtureAutoFixStillFailing,
  fixtureCannotConfirm,
  fixtureProjectionDedup,
  fixtureThresholdBreach,
  fixtureSixSurfaceInputs,
  fixtureForbiddenReport,
  fixtureSanitizedReport,
  buildQualityRecord,
  buildCheckResult,
  buildQualityRecordingInput,
} from './unified-ai-output-quality-fixtures'

// ---------------------------------------------------------------------------
// §2.3 稳定检查项标识
// ---------------------------------------------------------------------------

describe('稳定检查项标识', () => {
  it('包含 HL-001 到 HL-010 全部十项', () => {
    for (let i = 1; i <= 10; i++) {
      const id = `HL-${String(i).padStart(3, '0')}`
      expect(QUALITY_CHECK_IDS).toContain(id)
    }
  })

  it('包含 VE-001 到 VE-012 全部十二项', () => {
    for (let i = 1; i <= 12; i++) {
      const id = `VE-${String(i).padStart(3, '0')}`
      expect(QUALITY_CHECK_IDS).toContain(id)
    }
  })

  it('标识总数为 22（HL 10 + VE 12）', () => {
    expect(QUALITY_CHECK_IDS).toHaveLength(22)
  })

  it('标识为稳定字符串，不含临时或调试前缀', () => {
    for (const id of QUALITY_CHECK_IDS) {
      expect(id).not.toMatch(/^TEST_/)
      expect(id).not.toMatch(/^DEBUG_/)
      expect(id).not.toMatch(/^TEMP_/)
    }
  })
})

// ---------------------------------------------------------------------------
// §2.3 能力面枚举
// ---------------------------------------------------------------------------

describe('能力面枚举', () => {
  it('包含六个未接线能力面加 draft', () => {
    expect(QUALITY_LEDGER_CAPABILITY_SURFACES).toContain('draft')
    expect(QUALITY_LEDGER_CAPABILITY_SURFACES).toContain('risk')
    expect(QUALITY_LEDGER_CAPABILITY_SURFACES).toContain('prediction')
    expect(QUALITY_LEDGER_CAPABILITY_SURFACES).toContain('pmo')
    expect(QUALITY_LEDGER_CAPABILITY_SURFACES).toContain('triz')
    expect(QUALITY_LEDGER_CAPABILITY_SURFACES).toContain('report')
    expect(QUALITY_LEDGER_CAPABILITY_SURFACES).toContain('health')
  })

  it('共 7 个能力面', () => {
    expect(QUALITY_LEDGER_CAPABILITY_SURFACES).toHaveLength(7)
  })
})

// ---------------------------------------------------------------------------
// §2.2 逐检查项记录与聚合一致性
// ---------------------------------------------------------------------------

describe('逐检查项记录与聚合一致性', () => {
  it('全通过记录：hitCheckIds 为空', () => {
    const record = fixtureAllPass()
    expect(record.hitCheckIds).toHaveLength(0)
    expect(record.checkResults.every((r) => !r.hit)).toBe(true)
  })

  it('单项失败：hitCheckIds 包含命中的检查项', () => {
    const record = fixtureSingleFailure()
    expect(record.hitCheckIds).toContain('HL-002')
    expect(record.checkResults.some((r) => r.checkId === 'HL-002' && r.hit)).toBe(true)
  })

  it('多项失败：hitCheckIds 包含所有命中的检查项', () => {
    const record = fixtureMultiFailure()
    expect(record.hitCheckIds).toContain('HL-002')
    expect(record.hitCheckIds).toContain('HL-007')
    expect(record.hitCheckIds.length).toBeGreaterThanOrEqual(2)
  })

  it('聚合命中率与逐检查项结果一致', () => {
    const records = [
      fixtureAllPass(),
      fixtureSingleFailure(),
      fixtureMultiFailure(),
      fixtureCannotConfirm(),
    ]

    const result = aggregateQualityRecords(records, 'organization', {
      startIso: '2000-01-01T00:00:00Z',
      endIso: '2100-01-01T00:00:00Z',
    })

    expect(result.empty).toBe(false)
    expect(result.buckets.length).toBeGreaterThanOrEqual(1)

    // 4 条记录，3 条有 hit，命中率 = 0.75
    const bucket = result.buckets[0]!
    expect(bucket.totalCount).toBe(4)
    expect(bucket.hitCount).toBe(3)
    expect(bucket.hitRate).toBeCloseTo(0.75, 2)
  })
})

// ---------------------------------------------------------------------------
// §2.7 校验置信度与主观质量评分字段分离
// ---------------------------------------------------------------------------

describe('校验置信度与主观质量评分字段分离', () => {
  it('QualityValidationRecord 不含 qualityScore 字段', () => {
    const record = fixtureAllPass()
    expect(record).not.toHaveProperty('qualityScore')
    expect(record).not.toHaveProperty('relevanceScore')
    expect(record).not.toHaveProperty('usefulnessScore')
    expect(record).not.toHaveProperty('clarityScore')
  })

  it('confidenceScore 为 0~100 整数', () => {
    const record = fixtureAllPass()
    expect(typeof record.confidenceScore).toBe('number')
    expect(record.confidenceScore).toBeGreaterThanOrEqual(0)
    expect(record.confidenceScore).toBeLessThanOrEqual(100)
  })

  it('校验器类别只有 hard/soft，soft 类别不记录', () => {
    expect(QUALITY_VALIDATOR_CATEGORIES).toContain('hard')
    expect(QUALITY_VALIDATOR_CATEGORIES).toContain('soft')
    // 本模块只记录 hard 类别的校验结果
    const record = fixtureAllPass()
    expect(record.validatorCategory).toBe('hard')
  })
})

// ---------------------------------------------------------------------------
// §2.5/2.10 脱敏报告不含产物正文
// ---------------------------------------------------------------------------

describe('脱敏报告不含产物正文', () => {
  it('脱敏后只含 checkId/hit/severity/locationRef/contentHash', () => {
    const record = fixtureSingleFailure()
    const sanitized = sanitizeQualityReport(record.checkResults)
    for (const entry of sanitized) {
      expect(entry).toHaveProperty('checkId')
      expect(entry).toHaveProperty('hit')
      expect(entry).toHaveProperty('severity')
      expect(entry).toHaveProperty('locationRef')
      expect(entry).toHaveProperty('contentHash')
      // 不得含产物正文相关键
      expect(entry).not.toHaveProperty('content')
      expect(entry).not.toHaveProperty('text')
      expect(entry).not.toHaveProperty('body')
      expect(entry).not.toHaveProperty('output')
      expect(entry).not.toHaveProperty('prompt')
    }
  })

  it('sanitizer 检测禁止内容键', () => {
    const forbidden = fixtureForbiddenReport()
    const detected = qualityReportDetectForbiddenKeys(forbidden)
    expect(detected.length).toBeGreaterThan(0)
    expect(detected).toContain('prompt')
  })

  it('正常脱敏报告不含禁止键', () => {
    const safeEntries = fixtureSanitizedReport()
    const obj = Object.fromEntries(safeEntries.map((e, i) => [`entry_${i}`, e]))
    expect(qualityReportHasForbiddenKeys(obj)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §2.4 自动修复留痕
// ---------------------------------------------------------------------------

describe('自动修复留痕', () => {
  it('修复成功：stillFailingAfterFix = false', () => {
    const record = fixtureAutoFixSuccess()
    expect(record.autoFixTrace).not.toBeNull()
    expect(record.autoFixTrace!.stillFailingAfterFix).toBe(false)
    expect(record.autoFixTrace!.successCount).toBeGreaterThan(0)
  })

  it('修复后仍失败：stillFailingAfterFix = true', () => {
    const record = fixtureAutoFixStillFailing()
    expect(record.autoFixTrace).not.toBeNull()
    expect(record.autoFixTrace!.stillFailingAfterFix).toBe(true)
    expect(record.autoFixTrace!.successCount).toBe(0)
  })

  it('两种形态可通过 stillFailingAfterFix 区分', () => {
    const success = fixtureAutoFixSuccess()
    const stillFailing = fixtureAutoFixStillFailing()
    expect(success.autoFixTrace!.stillFailingAfterFix).not.toBe(
      stillFailing.autoFixTrace!.stillFailingAfterFix,
    )
  })
})

// ---------------------------------------------------------------------------
// §6.6 阈值判定只产健康状态
// ---------------------------------------------------------------------------

describe('阈值判定只产健康状态', () => {
  it('命中率低于 warning 阈值：healthy', () => {
    const result = evaluateQualityHealth(0.1, DEFAULT_QUALITY_THRESHOLDS[0]!)
    expect(result.state).toBe('healthy')
    expect(result.reasonCode).toBe('all_clear')
  })

  it('命中率超过 warning 阈值：warning', () => {
    const result = evaluateQualityHealth(0.35, DEFAULT_QUALITY_THRESHOLDS[0]!)
    expect(result.state).toBe('warning')
    expect(result.reasonCode).toBe('hit_rate_warning')
  })

  it('命中率超过 critical 阈值：critical', () => {
    const result = evaluateQualityHealth(0.65, DEFAULT_QUALITY_THRESHOLDS[0]!)
    expect(result.state).toBe('critical')
    expect(result.reasonCode).toBe('hit_rate_critical')
  })

  it('无数据：unknown', () => {
    const result = evaluateQualityHealth(null, DEFAULT_QUALITY_THRESHOLDS[0]!)
    expect(result.state).toBe('unknown')
    expect(result.reasonCode).toBe('no_data')
  })

  it('健康状态产出不包含任何自动动作', () => {
    const result = evaluateQualityHealth(0.8, DEFAULT_QUALITY_THRESHOLDS[0]!)
    // 健康状态只含 state/reasonCode/runbookRef/triggeredCheckId
    expect(result).not.toHaveProperty('autoFixStrategy')
    expect(result).not.toHaveProperty('promptRollback')
    expect(result).not.toHaveProperty('disableCheck')
    expect(result).not.toHaveProperty('retry')
  })
})

// ---------------------------------------------------------------------------
// §6.8/6.9 记账降级与确认阻断独立
// ---------------------------------------------------------------------------

describe('记账降级与确认阻断独立', () => {
  it('记账失败但业务判定为不可确认：确认仍阻断', () => {
    const result = validateRecordingDegradation(true, true)
    expect(result.recordingFailed).toBe(true)
    expect(result.businessVerdictNotConfirmable).toBe(true)
    expect(result.confirmationBlocked).toBe(true) // 关键：确认阻断不依赖记账
  })

  it('记账失败但业务判定为可确认：确认不阻断', () => {
    const result = validateRecordingDegradation(true, false)
    expect(result.recordingFailed).toBe(true)
    expect(result.businessVerdictNotConfirmable).toBe(false)
    expect(result.confirmationBlocked).toBe(false)
  })

  it('记账成功且业务判定为不可确认：确认阻断', () => {
    const result = validateRecordingDegradation(false, true)
    expect(result.confirmationBlocked).toBe(true)
  })

  it('can_confirm=false 的确认阻断不依赖账本可用性', () => {
    const record = fixtureCannotConfirm()
    expect(record.canConfirm).toBe(false)
    // 即使记账失败，can_confirm=false 仍阻断确认
    const degraded = validateRecordingDegradation(true, !record.canConfirm)
    expect(degraded.confirmationBlocked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// §5.6 六面能力面接线
// ---------------------------------------------------------------------------

describe('六面能力面接线', () => {
  it('六个能力面均有接线输入', () => {
    const inputs = fixtureSixSurfaceInputs()
    const surfaces = inputs.map((i) => i.capabilitySurface)
    expect(surfaces).toContain('risk')
    expect(surfaces).toContain('prediction')
    expect(surfaces).toContain('pmo')
    expect(surfaces).toContain('triz')
    expect(surfaces).toContain('report')
    expect(surfaces).toContain('health')
  })

  it('每个接线输入都有唯一的 capabilitySurface', () => {
    const inputs = fixtureSixSurfaceInputs()
    const surfaces = inputs.map((i) => i.capabilitySurface)
    expect(new Set(surfaces).size).toBe(surfaces.length)
  })

  it('所有接线输入都通过同一结构（QualityRecordingInput）', () => {
    const inputs = fixtureSixSurfaceInputs()
    for (const input of inputs) {
      expect(input).toHaveProperty('organizationId')
      expect(input).toHaveProperty('artifactRef')
      expect(input).toHaveProperty('capabilitySurface')
      expect(input).toHaveProperty('validatorVersion')
      expect(input).toHaveProperty('checkResults')
      expect(input).toHaveProperty('hitCheckIds')
      expect(input).toHaveProperty('confidenceScore')
      expect(input).toHaveProperty('overallRiskLevel')
      expect(input).toHaveProperty('canConfirm')
      expect(input).toHaveProperty('idempotencyKey')
    }
  })
})

// ---------------------------------------------------------------------------
// §2.3 校验器版本随记录落盘
// ---------------------------------------------------------------------------

describe('校验器版本随记录落盘', () => {
  it('每条记录都包含 validatorVersion', () => {
    const records = [fixtureAllPass(), fixtureSingleFailure(), fixtureAutoFixSuccess()]
    for (const record of records) {
      expect(record.validatorVersion).toBeDefined()
      expect(typeof record.validatorVersion).toBe('string')
      expect(record.validatorVersion.length).toBeGreaterThan(0)
    }
  })

  it('按版本分组后趋势不断裂', () => {
    const records = [
      buildQualityRecord({ validatorVersion: '1.0.0', hitCheckIds: ['HL-001'] }),
      buildQualityRecord({ validatorVersion: '1.0.0', hitCheckIds: [] }),
      buildQualityRecord({ validatorVersion: '1.1.0', hitCheckIds: ['HL-002'] }),
    ]
    const groups = groupRecordsByValidatorVersion(records)
    expect(groups.size).toBe(2)
    expect(groups.get('1.0.0')!.length).toBe(2)
    expect(groups.get('1.1.0')!.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// §2.5 位置引用可解析
// ---------------------------------------------------------------------------

describe('位置引用可解析', () => {
  it('失败记录包含 locationRef', () => {
    const record = fixtureSingleFailure()
    const failedCheck = record.checkResults.find((r) => r.hit)
    expect(failedCheck).toBeDefined()
    expect(failedCheck!.locationRef).not.toBeNull()
    expect(typeof failedCheck!.locationRef).toBe('string')
  })

  it('失败记录包含 contentHash', () => {
    const record = fixtureSingleFailure()
    const failedCheck = record.checkResults.find((r) => r.hit)
    expect(failedCheck).toBeDefined()
    expect(failedCheck!.contentHash).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 投影去重
// ---------------------------------------------------------------------------

describe('投影去重', () => {
  it('投影与新记录共享同一 artifactRef', () => {
    const { projection, newRecord } = fixtureProjectionDedup()
    expect(newRecord.artifactRef).toContain(String(projection.id))
  })

  it('去重后只计一次', () => {
    const { projection, newRecord } = fixtureProjectionDedup()
    // 同一 artifactRef 应被去重
    const allRecords = [newRecord]
    const seen = new Set<string>()
    seen.add(projection.artifactRef) // 投影已计入
    let deduped = 0
    for (const r of allRecords) {
      if (seen.has(r.artifactRef)) deduped++
      else seen.add(r.artifactRef)
    }
    expect(deduped).toBe(1) // 新记录被去重
  })
})

// ---------------------------------------------------------------------------
// 内容 hash
// ---------------------------------------------------------------------------

describe('内容 hash', () => {
  it('相同输入产出相同 hash', () => {
    const h1 = computeQualityContentHash({ a: 1, b: 2 })
    const h2 = computeQualityContentHash({ a: 1, b: 2 })
    expect(h1).toBe(h2)
  })

  it('不同输入产出不同 hash', () => {
    const h1 = computeQualityContentHash({ a: 1 })
    const h2 = computeQualityContentHash({ a: 2 })
    expect(h1).not.toBe(h2)
  })

  it('hash 为 12 位十六进制', () => {
    const h = computeQualityFragmentHash('test content')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
  })
})

// ---------------------------------------------------------------------------
// 阈值越界夹具
// ---------------------------------------------------------------------------

describe('阈值越界夹具', () => {
  it('阈值越界产出正确的健康状态', () => {
    const { threshold, health } = fixtureThresholdBreach()
    const result = evaluateQualityHealth(0.7, threshold)
    expect(result.state).toBe(health.state)
    expect(result.reasonCode).toBe(health.reasonCode)
  })
})
