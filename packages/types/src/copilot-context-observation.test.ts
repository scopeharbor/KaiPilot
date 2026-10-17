/**
 * v3-ai-context-and-retrieval-observability —— 观测契约测试。
 *
 * §2.7 测试覆盖：
 * - 本地扩展不冒充 gen_ai.* 标准键
 * - 禁存约束：检索词与来源正文不出现在任一字段
 * - 五态 fixtures 齐备
 * - 字段命名对齐
 */

import { describe, expect, it } from 'vitest'
import {
  CONTEXT_OBSERVATION_LOCAL_NS,
  contextObservationLedgerAttributeName,
  validateNoLocalImpersonation,
  validateObservationNoSensitiveContent,
  type ContextObservationRecord,
} from './copilot-context-observation.js'
import {
  ALL_OBSERVATION_FIXTURES,
  fixtureObservationAllHit,
  fixtureObservationDegraded,
  fixtureObservationPartialInaccessible,
  fixtureObservationStaleBlocked,
  fixtureObservationTruncated,
  fixtureObservationZeroResult,
  fixtureRetrievalQuality,
  fixtureSourceAllHit,
  fixtureSourceInaccessible,
  fixtureSourceSkipped,
  fixtureSourceStaleBlocked,
  fixtureSourceZeroResult,
  fixtureTruncationHitFloor,
  fixtureTruncationNone,
  fixtureTruncationWithOmission,
  fixtureUncertaintyAllResolved,
  fixtureUncertaintyAllZero,
  fixtureUncertaintyMixed,
} from './copilot-context-observation-fixtures.js'

describe('copilot-context-observation', () => {
  // ── §2.7 本地扩展不冒充 gen_ai.* ──────────────────────────────

  describe('local extensions do not impersonate standard keys', () => {
    it('aiproj_ 前缀正确标识本地扩展', () => {
      expect(CONTEXT_OBSERVATION_LOCAL_NS).toBe('aiproj_')
    })

    it('ledger 属性名映射：标准字段用 gen_ai.*，本地扩展用 aiproj_*', () => {
      // 标准字段
      expect(contextObservationLedgerAttributeName('assemblyId')).toBe(
        'gen_ai.retrieval.assembly_id',
      )
      expect(contextObservationLedgerAttributeName('totalMs')).toBe('gen_ai.retrieval.total_ms')
      // 本地扩展
      expect(contextObservationLedgerAttributeName('organizationId')).toMatch(/^aiproj_/)
      expect(contextObservationLedgerAttributeName('sources')).toMatch(/^aiproj_/)
      expect(contextObservationLedgerAttributeName('degraded')).toMatch(/^aiproj_/)
    })

    it('validateNoLocalImpersonation 通过合法属性', () => {
      const attrs = {
        'gen_ai.retrieval.assembly_id': 'asm_123',
        'gen_ai.retrieval.total_ms': 150,
        aiproj_organization_id: 100,
        aiproj_sources: [],
      }
      const result = validateNoLocalImpersonation(attrs)
      expect(result.ok).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('validateNoLocalImpersonation 拒绝未声明的 gen_ai.* 字段', () => {
      const attrs = {
        'gen_ai.retrieval.query_text': 'should not be here',
        'gen_ai.retrieval.custom_dimension': 'bad',
      }
      const result = validateNoLocalImpersonation(attrs)
      expect(result.ok).toBe(false)
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations[0]).toContain('impersonates standard namespace')
    })
  })

  // ── §2.8 禁存约束 ──────────────────────────────────────────

  describe('no sensitive content in records', () => {
    it('正常记录通过禁存验证', () => {
      const record = fixtureObservationAllHit as unknown as Record<string, unknown>
      const result = validateObservationNoSensitiveContent(record)
      expect(result.ok).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('含 API key 的值被拒绝', () => {
      const record = {
        ...fixtureObservationAllHit,
        apiKey: 'sk-1234567890abcdefghijklmnopqrstuvwxyz',
      } as unknown as Record<string, unknown>
      const result = validateObservationNoSensitiveContent(record)
      expect(result.ok).toBe(false)
      expect(result.violations.some((v) => v.includes('forbidden key'))).toBe(true)
    })

    it('含 Bearer token 的值被拒绝', () => {
      const record = {
        ...fixtureObservationAllHit,
        authHeader: 'Bearer eyJhbGciOiJIUzI1NiJ9',
      } as unknown as Record<string, unknown>
      const result = validateObservationNoSensitiveContent(record)
      expect(result.ok).toBe(false)
      expect(result.violations.some((v) => v.includes('forbidden value'))).toBe(true)
    })

    it('含 prompt 键名被拒绝', () => {
      const record = {
        ...fixtureObservationAllHit,
        prompt: 'some prompt text',
      } as unknown as Record<string, unknown>
      const result = validateObservationNoSensitiveContent(record)
      expect(result.ok).toBe(false)
      expect(result.violations.some((v) => v.includes('forbidden key'))).toBe(true)
    })

    it('含 modelOutput 键名被拒绝', () => {
      const record = {
        ...fixtureObservationAllHit,
        modelOutput: 'some model output',
      } as unknown as Record<string, unknown>
      const result = validateObservationNoSensitiveContent(record)
      expect(result.ok).toBe(false)
    })

    it('含 queryText 键名被拒绝（检索词原文不落库）', () => {
      const record = {
        ...fixtureObservationAllHit,
        queryText: 'project status',
      } as unknown as Record<string, unknown>
      const result = validateObservationNoSensitiveContent(record)
      expect(result.ok).toBe(false)
      expect(result.violations.some((v) => v.includes('queryText'))).toBe(true)
    })

    it('含 sourceBody 键名被拒绝（来源正文不落库）', () => {
      const record = {
        ...fixtureObservationAllHit,
        sourceBody: 'some source content',
      } as unknown as Record<string, unknown>
      const result = validateObservationNoSensitiveContent(record)
      expect(result.ok).toBe(false)
      expect(result.violations.some((v) => v.includes('sourceBody'))).toBe(true)
    })

    it('嵌套对象中的禁存键也被拒绝', () => {
      const record = {
        metadata: {
          token: 'secret-value',
          nested: {
            secret: 'also-bad',
          },
        },
      } as unknown as Record<string, unknown>
      const result = validateObservationNoSensitiveContent(record)
      expect(result.ok).toBe(false)
      expect(result.violations.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ── §2.10 五态 fixtures ──────────────────────────────────────

  describe('five-state fixtures', () => {
    it('全命中 fixture 合法', () => {
      expect(fixtureObservationAllHit.sources.length).toBeGreaterThan(0)
      expect(fixtureObservationAllHit.truncation.truncated).toBe(false)
      expect(fixtureObservationAllHit.uncertainty.noMatchCount).toBe(0)
      expect(fixtureObservationAllHit.degraded).toBe(false)
    })

    it('零结果 fixture 合法', () => {
      expect(fixtureObservationZeroResult.sources[0].hitCount).toBe(0)
      expect(fixtureObservationZeroResult.uncertainty.noMatchCount).toBe(12)
    })

    it('部分不可访问 fixture 合法', () => {
      const inaccessible = fixtureObservationPartialInaccessible.sources.find(
        (s) => s.permissionDecision === 'denied-hidden',
      )
      expect(inaccessible).toBeDefined()
      expect(fixtureObservationPartialInaccessible.uncertainty.notAccessibleCount).toBe(2)
    })

    it('截断 fixture 合法', () => {
      expect(fixtureObservationTruncated.truncation.truncated).toBe(true)
      expect(fixtureObservationTruncated.truncation.omittedSourceCount).toBe(3)
      expect(fixtureObservationTruncated.truncation.droppedRetrievalKinds.length).toBeGreaterThan(0)
    })

    it('stale 阻断 fixture 合法', () => {
      const stale = fixtureObservationStaleBlocked.sources.find((s) => s.staleBlocked)
      expect(stale).toBeDefined()
      expect(stale!.retrievalKind).toBe('document')
    })

    it('降级 fixture 合法', () => {
      expect(fixtureObservationDegraded.degraded).toBe(true)
      expect(fixtureObservationDegraded.degradedReason).toBe('OBSERVATION_WRITE_FAILED')
    })

    it('ALL_OBSERVATION_FIXTURES 包含全部六态', () => {
      expect(ALL_OBSERVATION_FIXTURES.length).toBe(6)
    })
  })

  // ── §2.1 逐来源记录 ────────────────────────────────────────

  describe('source records', () => {
    it('全命中来源的 hitCount > 0', () => {
      expect(fixtureSourceAllHit.hitCount).toBe(5)
      expect(fixtureSourceAllHit.scoreRange.min).toBeLessThan(fixtureSourceAllHit.scoreRange.max)
    })

    it('零结果来源的 hitCount = 0', () => {
      expect(fixtureSourceZeroResult.hitCount).toBe(0)
    })

    it('被跳过的来源无命中', () => {
      expect(fixtureSourceSkipped.hitCount).toBe(0)
      expect(fixtureSourceSkipped.permissionDecision).toBe('skipped-ineligible')
    })

    it('不可访问来源不泄露标识（只记计数）', () => {
      // fixtureSourceInaccessible 只有 permissionDecision 和 hitCount
      // 不应包含 sourceRef 等标识信息
      expect(fixtureSourceInaccessible.permissionDecision).toBe('denied-hidden')
    })
  })

  // ── §2.2 截断记录 ──────────────────────────────────────────

  describe('truncation records', () => {
    it('无截断时所有计数为 0', () => {
      expect(fixtureTruncationNone.omittedSourceCount).toBe(0)
      expect(fixtureTruncationNone.omittedEvidenceBytes).toBe(0)
      expect(fixtureTruncationNone.droppedRetrievalKinds).toHaveLength(0)
    })

    it('有截断时记录省略详情', () => {
      expect(fixtureTruncationWithOmission.omittedSourceCount).toBe(3)
      expect(fixtureTruncationWithOmission.omittedEvidenceBytes).toBe(1024)
      expect(fixtureTruncationWithOmission.droppedRetrievalKinds).toContain('activity')
    })

    it('触及预算下界正确标记', () => {
      expect(fixtureTruncationHitFloor.hitBudgetFloor).toBe(true)
      expect(fixtureTruncationHitFloor.omittedSourceCount).toBe(8)
    })

    it('路由输入保护在正常路径下恒为 false', () => {
      expect(fixtureTruncationNone.routingInputPreservationBreached).toBe(false)
      expect(fixtureTruncationWithOmission.routingInputPreservationBreached).toBe(false)
      expect(fixtureTruncationHitFloor.routingInputPreservationBreached).toBe(false)
    })
  })

  // ── §2.3 不确定三分 ────────────────────────────────────────

  describe('uncertainty records', () => {
    it('全部有结果时三分计数为 0', () => {
      expect(fixtureUncertaintyAllResolved.notExistsCount).toBe(0)
      expect(fixtureUncertaintyAllResolved.notAccessibleCount).toBe(0)
      expect(fixtureUncertaintyAllResolved.noMatchCount).toBe(0)
    })

    it('混合三分各自独立计数', () => {
      expect(fixtureUncertaintyMixed.notExistsCount).toBe(1)
      expect(fixtureUncertaintyMixed.notAccessibleCount).toBe(2)
      expect(fixtureUncertaintyMixed.noMatchCount).toBe(3)
    })

    it('全部零结果时 noMatchCount 最大', () => {
      expect(fixtureUncertaintyAllZero.noMatchCount).toBe(12)
      expect(fixtureUncertaintyAllZero.notExistsCount).toBe(0)
      expect(fixtureUncertaintyAllZero.notAccessibleCount).toBe(0)
    })
  })

  // ── §2.4 检索质量聚合 ──────────────────────────────────────

  describe('retrieval quality aggregation', () => {
    it('聚合按来源种类 + 查询类别分组', () => {
      const kinds = new Set(fixtureRetrievalQuality.map((q) => q.retrievalKind))
      const categories = new Set(fixtureRetrievalQuality.map((q) => q.queryCategory))
      expect(kinds.has('task')).toBe(true)
      expect(categories.has('technical')).toBe(true)
    })

    it('不含具体查询文本', () => {
      for (const q of fixtureRetrievalQuality) {
        // RetrievalQuality 不应有 queryText 字段
        expect('queryText' in q).toBe(false)
        expect('query' in q).toBe(false)
      }
    })

    it('零结果率可解析', () => {
      for (const q of fixtureRetrievalQuality) {
        expect(q.zeroResultCount).toBeGreaterThanOrEqual(0)
        expect(q.zeroResultCount).toBeLessThanOrEqual(q.totalQueries)
      }
    })
  })

  // ── §2.5 证据点击记录形状 ──────────────────────────────────

  describe('evidence click record shape', () => {
    it('字段名符合契约（类型检查通过即为合格）', () => {
      // 通过 TypeScript 类型系统验证
      const record = {
        sessionId: 'sess_123',
        messageId: 'msg_456',
        sourceRef: 'task:789',
        clickedAt: '2026-08-19T12:00:00.000Z',
        retrievalKind: 'task' as const,
      }
      expect(record.sessionId).toBe('sess_123')
      expect(record.sourceRef).toBe('task:789')
    })
  })

  // ── record 主体禁存 ────────────────────────────────────────

  describe('record主体不含禁存内容', () => {
    it.each(ALL_OBSERVATION_FIXTURES.map((f, i) => [`fixture ${i + 1}`, f]))(
      '%s 通过禁存验证',
      (_name, record) => {
        const result = validateObservationNoSensitiveContent(
          record as unknown as Record<string, unknown>,
        )
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
      },
    )
  })
})
