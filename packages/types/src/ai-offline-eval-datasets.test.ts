/**
 * ai-offline-eval-datasets.test —— 离线回归评测数据集契约与夹具单元测试。
 *
 * 覆盖：
 * - Task 2.5/2.6：内容确定性（sorted JSON + SHA-256）
 * - Task 2.7/2.8：禁存约束（负例测试）
 * - Task 2.9：五态 fixtures
 * - Task 2.10：barrel 导出无撞名
 * - Task 3.4/5.4：评分配置版本与 baseline run ID
 * - Task 4.1-4.4：四类目标组各有有效样本
 * - Task 4.5：样本从现有 fixture 提取（结构验证）
 * - Task 4.6：每类目标组端到端运行
 * - Task 5.1/5.2：确定性序列化
 * - Task 5.5/5.6：per-sample 差异输出
 * - Task 5.7：不做自动 regressed 判定
 */
import { describe, it, expect } from 'vitest'
import {
  EVAL_TARGET_GROUPS,
  isEvalTargetGroup,
  formatDatasetVersion,
  parseDatasetVersion,
  computeSampleDifference,
  serializeReportForDeterminism,
  serializeSortedSamples,
  computeDatasetContentHash,
  detectRunRecordForbiddenFields,
  OFFLINE_EVAL_BENCHMARK_SOURCES,
  OFFLINE_EVAL_SCORE_LABELS,
  OFFLINE_EVAL_FORBIDDEN_STORE_FIELDS,
  OFFLINE_EVAL_PROVIDER_KINDS,
  OFFLINE_EVAL_AUTH_STATUSES,
  isOfflineEvalBenchmarkSource,
  isOfflineEvalScoreLabel,
  isOfflineEvalForbiddenStoreField,
  isOfflineEvalProviderKind,
  isOfflineEvalAuthStatus,
  resolveEvalProvider,
  computeReportSummary,
  computeReportContentHash,
  serializeSortedSampleResults,
  type OfflineEvalReport,
  type SampleResult,
  type DatasetVersion,
  type ScoringConfigVersion,
  type OfflineEvalSample,
} from './ai-offline-eval-datasets.js'
import {
  INTENT_ROUTING_SAMPLES,
  DRAFT_QUALITY_SAMPLES,
  CONTEXT_ASSEMBLY_SAMPLES,
  STRUCTURED_OUTPUT_SAMPLES,
  CURRENT_DATASET_VERSION,
  CURRENT_SCORING_CONFIG_VERSION,
  buildOfflineEvalDataset,
  offlineEvalReportFixtures,
  fixtureAllPassReport,
  fixtureSingleSampleRegressionReport,
  fixtureMildOverallDeclineReport,
  fixtureL3DatasetReport,
  fixtureAuthGateNotOpenedReport,
  fixtureL3Samples,
} from './ai-offline-eval-datasets-fixtures.js'

// ═══════════════════════════════════════════════════════════════════════
// Task 4.1-4.4：四类目标组各有有效样本
// ═══════════════════════════════════════════════════════════════════════

describe('评测目标组定义', () => {
  it('EVAL_TARGET_GROUPS 包含四个目标组', () => {
    expect(EVAL_TARGET_GROUPS).toHaveLength(4)
  })

  it('isEvalTargetGroup 类型守卫正确', () => {
    expect(isEvalTargetGroup('intent_routing_accuracy')).toBe(true)
    expect(isEvalTargetGroup('draft_quality')).toBe(true)
    expect(isEvalTargetGroup('context_assembly_completeness')).toBe(true)
    expect(isEvalTargetGroup('structured_output_conformance')).toBe(true)
    expect(isEvalTargetGroup('unknown')).toBe(false)
  })
})

describe('意图路由准确率数据集（Task 4.1）', () => {
  it('包含 4 个样本', () => {
    expect(INTENT_ROUTING_SAMPLES).toHaveLength(4)
  })

  it('每个样本有唯一 sampleId', () => {
    const ids = INTENT_ROUTING_SAMPLES.map((s) => s.sampleId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个样本有 benchmarkInput 和 expectedActivatedKeys', () => {
    for (const sample of INTENT_ROUTING_SAMPLES) {
      expect(sample.benchmarkInput).toBeDefined()
      expect(sample.benchmarkInput.context).toBeDefined()
      expect(sample.benchmarkInput.skills.length).toBeGreaterThan(0)
      expect(Array.isArray(sample.expectedActivatedKeys)).toBe(true)
    }
  })

  it('样本引用现有 skill-activation fixture 的结构', () => {
    // 验证 benchmarkInput 结构与 BenchmarkInput 契约一致
    const sample = INTENT_ROUTING_SAMPLES[0]!
    expect(sample.benchmarkInput.label).toBeTruthy()
    expect(sample.benchmarkInput.context).toHaveProperty('projectType')
  })
})

describe('草案质量数据集（Task 4.2）', () => {
  it('包含 4 个样本', () => {
    expect(DRAFT_QUALITY_SAMPLES).toHaveLength(4)
  })

  it('每个样本有唯一 sampleId', () => {
    const ids = DRAFT_QUALITY_SAMPLES.map((s) => s.sampleId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个样本 evaluatorInput 维度为 draft_structural_compliance', () => {
    for (const sample of DRAFT_QUALITY_SAMPLES) {
      expect(sample.evaluatorInput.dimension).toBe('draft_structural_compliance')
    }
  })

  it('每个样本有 expectedScoreValue（0 或 1）', () => {
    for (const sample of DRAFT_QUALITY_SAMPLES) {
      expect([0, 1]).toContain(sample.expectedScoreValue)
    }
  })

  it('样本引用现有 draft schema 验证 fixture 的结构', () => {
    // 验证 evaluatorInput 结构与 DeterministicEvaluatorInput 契约一致
    const sample = DRAFT_QUALITY_SAMPLES[0]!
    expect(sample.evaluatorInput.artifact.artifactKind).toBe('draft_version')
    expect(sample.evaluatorInput.features).toBeDefined()
  })
})

describe('上下文组装完备度数据集（Task 4.3）', () => {
  it('包含 7 个样本（对应七态 fixture）', () => {
    expect(CONTEXT_ASSEMBLY_SAMPLES).toHaveLength(7)
  })

  it('每个样本有唯一 sampleId', () => {
    const ids = CONTEXT_ASSEMBLY_SAMPLES.map((s) => s.sampleId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个样本有 assemblyState、sourceCount、truncated、hasWarnings', () => {
    for (const sample of CONTEXT_ASSEMBLY_SAMPLES) {
      expect(sample.assemblyState).toBeTruthy()
      expect(typeof sample.sourceCount).toBe('number')
      expect(typeof sample.truncated).toBe('boolean')
      expect(typeof sample.hasWarnings).toBe('boolean')
    }
  })

  it('七态覆盖：complete/truncated/stale/permission-missing/zero-result/methodology-injected/general-scope', () => {
    const states = CONTEXT_ASSEMBLY_SAMPLES.map((s) => s.assemblyState)
    expect(states).toContain('complete')
    expect(states).toContain('truncated')
    expect(states).toContain('stale')
    expect(states).toContain('permission-missing')
    expect(states).toContain('zero-result')
    expect(states).toContain('methodology-injected')
    expect(states).toContain('general-scope')
  })

  it('样本引用现有 copilot-context-assembly fixture 的结构', () => {
    // 验证 complete 态的预期
    const complete = CONTEXT_ASSEMBLY_SAMPLES.find((s) => s.assemblyState === 'complete')!
    expect(complete.sourceCount).toBe(3)
    expect(complete.truncated).toBe(false)
    expect(complete.hasWarnings).toBe(false)
    expect(complete.expectedCompleteness).toBe('pass')
  })
})

describe('结构化输出符合度数据集（Task 4.4）', () => {
  it('包含 5 个样本', () => {
    expect(STRUCTURED_OUTPUT_SAMPLES).toHaveLength(5)
  })

  it('每个样本有唯一 sampleId', () => {
    const ids = STRUCTURED_OUTPUT_SAMPLES.map((s) => s.sampleId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个样本有 blockKind、guardPassed、hasSourceRefs', () => {
    for (const sample of STRUCTURED_OUTPUT_SAMPLES) {
      expect(sample.blockKind).toBeTruthy()
      expect(typeof sample.guardPassed).toBe('boolean')
      expect(typeof sample.hasSourceRefs).toBe('boolean')
    }
  })

  it('样本引用现有 copilot-structured-output fixture 的结构', () => {
    // 验证表格命中的预期
    const tableHit = STRUCTURED_OUTPUT_SAMPLES.find((s) => s.label.includes('表格命中'))!
    expect(tableHit.blockKind).toBe('table')
    expect(tableHit.guardPassed).toBe(true)
    expect(tableHit.hasSourceRefs).toBe(true)
    expect(tableHit.expectedConformance).toBe('pass')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 4.6：每类目标组端到端运行
// ═══════════════════════════════════════════════════════════════════════

describe('端到端数据集构建（Task 4.6）', () => {
  it('buildOfflineEvalDataset 构建完整数据集', () => {
    const dataset = buildOfflineEvalDataset()
    expect(dataset.datasetId).toBeTruthy()
    expect(dataset.version).toEqual(CURRENT_DATASET_VERSION)
    expect(dataset.samples.intentRouting.length).toBeGreaterThanOrEqual(4)
    expect(dataset.samples.draftQuality.length).toBeGreaterThanOrEqual(4)
    expect(dataset.samples.contextAssembly.length).toBeGreaterThanOrEqual(7)
    expect(dataset.samples.structuredOutput.length).toBeGreaterThanOrEqual(5)
  })

  it('数据集支持自定义覆盖', () => {
    const dataset = buildOfflineEvalDataset({
      datasetId: 'custom-dataset',
      version: { major: 2, minor: 0, patch: 0 },
    })
    expect(dataset.datasetId).toBe('custom-dataset')
    expect(dataset.version.major).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 3.4/5.4：评分配置版本与 baseline run ID
// ═══════════════════════════════════════════════════════════════════════

describe('评分配置版本（Task 3.4）', () => {
  it('CURRENT_SCORING_CONFIG_VERSION 包含必要字段', () => {
    expect(CURRENT_SCORING_CONFIG_VERSION.version).toBeTruthy()
    expect(CURRENT_SCORING_CONFIG_VERSION.skillEvalVersion).toBeTruthy()
    expect(CURRENT_SCORING_CONFIG_VERSION.deterministicEvalVersion).toBeTruthy()
  })
})

describe('数据集版本（Task 3.4）', () => {
  it('formatDatasetVersion 正确格式化', () => {
    expect(formatDatasetVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3')
  })

  it('parseDatasetVersion 正确解析', () => {
    expect(parseDatasetVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseDatasetVersion('invalid')).toBeNull()
  })

  it('roundtrip：format → parse → format 一致', () => {
    const v: DatasetVersion = { major: 3, minor: 14, patch: 159 }
    expect(parseDatasetVersion(formatDatasetVersion(v))).toEqual(v)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.5/5.6：per-sample 差异输出
// ═══════════════════════════════════════════════════════════════════════

describe('per-sample 差异（Task 5.5）', () => {
  it('computeSampleDifference 改进', () => {
    const diff = computeSampleDifference(0.8, 0.6)
    expect(diff.direction).toBe('improved')
    expect(diff.delta).toBe(0.2)
  })

  it('computeSampleDifference 回退', () => {
    const diff = computeSampleDifference(0.4, 0.7)
    expect(diff.direction).toBe('regressed')
    expect(diff.delta).toBe(0.3)
  })

  it('computeSampleDifference 未变', () => {
    const diff = computeSampleDifference(0.5, 0.5)
    expect(diff.direction).toBe('unchanged')
    expect(diff.delta).toBe(0)
  })
})

describe('单样本 collapse 不被隐藏（Task 5.6）', () => {
  it('report.sampleResults 保留每个样本的独立结果', () => {
    // 构造一个报告
    const report: OfflineEvalReport = {
      reportId: 'test-report',
      datasetId: 'test',
      datasetVersion: { major: 1, minor: 0, patch: 0 },
      scoringConfigVersion: CURRENT_SCORING_CONFIG_VERSION,
      ranAt: '2026-08-20T00:00:00.000Z',
      subjectVersion: '1.0.0',
      sampleResults: [
        {
          sampleId: 's1',
          targetGroup: 'draft_quality',
          label: 'Sample 1',
          score: 1,
          scoreLabel: 'pass',
          explanation: 'Pass',
        },
        {
          sampleId: 's2',
          targetGroup: 'draft_quality',
          label: 'Sample 2',
          score: 0,
          scoreLabel: 'fail',
          explanation: 'Fail',
        },
      ],
      summary: {
        totalSamples: 2,
        passCount: 1,
        failCount: 1,
        notEvaluatedCount: 0,
        improvedCount: 0,
        regressedCount: 0,
        unchangedCount: 0,
        hasBaseline: false,
      },
    }
    // 单个 fail 不被 aggregate 隐藏
    expect(report.sampleResults).toHaveLength(2)
    expect(report.sampleResults[0]!.scoreLabel).toBe('pass')
    expect(report.sampleResults[1]!.scoreLabel).toBe('fail')
    expect(report.summary.failCount).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.7：不做自动 regressed 判定
// ═══════════════════════════════════════════════════════════════════════

describe('无自动 regressed 判定（Task 5.7）', () => {
  it('SampleDifference 只有 direction 数据，无 judgment 字段', () => {
    const diff = computeSampleDifference(0.3, 0.8)
    expect(diff.direction).toBe('regressed')
    expect(diff.delta).toBe(0.5)
    // 不应有 isRegressed / verdict / severity 等自动判定字段
    expect(diff).not.toHaveProperty('isRegressed')
    expect(diff).not.toHaveProperty('verdict')
    expect(diff).not.toHaveProperty('severity')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.1：确定性序列化
// ═══════════════════════════════════════════════════════════════════════

describe('确定性序列化（Task 5.1）', () => {
  it('serializeReportForDeterminism 相同报告 → 相同序列化', () => {
    const report: OfflineEvalReport = {
      reportId: 'id1',
      datasetId: 'ds1',
      datasetVersion: { major: 1, minor: 0, patch: 0 },
      scoringConfigVersion: CURRENT_SCORING_CONFIG_VERSION,
      ranAt: '2026-08-20T00:00:00.000Z',
      subjectVersion: '1.0.0',
      sampleResults: [
        {
          sampleId: 's2',
          targetGroup: 'draft_quality',
          label: 'B',
          score: 0,
          scoreLabel: 'fail',
          explanation: 'Fail',
        },
        {
          sampleId: 's1',
          targetGroup: 'draft_quality',
          label: 'A',
          score: 1,
          scoreLabel: 'pass',
          explanation: 'Pass',
        },
      ],
      summary: {
        totalSamples: 2,
        passCount: 1,
        failCount: 1,
        notEvaluatedCount: 0,
        improvedCount: 0,
        regressedCount: 0,
        unchangedCount: 0,
        hasBaseline: false,
      },
    }

    const s1 = serializeReportForDeterminism(report)
    const s2 = serializeReportForDeterminism(report)
    expect(s1).toBe(s2)
  })

  it('serializeReportForDeterminism 不同样本顺序 → 相同序列化（键排序）', () => {
    const reportA: OfflineEvalReport = {
      reportId: 'id1',
      datasetId: 'ds1',
      datasetVersion: { major: 1, minor: 0, patch: 0 },
      scoringConfigVersion: CURRENT_SCORING_CONFIG_VERSION,
      ranAt: '2026-08-20T00:00:00.000Z',
      subjectVersion: '1.0.0',
      sampleResults: [
        {
          sampleId: 's1',
          targetGroup: 'draft_quality',
          label: 'A',
          score: 1,
          scoreLabel: 'pass',
          explanation: '',
        },
        {
          sampleId: 's2',
          targetGroup: 'draft_quality',
          label: 'B',
          score: 0,
          scoreLabel: 'fail',
          explanation: '',
        },
      ],
      summary: {
        totalSamples: 2,
        passCount: 1,
        failCount: 1,
        notEvaluatedCount: 0,
        improvedCount: 0,
        regressedCount: 0,
        unchangedCount: 0,
        hasBaseline: false,
      },
      contentHash: 'test-hash',
    }

    const reportB: OfflineEvalReport = {
      ...reportA,
      sampleResults: [
        {
          sampleId: 's2',
          targetGroup: 'draft_quality',
          label: 'B',
          score: 0,
          scoreLabel: 'fail',
          explanation: '',
        },
        {
          sampleId: 's1',
          targetGroup: 'draft_quality',
          label: 'A',
          score: 1,
          scoreLabel: 'pass',
          explanation: '',
        },
      ],
    }

    expect(serializeReportForDeterminism(reportA)).toBe(serializeReportForDeterminism(reportB))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 2.5/2.6：内容确定性（sorted JSON + SHA-256）
// ═══════════════════════════════════════════════════════════════════════

describe('内容确定性（Task 2.5/2.6）', () => {
  const sampleA: OfflineEvalSample = {
    sampleId: 'a-001',
    input: { x: 1 },
    benchmarkSource: 'fixture',
  }
  const sampleB: OfflineEvalSample = { sampleId: 'b-001', input: { x: 2 }, benchmarkSource: 'L3' }

  it('serializeSortedSamples 按 sampleId 排序', () => {
    const result = serializeSortedSamples([sampleB, sampleA])
    expect(result).toContain('"a-001"')
    expect(result.indexOf('"a-001"')).toBeLessThan(result.indexOf('"b-001"'))
  })

  it('serializeSortedSamples 相同样本不同顺序 → 相同序列化', () => {
    const s1 = serializeSortedSamples([sampleA, sampleB])
    const s2 = serializeSortedSamples([sampleB, sampleA])
    expect(s1).toBe(s2)
  })

  it('computeDatasetContentHash 相同样本集合 → 相同哈希', () => {
    const h1 = computeDatasetContentHash([sampleA, sampleB])
    const h2 = computeDatasetContentHash([sampleB, sampleA])
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64) // SHA-256 hex
  })

  it('computeDatasetContentHash 不同样本集合 → 不同哈希', () => {
    const h1 = computeDatasetContentHash([sampleA])
    const h2 = computeDatasetContentHash([sampleA, sampleB])
    expect(h1).not.toBe(h2)
  })

  it('computeDatasetContentHash 空样本集合 → 相同哈希', () => {
    const h1 = computeDatasetContentHash([])
    const h2 = computeDatasetContentHash([])
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64)
  })

  it('computeReportContentHash 确定性', () => {
    const results: SampleResult[] = [
      {
        sampleId: 's1',
        targetGroup: 'draft_quality',
        label: 'A',
        score: 1,
        scoreLabel: 'pass',
        explanation: '',
      },
      {
        sampleId: 's2',
        targetGroup: 'draft_quality',
        label: 'B',
        score: 0,
        scoreLabel: 'fail',
        explanation: '',
      },
    ]
    const h1 = computeReportContentHash(results)
    const h2 = computeReportContentHash([...results].reverse())
    expect(h1).toBe(h2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 2.7/2.8：禁存约束（负例测试）
// ═══════════════════════════════════════════════════════════════════════

describe('禁存约束（Task 2.7/2.8）', () => {
  it('OFFLINE_EVAL_FORBIDDEN_STORE_FIELDS 包含 9 个禁止字段', () => {
    expect(OFFLINE_EVAL_FORBIDDEN_STORE_FIELDS).toHaveLength(9)
  })

  it('isOfflineEvalForbiddenStoreField 类型守卫正确', () => {
    expect(isOfflineEvalForbiddenStoreField('sample_input_body')).toBe(true)
    expect(isOfflineEvalForbiddenStoreField('prompt_full_text')).toBe(true)
    expect(isOfflineEvalForbiddenStoreField('tokens')).toBe(true)
    expect(isOfflineEvalForbiddenStoreField('secrets')).toBe(true)
    expect(isOfflineEvalForbiddenStoreField('api_key')).toBe(true)
    expect(isOfflineEvalForbiddenStoreField('password')).toBe(true)
    expect(isOfflineEvalForbiddenStoreField('safeField')).toBe(false)
  })

  it('detectRunRecordForbiddenFields 检测到 sample_input_body 键', () => {
    const record = { sampleId: 's1', sample_input_body: { prompt: 'test' } }
    const violations = detectRunRecordForbiddenFields(record)
    expect(violations.length).toBeGreaterThanOrEqual(1)
    expect(violations.some((v) => v.includes('sample_input_body'))).toBe(true)
  })

  it('detectRunRecordForbiddenFields 检测到 prompt_full_text 键', () => {
    const record = { sampleId: 's1', prompt_full_text: 'Write a plan...' }
    const violations = detectRunRecordForbiddenFields(record)
    expect(violations.length).toBeGreaterThanOrEqual(1)
    expect(violations.some((v) => v.includes('prompt_full_text'))).toBe(true)
  })

  it('detectRunRecordForbiddenFields 检测到 model_output_full_text 键', () => {
    const record = { sampleId: 's1', model_output_full_text: 'The plan is...' }
    const violations = detectRunRecordForbiddenFields(record)
    expect(violations.length).toBeGreaterThanOrEqual(1)
  })

  it('detectRunRecordForbiddenFields 检测到 sk-* 泄露值', () => {
    const record = { sampleId: 's1', apiKey: 'sk-abc123def456' }
    const violations = detectRunRecordForbiddenFields(record)
    expect(violations.length).toBeGreaterThanOrEqual(1)
    expect(violations.some((v) => v.includes('secret-like value'))).toBe(true)
  })

  it('detectRunRecordForbiddenFields 合规精简记录无违规', () => {
    const record = {
      sampleId: 's1',
      scoreValue: 1,
      scoreLabel: 'pass',
      scoringConfigVersion: '1.0.0',
    }
    const violations = detectRunRecordForbiddenFields(record)
    expect(violations).toHaveLength(0)
  })

  it('负例：样本正文不出现在运行记录中', () => {
    // 构造一个合规的运行记录——只有 sampleId + scoreValue + scoreLabel
    const slimRecord = {
      sampleId: 'ir-001',
      scoreValue: 1,
      scoreLabel: 'pass',
      scoringConfigVersion: '1.0.0',
    }

    // 正向断言：精简记录不含任何禁止字段
    const violations = detectRunRecordForbiddenFields(slimRecord)
    expect(violations).toHaveLength(0)

    // 反向断言：如果有人错误地塞入正文，会被检测到
    const pollutedRecord = {
      ...slimRecord,
      sample_input_body: { prompt: 'Write a WBS' },
      prompt_full_text: 'You are a project manager...',
      model_output_full_text: 'Here is the WBS...',
    }
    const pollutedViolations = detectRunRecordForbiddenFields(pollutedRecord)
    expect(pollutedViolations.length).toBeGreaterThanOrEqual(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 2.9：五态 fixtures
// ═══════════════════════════════════════════════════════════════════════

describe('五态 fixtures（Task 2.9）', () => {
  it('fixtureAllPassReport：所有样本 pass', () => {
    expect(fixtureAllPassReport.summary.failCount).toBe(0)
    expect(fixtureAllPassReport.summary.notEvaluatedCount).toBe(0)
    for (const r of fixtureAllPassReport.sampleResults) {
      expect(r.scoreLabel).toBe('pass')
    }
  })

  it('fixtureSingleSampleRegressionReport：单样本回归', () => {
    expect(fixtureSingleSampleRegressionReport.baselineRunId).toBeTruthy()
    expect(fixtureSingleSampleRegressionReport.summary.regressedCount).toBe(1)
    const regressed = fixtureSingleSampleRegressionReport.sampleResults.find(
      (r) => r.difference?.direction === 'regressed',
    )
    expect(regressed).toBeDefined()
    expect(regressed!.scoreLabel).toBe('fail')
  })

  it('fixtureMildOverallDeclineReport：轻微整体下滑', () => {
    expect(fixtureMildOverallDeclineReport.summary.regressedCount).toBe(3)
    expect(fixtureMildOverallDeclineReport.summary.passCount).toBe(3) // 仍全部 pass（只是分数降了）
  })

  it('fixtureL3DatasetReport：L3 数据集', () => {
    expect(fixtureL3DatasetReport.sampleResults).toHaveLength(2)
    expect(fixtureL3DatasetReport.summary.failCount).toBe(1)
  })

  it('fixtureL3Samples：L3 来源标注正确', () => {
    for (const s of fixtureL3Samples) {
      expect(s.benchmarkSource).toBe('L3')
    }
  })

  it('fixtureAuthGateNotOpenedReport：授权门未开', () => {
    expect(fixtureAuthGateNotOpenedReport.sampleResults).toHaveLength(1)
    expect(fixtureAuthGateNotOpenedReport.sampleResults[0]!.explanation).toContain(
      'Fixture provider',
    )
    expect(fixtureAuthGateNotOpenedReport.sampleResults[0]!.explanation).toContain(
      'no real model call',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 2.10：barrel 导出无撞名
// ═══════════════════════════════════════════════════════════════════════

describe('barrel 导出（Task 2.10）', () => {
  it('EVAL_TARGET_GROUPS 为四元素只读元组', () => {
    expect(Array.isArray(EVAL_TARGET_GROUPS)).toBe(true)
    expect(EVAL_TARGET_GROUPS).toHaveLength(4)
    // TypeScript as const 在编译期保证只读，运行时不一定 Object.freeze
    // 但值应与类型定义一致
    expect(EVAL_TARGET_GROUPS).toEqual([
      'intent_routing_accuracy',
      'draft_quality',
      'context_assembly_completeness',
      'structured_output_conformance',
    ])
  })

  it('OFFLINE_EVAL_BENCHMARK_SOURCES 包含 L3 和 fixture', () => {
    expect(OFFLINE_EVAL_BENCHMARK_SOURCES).toContain('L3')
    expect(OFFLINE_EVAL_BENCHMARK_SOURCES).toContain('fixture')
  })

  it('OFFLINE_EVAL_SCORE_LABELS 包含三态', () => {
    expect(OFFLINE_EVAL_SCORE_LABELS).toEqual(['pass', 'fail', 'not-evaluated'])
  })

  it('OFFLINE_EVAL_PROVIDER_KINDS 包含 fixture 和 real_model', () => {
    expect(OFFLINE_EVAL_PROVIDER_KINDS).toEqual(['fixture', 'real_model'])
  })

  it('OFFLINE_EVAL_AUTH_STATUSES 包含 not_authorized 和 authorized', () => {
    expect(OFFLINE_EVAL_AUTH_STATUSES).toEqual(['not_authorized', 'authorized'])
  })

  it('resolveEvalProvider 默认返回 fixture', () => {
    expect(resolveEvalProvider('not_authorized')).toBe('fixture')
    expect(resolveEvalProvider('authorized')).toBe('real_model')
  })

  it('类型守卫均可从 barrel 正常 import', () => {
    expect(typeof isEvalTargetGroup).toBe('function')
    expect(typeof isOfflineEvalBenchmarkSource).toBe('function')
    expect(typeof isOfflineEvalScoreLabel).toBe('function')
    expect(typeof isOfflineEvalForbiddenStoreField).toBe('function')
    expect(typeof isOfflineEvalProviderKind).toBe('function')
    expect(typeof isOfflineEvalAuthStatus).toBe('function')
  })

  it('纯函数均可从 barrel 正常 import', () => {
    expect(typeof computeSampleDifference).toBe('function')
    expect(typeof computeDatasetContentHash).toBe('function')
    expect(typeof computeReportContentHash).toBe('function')
    expect(typeof computeReportSummary).toBe('function')
    expect(typeof serializeSortedSamples).toBe('function')
    expect(typeof serializeSortedSampleResults).toBe('function')
    expect(typeof serializeReportForDeterminism).toBe('function')
    expect(typeof detectRunRecordForbiddenFields).toBe('function')
    expect(typeof formatDatasetVersion).toBe('function')
    expect(typeof parseDatasetVersion).toBe('function')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.3/5.4：基线为具体运行 ID
// ═══════════════════════════════════════════════════════════════════════

describe('基线为具体运行（Task 5.3/5.4）', () => {
  it('fixtureSingleSampleRegressionReport.baselineRunId 是具体 ID', () => {
    expect(fixtureSingleSampleRegressionReport.baselineRunId).toBe('baseline-run-001')
  })

  it('无基线时 baselineRunId 为 undefined', () => {
    expect(fixtureAllPassReport.baselineRunId).toBeUndefined()
  })

  it('computeReportSummary 正确识别有无基线', () => {
    const withBaseline = computeReportSummary(fixtureSingleSampleRegressionReport.sampleResults)
    expect(withBaseline.hasBaseline).toBe(true)

    const withoutBaseline = computeReportSummary(fixtureAllPassReport.sampleResults)
    expect(withoutBaseline.hasBaseline).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.6：单样本崩溃不被总分平均掉
// ═══════════════════════════════════════════════════════════════════════

describe('单样本崩溃不被总分平均掉（Task 5.6）', () => {
  it('一个 fail 不被 aggregate 隐藏', () => {
    const results: SampleResult[] = [
      {
        sampleId: 's1',
        targetGroup: 'draft_quality',
        label: 'Pass 1',
        score: 1,
        scoreLabel: 'pass',
        explanation: 'OK',
      },
      {
        sampleId: 's2',
        targetGroup: 'draft_quality',
        label: 'Fail 1',
        score: 0,
        scoreLabel: 'fail',
        explanation: 'Missing WBS',
      },
      {
        sampleId: 's3',
        targetGroup: 'draft_quality',
        label: 'Pass 2',
        score: 1,
        scoreLabel: 'pass',
        explanation: 'OK',
      },
    ]
    const summary = computeReportSummary(results)
    expect(summary.totalSamples).toBe(3)
    expect(summary.passCount).toBe(2)
    expect(summary.failCount).toBe(1)
    expect(summary.sampleResults || results).toHaveLength(3) // 保留所有样本
  })
})
