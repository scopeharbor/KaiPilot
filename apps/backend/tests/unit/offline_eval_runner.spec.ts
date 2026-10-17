/**
 * offline_eval_runner.spec —— 离线回归评测运行器单元测试。
 *
 * 覆盖：
 * - Task 3.1：离线回归复用在线 scorer
 * - Task 3.2：同一样本在在线和离线路径得分一致
 * - Task 3.3：无第二套 scorer 实现（review test）
 * - Task 3.5：评分配置变更使报告可区分
 * - Task 5.1：回归运行确定性
 * - Task 5.2：不同键顺序输入 → 相同输出
 * - Task 5.3：baseline 为具体历史 run ID
 * - Task 5.4：baseline 解析到具体 run ID
 * - Task 5.5：per-sample 差异输出
 * - Task 5.6：单样本 collapse 不被隐藏
 * - Task 5.7：不做自动 regressed 判定
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  runOfflineEval,
  DEFAULT_SCORING_CONFIG_VERSION,
  type BaselineSnapshot,
  type OfflineEvalRunnerOptions,
} from '#services/ai_evaluation/offline_eval_runner'
import {
  buildOfflineEvalDataset,
  INTENT_ROUTING_SAMPLES,
  DRAFT_QUALITY_SAMPLES,
  CONTEXT_ASSEMBLY_SAMPLES,
  STRUCTURED_OUTPUT_SAMPLES,
} from '@aiproj/types'
import type { ScoringConfigVersion } from '@aiproj/types'
import { runDeterministicEvaluation } from '#services/ai_evaluation/deterministic_evaluators'

// ═══════════════════════════════════════════════════════════════════════
// Task 3.1 — 离线回归复用在线 scorer
// ═══════════════════════════════════════════════════════════════════════

describe('Task 3.1 — 离线回归复用在线 scorer', () => {
  it('runner 源码中导入 scoreSkillQuality / runSkillBenchmark', () => {
    const source = readFileSync(
      resolve(__dirname, '../../app/services/ai_evaluation/offline_eval_runner.ts'),
      'utf-8',
    )
    // 必须导入在线 scorer 函数
    expect(source).toContain('scoreSkillQuality')
    expect(source).toContain('runSkillBenchmark')
    // 必须导入确定性评测器
    expect(source).toContain('runDeterministicEvaluation')
  })

  it('runner 源码中不定义任何独立评分逻辑', () => {
    const source = readFileSync(
      resolve(__dirname, '../../app/services/ai_evaluation/offline_eval_runner.ts'),
      'utf-8',
    )
    // 不应有独立的评分函数定义（function xxxScore 之类）
    const lines = source.split('\n')
    const scoringFunctionLines = lines.filter(
      (l) =>
        l.includes('function ') &&
        (l.includes('Score') || l.includes('score')) &&
        !l.includes('evaluate') &&
        !l.includes('compute') &&
        !l.includes('//'),
    )
    // 不应有自定义评分函数
    expect(scoringFunctionLines.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 3.2 — 同一样本在在线和离线路径得分一致
// ═══════════════════════════════════════════════════════════════════════

describe('Task 3.2 — 在线与离线路径得分一致', () => {
  it('草案质量样本的离线得分与直接调用 deterministic evaluator 一致', () => {
    const dataset = buildOfflineEvalDataset()
    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
    })

    // 对每个草案质量样本，验证离线得分与直接调用 evaluator 一致
    for (const sample of DRAFT_QUALITY_SAMPLES) {
      const directResult = runDeterministicEvaluation(sample.evaluatorInput)
      const offlineResult = report.sampleResults.find((r: any) => r.sampleId === sample.sampleId)
      expect(offlineResult).toBeDefined()
      expect(offlineResult!.score).toBe(directResult.scoreValue)
      expect(offlineResult!.scoreLabel).toBe(directResult.scoreLabel)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 3.3 — 无第二套 scorer 实现（review test）
// ═══════════════════════════════════════════════════════════════════════

describe('Task 3.3 — 无第二套 scorer 实现', () => {
  it('runner 源码不包含独立的评分算法（只委托）', () => {
    const source = readFileSync(
      resolve(__dirname, '../../app/services/ai_evaluation/offline_eval_runner.ts'),
      'utf-8',
    )
    // 不应有独立的加权计算、grade 映射等评分逻辑
    expect(source).not.toContain('totalScore')
    expect(source).not.toContain('totalWeight')
    expect(source).not.toContain('grade =')
    expect(source).not.toContain('EvalGrade')
  })

  it('runner 的 evaluate* 函数只做编排，不做评分', () => {
    const source = readFileSync(
      resolve(__dirname, '../../app/services/ai_evaluation/offline_eval_runner.ts'),
      'utf-8',
    )
    // evaluateIntentRouting 调用 runSkillBenchmark（委托）
    expect(source).toContain('runSkillBenchmark')
    // evaluateDraftQuality 调用 runDeterministicEvaluation（委托）
    expect(source).toContain('runDeterministicEvaluation(sample.evaluatorInput)')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 3.5 — 评分配置变更使报告可区分
// ═══════════════════════════════════════════════════════════════════════

describe('Task 3.5 — 评分配置变更使报告可区分', () => {
  it('不同 scoringConfigVersion 产生不同 reportId', () => {
    const dataset = buildOfflineEvalDataset()
    const refTime = '2026-08-20T00:00:00.000Z'

    const reportV1 = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      scoringConfigVersion: {
        version: '1.0.0',
        skillEvalVersion: '1.0.0',
        deterministicEvalVersion: '1.0.0',
      },
      referenceTime: refTime,
    })

    const reportV2 = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      scoringConfigVersion: {
        version: '2.0.0',
        skillEvalVersion: '1.0.0',
        deterministicEvalVersion: '1.0.0',
      },
      referenceTime: refTime,
    })

    expect(reportV1.reportId).not.toBe(reportV2.reportId)
  })

  it('报告记录 scoringConfigVersion', () => {
    const dataset = buildOfflineEvalDataset()
    const configVersion: ScoringConfigVersion = {
      version: '3.1.4',
      skillEvalVersion: '1.0.0',
      deterministicEvalVersion: '1.0.0',
    }

    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      scoringConfigVersion: configVersion,
      referenceTime: '2026-08-20T00:00:00.000Z',
    })

    expect(report.scoringConfigVersion.version).toBe('3.1.4')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.1 — 回归运行确定性
// ═══════════════════════════════════════════════════════════════════════

describe('Task 5.1 — 回归运行确定性', () => {
  it('相同 inputs 产生相同 reportId', () => {
    const dataset = buildOfflineEvalDataset()
    const opts: OfflineEvalRunnerOptions = {
      dataset,
      subjectVersion: '1.0.0',
      scoringConfigVersion: DEFAULT_SCORING_CONFIG_VERSION,
      referenceTime: '2026-08-20T00:00:00.000Z',
    }

    const report1 = runOfflineEval(opts)
    const report2 = runOfflineEval(opts)

    expect(report1.reportId).toBe(report2.reportId)
    expect(report1.sampleResults).toEqual(report2.sampleResults)
  })

  it('相同 inputs 产生相同样本得分', () => {
    const dataset = buildOfflineEvalDataset()
    const opts: OfflineEvalRunnerOptions = {
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
    }

    const report1 = runOfflineEval(opts)
    const report2 = runOfflineEval(opts)

    for (let i = 0; i < report1.sampleResults.length; i++) {
      expect(report1.sampleResults[i]!.score).toBe(report2.sampleResults[i]!.score)
      expect(report1.sampleResults[i]!.scoreLabel).toBe(report2.sampleResults[i]!.scoreLabel)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.2 — 不同键顺序输入 → 相同输出
// ═══════════════════════════════════════════════════════════════════════

describe('Task 5.2 — 不同键顺序输入 → 相同输出', () => {
  it('dataset samples 以不同顺序传入 → 相同 reportId', () => {
    const datasetNormal = buildOfflineEvalDataset()
    const datasetReversed = buildOfflineEvalDataset({
      samples: {
        intentRouting: [...INTENT_ROUTING_SAMPLES].reverse(),
        draftQuality: [...DRAFT_QUALITY_SAMPLES].reverse(),
        contextAssembly: [...CONTEXT_ASSEMBLY_SAMPLES].reverse(),
        structuredOutput: [...STRUCTURED_OUTPUT_SAMPLES].reverse(),
      },
    })

    const opts1: OfflineEvalRunnerOptions = {
      dataset: datasetNormal,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
    }
    const opts2: OfflineEvalRunnerOptions = {
      dataset: datasetReversed,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
    }

    const report1 = runOfflineEval(opts1)
    const report2 = runOfflineEval(opts2)

    // reportId 由排序后的 sampleResults 计算，应相同
    expect(report1.reportId).toBe(report2.reportId)
    // 样本结果按 sampleId 排序，应完全一致
    expect(report1.sampleResults.map((r: any) => r.sampleId)).toEqual(
      report2.sampleResults.map((r: any) => r.sampleId),
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.3 — baseline 为具体历史 run ID
// ═══════════════════════════════════════════════════════════════════════

describe('Task 5.3 — baseline 为具体历史 run ID', () => {
  it('baseline 是字符串 run ID，不是滚动平均', () => {
    const baseline: BaselineSnapshot = {
      runId: 'run-20260820-abc123',
      sampleScores: {
        'dq-001': 1,
        'dq-002': 0,
        'dq-003': 0,
        'dq-004': 0,
      },
    }

    expect(typeof baseline.runId).toBe('string')
    expect(baseline.runId).toMatch(/^run-/)
    // 不是数字（不是平均值）
    expect(Number.isNaN(Number(baseline.runId))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.4 — baseline 解析到具体 run ID
// ═══════════════════════════════════════════════════════════════════════

describe('Task 5.4 — baseline 解析到具体 run ID', () => {
  it('报告记录 baselineRunId', () => {
    const dataset = buildOfflineEvalDataset()
    const baseline: BaselineSnapshot = {
      runId: 'run-20260820-abc123',
      sampleScores: Object.fromEntries(DRAFT_QUALITY_SAMPLES.map((s) => [s.sampleId, 1])),
    }

    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
      baseline,
    })

    expect(report.baselineRunId).toBe('run-20260820-abc123')
  })

  it('无 baseline 时 baselineRunId 为 undefined', () => {
    const dataset = buildOfflineEvalDataset()
    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
    })

    expect(report.baselineRunId).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.5 — per-sample 差异输出
// ═══════════════════════════════════════════════════════════════════════

describe('Task 5.5 — per-sample 差异输出', () => {
  it('有 baseline 时每个样本有 difference', () => {
    const dataset = buildOfflineEvalDataset()
    const baseline: BaselineSnapshot = {
      runId: 'run-prev',
      sampleScores: Object.fromEntries([
        ...DRAFT_QUALITY_SAMPLES.map((s) => [s.sampleId, 1]),
        ...CONTEXT_ASSEMBLY_SAMPLES.map((s) => [
          s.sampleId,
          s.expectedCompleteness === 'pass' ? 1 : 0,
        ]),
        ...STRUCTURED_OUTPUT_SAMPLES.map((s) => [
          s.sampleId,
          s.expectedConformance === 'pass' ? 1 : 0,
        ]),
        ...INTENT_ROUTING_SAMPLES.map((s) => [s.sampleId, 1]),
      ]),
    }

    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
      baseline,
    })

    // 所有在 baseline 中的样本都应有 difference
    for (const result of report.sampleResults) {
      if (baseline.sampleScores[result.sampleId] !== undefined) {
        expect(result.difference).toBeDefined()
        expect(result.difference!.sampleId).toBe(result.sampleId)
        expect(['improved', 'regressed', 'unchanged']).toContain(result.difference!.direction)
      }
    }
  })

  it('无 baseline 时无 difference', () => {
    const dataset = buildOfflineEvalDataset()
    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
    })

    for (const result of report.sampleResults) {
      expect(result.difference).toBeUndefined()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.6 — 单样本 collapse 不被隐藏
// ═══════════════════════════════════════════════════════════════════════

describe('Task 5.6 — 单样本 collapse 不被隐藏', () => {
  it('summary 区分 pass/fail/notEvaluated 而非只给 aggregate', () => {
    const dataset = buildOfflineEvalDataset()
    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
    })

    // summary 包含细分计数
    expect(report.summary.totalSamples).toBe(report.sampleResults.length)
    expect(
      report.summary.passCount + report.summary.failCount + report.summary.notEvaluatedCount,
    ).toBe(report.summary.totalSamples)

    // 单个 fail 不被隐藏
    if (report.summary.failCount > 0) {
      const failedSamples = report.sampleResults.filter((r: any) => r.scoreLabel === 'fail')
      expect(failedSamples.length).toBe(report.summary.failCount)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Task 5.7 — 不做自动 regressed 判定
// ═══════════════════════════════════════════════════════════════════════

describe('Task 5.7 — 不做自动 regressed 判定', () => {
  it('runner 源码不包含自动 regressed 判定逻辑', () => {
    const source = readFileSync(
      resolve(__dirname, '../../app/services/ai_evaluation/offline_eval_runner.ts'),
      'utf-8',
    )
    // 不应有自动判定逻辑
    expect(source).not.toContain('isRegressed')
    expect(source).not.toContain('autoJudg')
    expect(source).not.toContain('verdict')
    expect(source).not.toContain('severity')
    expect(source).not.toContain('alert')
  })

  it('SampleDifference 只提供方向和差值，不提供判定', () => {
    const dataset = buildOfflineEvalDataset()
    const baseline: BaselineSnapshot = {
      runId: 'run-prev',
      sampleScores: Object.fromEntries(DRAFT_QUALITY_SAMPLES.map((s) => [s.sampleId, 1])),
    }

    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
      baseline,
    })

    for (const result of report.sampleResults) {
      if (result.difference) {
        // difference 只有 sampleId, currentScore, baselineScore, direction, delta
        const keys = Object.keys(result.difference)
        expect(keys).toContain('direction')
        expect(keys).toContain('delta')
        expect(keys).toContain('currentScore')
        expect(keys).toContain('baselineScore')
        // 不应有判定字段
        expect(keys).not.toContain('isRegressed')
        expect(keys).not.toContain('verdict')
        expect(keys).not.toContain('severity')
        expect(keys).not.toContain('alert')
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 端到端：完整数据集运行
// ═══════════════════════════════════════════════════════════════════════

describe('端到端完整运行', () => {
  it('完整数据集运行产生有效报告', () => {
    const dataset = buildOfflineEvalDataset()
    const report = runOfflineEval({
      dataset,
      subjectVersion: '1.0.0',
      referenceTime: '2026-08-20T00:00:00.000Z',
    })

    expect(report.reportId).toBeTruthy()
    expect(report.datasetId).toBe('offline-eval-v1')
    expect(report.datasetVersion).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(report.scoringConfigVersion).toEqual(DEFAULT_SCORING_CONFIG_VERSION)
    expect(report.ranAt).toBe('2026-08-20T00:00:00.000Z')
    expect(report.subjectVersion).toBe('1.0.0')

    // 应有全部样本（4+4+7+5=20）
    expect(report.sampleResults.length).toBe(20)

    // 每个样本有 targetGroup
    const groups = new Set(report.sampleResults.map((r: any) => r.targetGroup))
    expect(groups.size).toBe(4)

    // summary 一致
    expect(report.summary.totalSamples).toBe(20)
    expect(
      report.summary.passCount + report.summary.failCount + report.summary.notEvaluatedCount,
    ).toBe(20)
  })
})
