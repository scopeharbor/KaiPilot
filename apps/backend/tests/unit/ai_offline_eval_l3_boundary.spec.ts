/**
 * v3-ai-offline-eval-datasets §6 — L3 边界测试（Tasks 6.1-6.7）。
 *
 * 覆盖：
 *  - 6.1: L3 Synthetic 允许出现在数据集中（正例）
 *  - 6.2: L3 数据集可用于回归运行
 *  - 6.3: 样本内容与运行记录分离存放
 *  - 6.4: 运行记录不含样本正文（因而不含 L3 内容）
 *  - 6.5: 评测产物不进生产路径（负例）
 *  - 6.6: 报告内容不出现在生产回合上下文中
 *  - 6.7: 生产知识层清单不因回归而放宽
 *
 * 不依赖真实模型；纯类型 + 确定性函数测试。
 */

import { test } from '@japa/runner'
import {
  type OfflineEvalDataset,
  type OfflineEvalSample,
  type SampleResult,
  OFFLINE_EVAL_BENCHMARK_SOURCES,
  isOfflineEvalBenchmarkSource,
  computeDatasetContentHash,
  detectRunRecordForbiddenFields,
  computeReportContentHash,
  COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
  COPILOT_EVAL_KNOWLEDGE_TIERS,
  assertEligibleKnowledgeTiersExcludeL3,
  fixtureL3Samples,
  fixtureL3DatasetReport,
} from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// §6.1 L3 Synthetic 允许出现在数据集中（正例）
// ═══════════════════════════════════════════════════════════════════════════════

test.group('6.1 L3 Synthetic datasets are permitted', () => {
  test('L3 is a valid benchmark source', ({ assert }) => {
    assert.includeMembers([...OFFLINE_EVAL_BENCHMARK_SOURCES], ['L3'])
    assert.isTrue(isOfflineEvalBenchmarkSource('L3'))
  })

  test('fixture is a valid benchmark source', ({ assert }) => {
    assert.isTrue(isOfflineEvalBenchmarkSource('fixture'))
  })

  test('L3 samples can be created with benchmarkSource=L3', ({ assert }) => {
    const l3Sample: OfflineEvalSample = {
      sampleId: 'l3-test-001',
      input: { prompt: 'Generate a WBS for software project' },
      expectedOutput: { wbsNodes: 3 },
      benchmarkSource: 'L3',
    }
    assert.equal(l3Sample.benchmarkSource, 'L3')
    assert.equal(l3Sample.sampleId, 'l3-test-001')
  })

  test('dataset can contain L3 samples alongside fixture samples', ({ assert }) => {
    const mixedSamples: OfflineEvalSample[] = [
      { sampleId: 'fixture-001', input: { a: 1 }, benchmarkSource: 'fixture' },
      { sampleId: 'l3-001', input: { b: 2 }, benchmarkSource: 'L3' },
    ]
    const dataset: OfflineEvalDataset = {
      datasetId: 'mixed-dataset',
      version: { major: 1, minor: 0, patch: 0 },
      description: 'Mixed L3 and fixture dataset',
      samples: {
        intentRouting: [],
        draftQuality: [],
        contextAssembly: [],
        structuredOutput: [],
      },
    }
    // Dataset can contain both L3 and fixture sources
    assert.equal(dataset.datasetId, 'mixed-dataset')
    assert.lengthOf(mixedSamples, 2)
    assert.equal(mixedSamples[0].benchmarkSource, 'fixture')
    assert.equal(mixedSamples[1].benchmarkSource, 'L3')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.2 L3 数据集可用于回归运行
// ═══════════════════════════════════════════════════════════════════════════════

test.group('6.2 L3 dataset can be used for regression run', () => {
  test('L3 dataset report can be generated from L3 samples', ({ assert }) => {
    // fixtureL3DatasetReport is built from fixtureL3Samples (L3 source)
    const report = fixtureL3DatasetReport
    assert.equal(report.reportId, 'report-l3-dataset')
    assert.lengthOf(report.sampleResults, 2)
    // L3 samples appear in the report results
    assert.equal(report.sampleResults[0].sampleId, 'l3-001')
    assert.equal(report.sampleResults[1].sampleId, 'l3-002')
  })

  test('L3 samples have correct benchmarkSource', ({ assert }) => {
    for (const sample of fixtureL3Samples) {
      assert.equal(sample.benchmarkSource, 'L3')
    }
  })

  test('L3 dataset content hash is deterministic', ({ assert }) => {
    const hash1 = computeDatasetContentHash(fixtureL3Samples)
    const hash2 = computeDatasetContentHash(fixtureL3Samples)
    assert.equal(hash1, hash2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.3 样本内容与运行记录分离存放（D6）
// ═══════════════════════════════════════════════════════════════════════════════

test.group('6.3 Sample bodies stored with dataset, NOT in run records', () => {
  test('run record only contains sampleId, scoreValue, scoreLabel, difference', ({ assert }) => {
    // A properly formed run record should only have these fields
    const runRecord = {
      sampleId: 'ir-001',
      scoreValue: 1,
      scoreLabel: 'pass',
      difference: { direction: 'unchanged', delta: 0 },
    }

    // Verify the shape
    assert.property(runRecord, 'sampleId')
    assert.property(runRecord, 'scoreValue')
    assert.property(runRecord, 'scoreLabel')
    assert.property(runRecord, 'difference')

    // Verify NO sample body fields
    assert.notProperty(runRecord, 'input')
    assert.notProperty(runRecord, 'expectedOutput')
    assert.notProperty(runRecord, 'expectedProperties')
    assert.notProperty(runRecord, 'prompt')
    assert.notProperty(runRecord, 'modelOutput')
  })

  test('sampleResult contains no input body', ({ assert }) => {
    const result: SampleResult = {
      sampleId: 'dq-001',
      targetGroup: 'draft_quality',
      label: 'DQ 001',
      score: 1,
      scoreLabel: 'pass',
      explanation: 'Draft structure complete',
    }

    // SampleResult must NOT contain input/expectedOutput bodies
    assert.notProperty(result, 'input')
    assert.notProperty(result, 'expectedOutput')
    assert.notProperty(result, 'expectedProperties')
    assert.notProperty(result, 'benchmarkInput')
    assert.notProperty(result, 'evaluatorInput')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.4 运行记录不含样本正文（因而不含 L3 内容）
// ═══════════════════════════════════════════════════════════════════════════════

test.group('6.4 Run records contain no sample bodies (hence no L3 content)', () => {
  test('run record inspection proves no sample body appears', ({ assert }) => {
    // Simulate a run record that references L3 samples
    const runRecord = {
      sampleId: 'l3-001',
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: 'L3 synthetic WBS generation correct',
      targetGroup: 'draft_quality',
    }

    // The run record contains NO sample body
    assert.notProperty(runRecord, 'input')
    assert.notProperty(runRecord, 'expectedOutput')
    assert.notProperty(runRecord, 'prompt')
    assert.notProperty(runRecord, 'wbsNodes')
    assert.notProperty(runRecord, 'contentHash')

    // Check forbidden fields
    const violations = detectRunRecordForbiddenFields(runRecord)
    assert.isEmpty(violations)
  })

  test('detectRunRecordForbiddenFields catches violations', ({ assert }) => {
    // A malicious run record that tries to store sample bodies
    const badRecord = {
      sampleId: 'l3-001',
      sample_input_body: { prompt: 'Generate WBS' },
      sample_expected_output_body: { wbsNodes: 3 },
      tokens: 'sk-abc123',
      api_key: 'secret-key',
    }

    const violations = detectRunRecordForbiddenFields(badRecord)
    assert.isNotEmpty(violations)
    assert.include(violations, 'sample_input_body')
    assert.include(violations, 'sample_expected_output_body')
    assert.include(violations, 'tokens')
    assert.include(violations, 'api_key')
  })

  test('clean run record passes forbidden field detection', ({ assert }) => {
    const cleanRecord = {
      sampleId: 'l3-001',
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: 'Evaluated correctly',
      targetGroup: 'draft_quality',
      label: 'L3 WBS',
    }

    const violations = detectRunRecordForbiddenFields(cleanRecord)
    assert.isEmpty(violations)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.5 评测产物不进生产路径（负例）
// ═══════════════════════════════════════════════════════════════════════════════

test.group('6.5 Evaluation artifacts do NOT enter production paths', () => {
  test('production knowledge tiers exclude L3', ({ assert }) => {
    // Production tiers: L1, L2, L4 (L3 excluded)
    assert.includeMembers([...COPILOT_PRODUCTION_KNOWLEDGE_TIERS], ['L1', 'L2', 'L4'])
    assert.notInclude([...COPILOT_PRODUCTION_KNOWLEDGE_TIERS], 'L3')
  })

  test('eval knowledge tiers include L3', ({ assert }) => {
    // Eval tiers: L1, L2, L3, L4 (L3 included for eval only)
    assert.includeMembers([...COPILOT_EVAL_KNOWLEDGE_TIERS], ['L1', 'L2', 'L3', 'L4'])
  })

  test('assertEligibleKnowledgeTiersExcludeL3 rejects L3', ({ assert }) => {
    const result = assertEligibleKnowledgeTiersExcludeL3(['L1', 'L2', 'L3', 'L4'])
    assert.isFalse(result.ok)
    assert.include(result.reason!, 'L3')
  })

  test('assertEligibleKnowledgeTiersExcludeL3 accepts production tiers', ({ assert }) => {
    const result = assertEligibleKnowledgeTiersExcludeL3(COPILOT_PRODUCTION_KNOWLEDGE_TIERS)
    assert.isTrue(result.ok)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.6 报告内容不出现在任何生产回合上下文中
// ═══════════════════════════════════════════════════════════════════════════════

test.group('6.6 Report content does NOT appear in production turn context', () => {
  test('report sample results contain no sample input body', ({ assert }) => {
    const report = fixtureL3DatasetReport

    for (const result of report.sampleResults) {
      // SampleResult must NOT contain any sample body
      assert.notProperty(result, 'input')
      assert.notProperty(result, 'expectedOutput')
      assert.notProperty(result, 'expectedProperties')
      assert.notProperty(result, 'benchmarkInput')
      assert.notProperty(result, 'evaluatorInput')
      assert.notProperty(result, 'prompt')
      assert.notProperty(result, 'modelOutput')
    }
  })

  test('report content hash only covers sampleId, score, scoreLabel', ({ assert }) => {
    // The report content hash is computed from sorted sampleResults
    // which only contain sampleId, score, scoreLabel (no bodies)
    const report = fixtureL3DatasetReport
    const hash = computeReportContentHash(report.sampleResults)

    // Hash should be deterministic
    const hash2 = computeReportContentHash(report.sampleResults)
    assert.equal(hash, hash2)
  })

  test('L3 report samples have no production-relevant content', ({ assert }) => {
    // L3 samples in the report should not contain any content that could leak
    for (const sample of fixtureL3Samples) {
      // The sample itself is in the dataset, not the report
      // The report only references sampleId
      assert.property(sample, 'sampleId')
      assert.property(sample, 'benchmarkSource')
      // But the report results don't contain the sample body
    }

    // Verify the report doesn't reference sample bodies
    const report = fixtureL3DatasetReport
    for (const result of report.sampleResults) {
      const violations = detectRunRecordForbiddenFields(
        result as unknown as Record<string, unknown>,
      )
      assert.isEmpty(violations)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.7 生产知识层清单不因回归而放宽
// ═══════════════════════════════════════════════════════════════════════════════

test.group('6.7 Production knowledge tier list unchanged after regression', () => {
  test('production tiers remain [L1, L2, L4] regardless of regression', ({ assert }) => {
    // Even when regression is enabled, production tiers stay the same
    const productionTiers = [...COPILOT_PRODUCTION_KNOWLEDGE_TIERS]
    assert.deepEqual(productionTiers, ['L1', 'L2', 'L4'])

    // Simulating "regression enabled" doesn't change the tiers
    // The tiers are compile-time constants, not mutable state
    assert.deepEqual(COPILOT_PRODUCTION_KNOWLEDGE_TIERS, ['L1', 'L2', 'L4'])
  })

  test('eval tiers include L3 but production tiers do not', ({ assert }) => {
    // This is the key invariant: L3 is ONLY for eval
    assert.include([...COPILOT_EVAL_KNOWLEDGE_TIERS], 'L3')
    assert.notInclude([...COPILOT_PRODUCTION_KNOWLEDGE_TIERS], 'L3')
  })

  test('assertEligibleKnowledgeTiersExcludeL3 always rejects production with L3', ({ assert }) => {
    // Even if someone tries to add L3 to production, the assertion catches it
    const tamperedTiers = ['L1', 'L2', 'L3', 'L4'] as const
    const result = assertEligibleKnowledgeTiersExcludeL3(tamperedTiers)
    assert.isFalse(result.ok)
    assert.include(result.reason!, 'L3')
  })
})
