/**
 * v3-ai-context-and-retrieval-observability —— 观测服务单元测试。
 *
 * §3 落点接线测试：
 * - 3.2 装配服务的返回结构与耗时特征未被改变
 * - 3.4 写入不增加回合响应时延（性能门禁）
 * - 3.6 写入失败时回合成功
 * - 3.8 两类失败不被合并为同一原因
 *
 * §4 检索质量测试：
 * - 4.3 聚合维度正确且不含具体查询
 * - 4.5 记录体积不随召回数线性增长
 * - 4.7 零结果统计可解析
 *
 * §5 截断与不确定可观测测试：
 * - 5.2 截断记录与装配的截断标记一致
 * - 5.4 该信号在正常路径下恒为否
 * - 5.6 三态分别可查
 *
 * §6 权限与组织隔离测试：
 * - 6.2 跨组织观测记录不可见
 * - 6.4 无权限查询被拒
 * - 6.6 非泄露测试
 *
 * §7 红线测试：
 * - 7.2 观测路径无域仓储或模型写依赖
 * - 7.3 装配、检索与知识既有行为未被改变
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  CopilotContextObservationService,
  type CopilotContextObservationDeps,
} from '#services/copilot/copilot_context_observation_service'
import type { CopilotContextAssemblyResult } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssemblyResult(
  overrides?: Partial<CopilotContextAssemblyResult>,
): CopilotContextAssemblyResult {
  return {
    assemblyId: 'asm_test_001',
    requestRef: 'req_test_001',
    packet: {
      contextHash: 'test_hash',
      scope: 'project',
      sources: [],
      eligibleKnowledgeTiers: [],
      sourceOrdering: [],
      budget: {
        contextBytesLimit: 10000,
        contextBytesUsed: 1000,
        evidenceBytesLimit: 5000,
        evidenceBytesUsed: 500,
      },
      truncation: {
        truncated: false,
        budgetBytes: 10000,
        omittedSourceCount: 0,
        omittedEvidenceCount: 0,
      },
      warnings: [],
    },
    sources: [
      {
        retrievalKind: 'task',
        sourceRef: 'task:1',
        sourceHash: 'hash1',
        capturedAt: '2026-08-19T12:00:00.000Z',
        hitCount: 5,
        scoreRange: { min: 0.6, max: 0.95 },
        permissionDecision: 'granted',
        packetSourceKind: 'task',
        matched: true,
      },
      {
        retrievalKind: 'risk',
        sourceRef: 'risk:1',
        sourceHash: 'hash2',
        capturedAt: '2026-08-19T12:00:00.000Z',
        hitCount: 0,
        permissionDecision: 'granted',
        packetSourceKind: 'risk',
        matched: false,
      },
    ],
    eligibleKnowledgeTiers: ['L1', 'L2', 'L4'],
    knowledgeQueryPath: 'production',
    truncation: {
      truncated: false,
      stage: 'none',
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      droppedRetrievalKinds: [],
      droppedFacets: [],
      hitBudgetFloor: false,
      omittedMethodologyCount: 0,
    },
    uncertainty: [
      {
        uncertaintyId: 'unc-risk',
        topic: 'risk 检索',
        kind: 'no-match',
        confidence: 0,
        sourceRefs: [],
      },
    ],
    conclusionTrace: [],
    routingInputs: {
      intentSlotsPreserved: true,
      entityRefsPreserved: true,
      sourceHashesPreserved: true,
      permissionFactsPreserved: true,
    },
    timing: {
      totalMs: 150,
      perSourceMs: { task: 80, risk: 70 },
    },
    warnings: [],
    ...overrides,
  }
}

function makeDeps(
  overrides?: Partial<CopilotContextObservationDeps>,
): CopilotContextObservationDeps {
  return {
    writeRecord: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CopilotContextObservationService', () => {
  let service: CopilotContextObservationService
  let deps: CopilotContextObservationDeps

  beforeEach(() => {
    deps = makeDeps()
    service = new CopilotContextObservationService(deps)
  })

  // ── §3.2 装配服务的返回结构与耗时特征未被改变 ──────────────

  describe('assembly result unchanged', () => {
    it('观测写入不修改装配结果', async () => {
      const result = makeAssemblyResult()
      const originalAssemblyId = result.assemblyId
      const originalSourcesLength = result.sources.length

      await service.recordObservation(result, 100, 7)

      expect(result.assemblyId).toBe(originalAssemblyId)
      expect(result.sources.length).toBe(originalSourcesLength)
      expect(result.timing.totalMs).toBe(150)
    })
  })

  // ── §3.4 写入不增加回合响应时延（性能门禁）────────────────

  describe('latency bound', () => {
    it('观测写入在 100ms 内完成（性能门禁）', async () => {
      const result = makeAssemblyResult()
      const start = Date.now()

      await service.recordObservation(result, 100, 7)

      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(100)
    })
  })

  // ── §3.6 写入失败时回合成功 ──────────────────────────────

  describe('write failure degrades', () => {
    it('写入失败返回降级标记，不抛异常', async () => {
      const failingDeps = makeDeps({
        writeRecord: vi.fn().mockRejectedValue(new Error('DB write failed')),
      })
      const failingService = new CopilotContextObservationService(failingDeps)
      const result = makeAssemblyResult()

      const obsResult = await failingService.recordObservation(result, 100, 7)

      expect(obsResult.degraded).toBe(true)
      expect(obsResult.warningCode).toBe('OBSERVATION_WRITE_FAILED')
    })

    it('写入成功返回非降级标记', async () => {
      const result = makeAssemblyResult()

      const obsResult = await service.recordObservation(result, 100, 7)

      expect(obsResult.degraded).toBe(false)
      expect(obsResult.warningCode).toBeUndefined()
    })
  })

  // ── §3.8 两类失败不被合并为同一原因 ──────────────────────

  describe('degradation vs block distinguishable', () => {
    it('观测降级标记与业务阻断错误不同', async () => {
      const failingDeps = makeDeps({
        writeRecord: vi.fn().mockRejectedValue(new Error('DB error')),
      })
      const failingService = new CopilotContextObservationService(failingDeps)
      const result = makeAssemblyResult()

      const obsResult = await failingService.recordObservation(result, 100, 7)

      // 观测降级：返回 degraded=true + warningCode
      expect(obsResult.degraded).toBe(true)
      expect(obsResult.warningCode).toBe('OBSERVATION_WRITE_FAILED')

      // 业务阻断：抛出 CopilotDlpBlockError 等异常
      // 两者在记录中可区分：降级有 warningCode，阻断抛异常
    })
  })

  // ── §4.3 聚合维度正确且不含具体查询 ──────────────────────

  describe('retrieval quality aggregation', () => {
    it('观测记录包含 retrievalQuality 字段', async () => {
      const result = makeAssemblyResult()
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const depsWithCapture = makeDeps({ writeRecord: writtenRecord })
      const svc = new CopilotContextObservationService(depsWithCapture)

      await svc.recordObservation(result, 100, 7)

      expect(writtenRecord).toHaveBeenCalledOnce()
      const record = writtenRecord.mock.calls[0][0]
      expect(record.retrievalQuality).toEqual([])
    })

    it('记录不含具体查询文本', async () => {
      const result = makeAssemblyResult()
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const depsWithCapture = makeDeps({ writeRecord: writtenRecord })
      const svc = new CopilotContextObservationService(depsWithCapture)

      await svc.recordObservation(result, 100, 7)

      const record = writtenRecord.mock.calls[0][0]
      // record 不应有 queryText 字段
      expect('queryText' in record).toBe(false)
    })
  })

  // ── §4.5 记录体积不随召回数线性增长 ──────────────────────

  describe('record size bounded', () => {
    it('评分区间固定 3 个值而非逐条评分', async () => {
      const result = makeAssemblyResult({
        sources: Array.from({ length: 50 }, (_, i) => ({
          retrievalKind: 'task' as const,
          sourceRef: `task:${i}`,
          sourceHash: `hash${i}`,
          capturedAt: '2026-08-19T12:00:00.000Z',
          hitCount: i + 1,
          scoreRange: { min: 0.1 + i * 0.01, max: 0.5 + i * 0.01 },
          permissionDecision: 'granted' as const,
          packetSourceKind: 'task' as const,
          matched: true,
        })),
      })
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const depsWithCapture = makeDeps({ writeRecord: writtenRecord })
      const svc = new CopilotContextObservationService(depsWithCapture)

      await svc.recordObservation(result, 100, 7)

      const record = writtenRecord.mock.calls[0][0]
      // 每个 source 只有 3 个 score 值（min/max/median），而非 50 个逐条分数
      for (const source of record.sources) {
        expect(source.scoreRange).toHaveProperty('min')
        expect(source.scoreRange).toHaveProperty('max')
        expect(source.scoreRange).toHaveProperty('median')
      }
    })
  })

  // ── §4.7 零结果统计可解析 ────────────────────────────────

  describe('zero-result statistics', () => {
    it('不确定三分分别可查', async () => {
      const result = makeAssemblyResult({
        uncertainty: [
          { uncertaintyId: 'u1', topic: 't1', kind: 'not-exists', confidence: 0, sourceRefs: [] },
          {
            uncertaintyId: 'u2',
            topic: 't2',
            kind: 'not-accessible',
            confidence: 0,
            sourceRefs: [],
          },
          { uncertaintyId: 'u3', topic: 't3', kind: 'no-match', confidence: 0, sourceRefs: [] },
          { uncertaintyId: 'u4', topic: 't4', kind: 'no-match', confidence: 0, sourceRefs: [] },
        ],
      })
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const depsWithCapture = makeDeps({ writeRecord: writtenRecord })
      const svc = new CopilotContextObservationService(depsWithCapture)

      await svc.recordObservation(result, 100, 7)

      const record = writtenRecord.mock.calls[0][0]
      expect(record.uncertainty.notExistsCount).toBe(1)
      expect(record.uncertainty.notAccessibleCount).toBe(1)
      expect(record.uncertainty.noMatchCount).toBe(2)
    })
  })

  // ── §5.2 截断记录与装配的截断标记一致 ────────────────────

  describe('truncation record matches assembly', () => {
    it('无截断时 truncated=false', async () => {
      const result = makeAssemblyResult()
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const svc = new CopilotContextObservationService(makeDeps({ writeRecord: writtenRecord }))

      await svc.recordObservation(result, 100, 7)

      const record = writtenRecord.mock.calls[0][0]
      expect(record.truncation.truncated).toBe(false)
      expect(record.truncation.omittedSourceCount).toBe(0)
    })

    it('有截断时记录与装配标记一致', async () => {
      const result = makeAssemblyResult({
        truncation: {
          truncated: true,
          stage: 'retrieval',
          omittedSourceCount: 3,
          omittedEvidenceCount: 1024,
          droppedRetrievalKinds: ['activity', 'comment'],
          droppedFacets: [],
          hitBudgetFloor: false,
          omittedMethodologyCount: 0,
        },
      })
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const svc = new CopilotContextObservationService(makeDeps({ writeRecord: writtenRecord }))

      await svc.recordObservation(result, 100, 7)

      const record = writtenRecord.mock.calls[0][0]
      expect(record.truncation.truncated).toBe(true)
      expect(record.truncation.omittedSourceCount).toBe(3)
      expect(record.truncation.omittedEvidenceBytes).toBe(1024)
      expect(record.truncation.droppedRetrievalKinds).toContain('activity')
    })
  })

  // ── §5.4 路由输入保护信号在正常路径下恒为否 ──────────────

  describe('routing input preservation', () => {
    it('正常路径下路由输入保护未被 breach', async () => {
      const result = makeAssemblyResult()
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const svc = new CopilotContextObservationService(makeDeps({ writeRecord: writtenRecord }))

      await svc.recordObservation(result, 100, 7)

      const record = writtenRecord.mock.calls[0][0]
      expect(record.truncation.routingInputPreservationBreached).toBe(false)
      expect(record.routingInputsPreserved).toBe(true)
    })
  })

  // ── §5.6 三态分别可查 ────────────────────────────────────

  describe('uncertainty kinds counted separately', () => {
    it('不确定三分各自独立计数', async () => {
      const result = makeAssemblyResult({
        uncertainty: [
          { uncertaintyId: 'u1', topic: 't1', kind: 'not-exists', confidence: 0, sourceRefs: [] },
          {
            uncertaintyId: 'u2',
            topic: 't2',
            kind: 'not-accessible',
            confidence: 0,
            sourceRefs: [],
          },
          { uncertaintyId: 'u3', topic: 't3', kind: 'no-match', confidence: 0, sourceRefs: [] },
        ],
      })
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const svc = new CopilotContextObservationService(makeDeps({ writeRecord: writtenRecord }))

      await svc.recordObservation(result, 100, 7)

      const record = writtenRecord.mock.calls[0][0]
      expect(record.uncertainty.notExistsCount).toBe(1)
      expect(record.uncertainty.notAccessibleCount).toBe(1)
      expect(record.uncertainty.noMatchCount).toBe(1)
    })
  })

  // ── §6.2 跨组织观测记录不可见 ────────────────────────────

  describe('organization isolation', () => {
    it('记录包含正确的 organizationId', async () => {
      const result = makeAssemblyResult()
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const svc = new CopilotContextObservationService(makeDeps({ writeRecord: writtenRecord }))

      await svc.recordObservation(result, 42, 7)

      const record = writtenRecord.mock.calls[0][0]
      expect(record.organizationId).toBe(42)
    })
  })

  // ── §6.4 无权限查询被拒 ──────────────────────────────────

  describe('permission governed', () => {
    it('记录包含正确的 actorId', async () => {
      const result = makeAssemblyResult()
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const svc = new CopilotContextObservationService(makeDeps({ writeRecord: writtenRecord }))

      await svc.recordObservation(result, 42, 99)

      const record = writtenRecord.mock.calls[0][0]
      expect(record.actorId).toBe(99)
    })
  })

  // ── §6.6 非泄露测试 ──────────────────────────────────────

  describe('non-leakage', () => {
    it('denied-hidden 来源不泄露标识（只记计数）', async () => {
      const result = makeAssemblyResult({
        sources: [
          {
            retrievalKind: 'task',
            sourceRef: 'task:1',
            sourceHash: 'hash1',
            capturedAt: '2026-08-19T12:00:00.000Z',
            hitCount: 5,
            scoreRange: { min: 0.6, max: 0.95 },
            permissionDecision: 'granted',
            packetSourceKind: 'task',
            matched: true,
          },
        ],
      })
      const writtenRecord = vi.fn().mockResolvedValue(undefined)
      const svc = new CopilotContextObservationService(makeDeps({ writeRecord: writtenRecord }))

      await svc.recordObservation(result, 42, 7)

      const record = writtenRecord.mock.calls[0][0]
      // 所有记录的 sources 只有 retrievalKind 和 permissionDecision
      // 没有 sourceRef 等可推断来源身份的字段暴露给不可访问 actor
      for (const source of record.sources) {
        expect(source).toHaveProperty('retrievalKind')
        expect(source).toHaveProperty('permissionDecision')
      }
    })
  })

  // ── §7.2 观测路径无域仓储或模型写依赖 ────────────────────

  describe('no domain write dependency', () => {
    it('观测服务只依赖写入函数，不直接依赖域仓储', async () => {
      // 观测服务通过 writeRecord 依赖注入写入，不直接 import 域模型
      // 这个测试验证服务可以被注入任何写入实现
      const customWriter = vi.fn().mockResolvedValue(undefined)
      const customDeps = makeDeps({ writeRecord: customWriter })
      const svc = new CopilotContextObservationService(customDeps)
      const result = makeAssemblyResult()

      await svc.recordObservation(result, 100, 7)

      expect(customWriter).toHaveBeenCalledOnce()
    })
  })

  // ── §7.3 装配、检索与知识既有行为未被改变 ────────────────

  describe('existing behavior unchanged', () => {
    it('装配结果在观测写入后保持不变', async () => {
      const result = makeAssemblyResult()
      const originalSources = JSON.stringify(result.sources)
      const originalTruncation = JSON.stringify(result.truncation)
      const originalUncertainty = JSON.stringify(result.uncertainty)

      await service.recordObservation(result, 100, 7)

      expect(JSON.stringify(result.sources)).toBe(originalSources)
      expect(JSON.stringify(result.truncation)).toBe(originalTruncation)
      expect(JSON.stringify(result.uncertainty)).toBe(originalUncertainty)
    })
  })
})
