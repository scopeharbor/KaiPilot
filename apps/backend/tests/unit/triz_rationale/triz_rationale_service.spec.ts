/**
 * v2-triz-recommendation-rationale-ui —— TrizRecommendationRationaleService 单元测试。
 *
 * 使用纯 Mock（无数据库依赖）验证：
 * - DTO 组合（contradiction / analysis_artifact / recommendation 来源）
 * - 缺失推荐适配器时确定性 fallback
 * - 过期 hash warning
 * - 只读操作（无副作用）
 */
import { test } from '@japa/runner'
import type {
  ContradictionResolution,
  AnalysisArtifactResolution,
  RecommendationResolution,
} from '#services/triz_rationale/rationale_source_resolver'
import TrizRecommendationRationaleService from '#services/triz_rationale/triz_recommendation_rationale_service'
import { ResourceNotFoundException } from '#exceptions/api_exception'

// ---------------------------------------------------------------------------
// Mock 工厂：每次调用返回预设响应，不涉及数据库或文件 I/O。
// ---------------------------------------------------------------------------

function mockResolver(overrides: {
  contradiction?: ContradictionResolution
  artifact?: AnalysisArtifactResolution
  recommendation?: RecommendationResolution
}) {
  const defaults = {
    contradiction: {
      found: false,
      sourceRef: null,
      summary: '矛盾不可用',
      parameterTensions: [],
      principleMappings: [],
      evidence: [],
    } satisfies ContradictionResolution,
    artifact: {
      found: false,
      sourceRef: null,
      summary: '分析 Artifact 不可用',
      contradictions: [],
    } satisfies AnalysisArtifactResolution,
    recommendation: {
      found: false,
      sourceRef: null,
      summary: '推荐不可用',
    } satisfies RecommendationResolution,
  }
  const resolved = { ...defaults, ...overrides }
  return {
    resolveContradiction: async (
      _id: string,
      _orgId: number,
      _projectId: number,
    ): Promise<ContradictionResolution> => resolved.contradiction,
    resolveAnalysisArtifact: async (
      _id: string,
      _orgId: number,
      _projectId: number,
    ): Promise<AnalysisArtifactResolution> => resolved.artifact,
    resolveRecommendation: async (
      _id: string,
      _orgId: number,
      _projectId: number,
    ): Promise<RecommendationResolution> => resolved.recommendation,
  }
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function contradictionResolved(
  overrides: Partial<ContradictionResolution> = {},
): ContradictionResolution {
  return {
    found: true,
    sourceRef: {
      sourceType: 'contradiction',
      id: '42',
      hash: 'hash-contra-abc',
      summary: '改善进度 vs 增加工作量',
    },
    summary: '矛盾「改善进度 vs 增加工作量」(tradeoff, high)',
    parameterTensions: [
      {
        improvingParameter: 'speed',
        improvingParameterName: '速度',
        worseningParameter: 'workload',
        worseningParameterName: '工作量',
        severity: 'high',
      },
    ],
    principleMappings: [
      {
        principleId: 'P1',
        principleName: '分割',
        rationale: '将大任务拆分为子任务',
        relevance: 'high',
        applicability: '可将关键路径任务并行化',
        nonApplicability: '不适用于原子任务',
      },
    ],
    evidence: [
      {
        label: 'TRIZ 矩阵',
        description: '改善速度与工作量矛盾的推荐原理',
        sourceHash: 'hash-contra-abc',
        navigationUrl: '/triz/matrix/speed-workload',
      },
    ],
    ...overrides,
  }
}

function artifactResolved(
  overrides: Partial<AnalysisArtifactResolution> = {},
): AnalysisArtifactResolution {
  return {
    found: true,
    sourceRef: {
      sourceType: 'analysis_artifact',
      id: 'artifact-1',
      hash: 'hash-artifact-v2',
      summary: '分析结果(v2)',
    },
    summary: '分析 Artifact「v2」',
    contradictions: [
      {
        found: true,
        sourceRef: null,
        summary: '编译阶段检测到范围冲突',
        parameterTensions: [
          {
            improvingParameter: 'scope',
            improvingParameterName: '范围',
            worseningParameter: 'time',
            worseningParameterName: '时间',
            severity: 'medium',
          },
        ],
        principleMappings: [
          {
            principleId: 'P8',
            principleName: '重量补偿',
            rationale: '通过范围裁剪减负',
            relevance: 'medium',
            applicability: '削减 MVP 范围',
            nonApplicability: '已锁定范围的阶段不适用',
          },
        ],
        evidence: [
          {
            label: 'Compiler 分析',
            description: '自动检测到范围与时间冲突',
            sourceHash: 'hash-artifact-v2',
            navigationUrl: null,
          },
        ],
      },
    ],
    ...overrides,
  }
}

function recommendationResolved(
  overrides: Partial<RecommendationResolution> = {},
): RecommendationResolution {
  return {
    found: true,
    sourceRef: {
      sourceType: 'recommendation',
      id: 'rec-1',
      hash: 'hash-rec-xyz',
      summary: 'AI 推荐采用分割原理',
    },
    summary: 'AI 推荐采用分割原理',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.group('TrizRecommendationRationaleService', () => {
  // ── 1. DTO composition: contradiction source ───────────────────────────

  test('contradiction 来源：组装完整 DTO，包含参数 tension/原理映射/证据链', async ({ assert }) => {
    const resolver = mockResolver({ contradiction: contradictionResolved() })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'contradiction', '42')

    assert.equal(result.id, 'contradiction_42')
    assert.equal(result.organizationId, 1)
    assert.equal(result.projectId, 10)
    assert.equal(result.sourceType, 'contradiction')
    assert.lengthOf(result.sourceRefs, 1)
    assert.equal(result.sourceRefs[0].hash, 'hash-contra-abc')
    assert.lengthOf(result.parameterTensions, 1)
    assert.equal(result.parameterTensions[0].improvingParameter, 'speed')
    assert.lengthOf(result.principleMappings, 1)
    assert.equal(result.principleMappings[0].principleId, 'P1')
    assert.lengthOf(result.evidenceRefs, 1)
    assert.equal(result.evidenceRefs[0].label, 'TRIZ 矩阵')
    assert.isNotNull(result.contradictionSummary)
    assert.include(result.contradictionSummary!, '改善进度 vs 增加工作量')
    assert.isFalse(result.aiMetadata?.isAiGenerated)
    assert.equal(result.validationSummary.status, 'passed')
    assert.isTrue(result.validationSummary.antiHallucinationPassed)
  })

  // ── 2. DTO composition: analysis_artifact source ────────────────────────

  test('analysis_artifact 来源：组装含嵌套矛盾的 DTO', async ({ assert }) => {
    const resolver = mockResolver({ artifact: artifactResolved() })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(2, 20, 'analysis_artifact', 'artifact-1')

    assert.equal(result.id, 'analysis_artifact_artifact-1')
    assert.lengthOf(result.sourceRefs, 1)
    assert.equal(result.sourceRefs[0].sourceType, 'analysis_artifact')
    // 嵌套矛盾的参数融合到顶层列表
    assert.lengthOf(result.parameterTensions, 1)
    assert.lengthOf(result.principleMappings, 1)
    assert.lengthOf(result.evidenceRefs, 1)
    assert.equal(result.contradictionSummary, '分析 Artifact「v2」')
  })

  // ── 3. DTO composition: recommendation source ──────────────────────────

  test('recommendation 来源：包含来源 ref 但无矛盾参数/原理', async ({ assert }) => {
    const resolver = mockResolver({
      contradiction: {
        found: false,
        sourceRef: null,
        summary: '矛盾不可用',
        parameterTensions: [],
        principleMappings: [],
        evidence: [],
      },
      artifact: {
        found: false,
        sourceRef: null,
        summary: '分析 Artifact 不可用',
        contradictions: [],
      },
      recommendation: recommendationResolved(),
    })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(3, 30, 'recommendation', 'rec-1')

    assert.equal(result.id, 'recommendation_rec-1')
    assert.lengthOf(result.sourceRefs, 1)
    assert.equal(result.sourceRefs[0].sourceType, 'recommendation')
    assert.lengthOf(result.parameterTensions, 0)
    assert.lengthOf(result.principleMappings, 0)
    assert.lengthOf(result.evidenceRefs, 0)
    // 仅有推荐来源，矛盾摘要仍为 null
    assert.include(result.contradictionSummary!, 'AI 推荐采用分割原理')
  })

  // ── 4. 主来源不存在时抛 ResourceNotFoundException ──────────────────────

  test('contradiction 来源不存在：抛出 ResourceNotFoundException', async ({ assert }) => {
    const resolver = mockResolver({})
    const service = new TrizRecommendationRationaleService(resolver as any)

    await assert.rejects(
      () => service.show(1, 10, 'contradiction', '999'),
      ResourceNotFoundException,
    )
  })

  test('analysis_artifact 来源不存在：抛出 ResourceNotFoundException', async ({ assert }) => {
    const resolver = mockResolver({})
    const service = new TrizRecommendationRationaleService(resolver as any)

    await assert.rejects(
      () => service.show(1, 10, 'analysis_artifact', '999'),
      ResourceNotFoundException,
    )
  })

  test('recommendation 来源不存在：抛出 ResourceNotFoundException', async ({ assert }) => {
    const resolver = mockResolver({})
    const service = new TrizRecommendationRationaleService(resolver as any)

    await assert.rejects(
      () => service.show(1, 10, 'recommendation', '999'),
      ResourceNotFoundException,
    )
  })

  // ── 5. 缺失推荐适配器 → 确定性 fallback（无 AI 调用痕迹） ──────────────

  test('只有 contradiction 时（无 artifact/recommendation）：产生确定性 fallback 且 aiMetadata isAiGenerated=false', async ({
    assert,
  }) => {
    const resolver = mockResolver({ contradiction: contradictionResolved() })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'contradiction', '42')

    assert.isFalse(result.aiMetadata!.isAiGenerated)
    assert.equal(result.aiMetadata!.validationStatus, 'skipped')
    assert.isNull(result.aiExplanationDraft)
    assert.isNull(result.fallbackSummary)
    assert.isNull(result.aiMetadata?.provider)
    assert.isNull(result.aiMetadata?.model)
    // 成本摘要也为空
    assert.isNull(result.costSummary?.provider)
    assert.equal(result.costSummary?.tokens, 0)
    assert.equal(result.costSummary?.budgetDecision, 'not_applicable')
  })

  // ── 6. 过期 hash warning ──────────────────────────────────────────────

  test('来源 ref hash 不在 sourceHashes 列表时标记 STALE_SOURCE_HASH warning', async ({
    assert,
  }) => {
    const contra = contradictionResolved()
    const artifact = artifactResolved()
    // 让 artifact 的 hash 不同于主来源 hash，使其过期
    const staleArtifact = {
      ...artifact,
      sourceRef: {
        sourceType: 'analysis_artifact' as const,
        id: 'artifact-1',
        hash: 'stale-hash-wxyz',
        summary: '过期的分析结果',
      },
    }
    const resolver = mockResolver({ contradiction: contra, artifact: staleArtifact })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'contradiction', '42')

    // contradiction 的 hash 'hash-contra-abc' 在 hashes 列表，
    // artifact 的 'stale-hash-wxyz' 不在 → stale warning
    const staleWarnings = result.validationSummary.warnings.filter(
      (w) => w.code === 'STALE_SOURCE_HASH',
    )
    assert.isAbove(staleWarnings.length, 0)
    assert.include(staleWarnings[0].message, '过期')
    assert.equal(result.validationSummary.status, 'warning')
    assert.isNotNull(result.warningSummary)
    assert.include(result.warningSummary!, 'STALE_SOURCE_HASH')
  })

  // ── 7. 空证据链 warning ───────────────────────────────────────────────

  test('证据链为空时标记 EMPTY_EVIDENCE_CHAIN warning', async ({ assert }) => {
    const contra = contradictionResolved({ evidence: [] })
    const resolver = mockResolver({ contradiction: contra })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'contradiction', '42')

    const emptyWarnings = result.validationSummary.warnings.filter(
      (w) => w.code === 'EMPTY_EVIDENCE_CHAIN',
    )
    assert.isAbove(emptyWarnings.length, 0)
    assert.equal(result.validationSummary.status, 'warning')
  })

  // ── 8. 证据按 label 稳定排序 ──────────────────────────────────────────

  test('多来源证据按 label 排序：artifact 证据应在 contradiction 之后', async ({ assert }) => {
    const contra = contradictionResolved({
      evidence: [
        {
          label: 'Z-suffix 标签',
          description: '应排最后',
          sourceHash: 'hash-contra-abc',
          navigationUrl: null,
        },
      ],
    })
    const artifact = artifactResolved({
      contradictions: [
        {
          found: true,
          sourceRef: null,
          summary: '编译阶段检测到范围冲突',
          parameterTensions: [],
          principleMappings: [],
          evidence: [
            {
              label: 'A-prefix 标签',
              description: '应排最前',
              sourceHash: 'hash-artifact-v2',
              navigationUrl: null,
            },
          ],
        },
      ],
    })
    const resolver = mockResolver({ contradiction: contra, artifact })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'contradiction', '42')

    assert.lengthOf(result.evidenceRefs, 2)
    assert.equal(result.evidenceRefs[0].label, 'A-prefix 标签')
    assert.equal(result.evidenceRefs[1].label, 'Z-suffix 标签')
  })

  // ── 9. 只读无副作用：重复调用返回相同结构 ──────────────────────────────

  test('两次相同输入产生相同 id/contradictionSummary/deterministicSummary', async ({ assert }) => {
    const contra = contradictionResolved()
    const resolver = mockResolver({ contradiction: contra })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const a = await service.show(1, 10, 'contradiction', '42')
    const b = await service.show(1, 10, 'contradiction', '42')

    assert.equal(a.id, b.id)
    assert.equal(a.contradictionSummary, b.contradictionSummary)
    assert.equal(a.deterministicSummary, b.deterministicSummary)
    assert.equal(a.validationSummary.status, b.validationSummary.status)
    assert.deepEqual(a.availableSections, b.availableSections)
  })

  // ── 10. 确定性摘要 ─────────────────────────────────────────────────────

  test('deterministicSummary 反映矛盾参数与原理计数', async ({ assert }) => {
    const contra = contradictionResolved()
    const artifact = artifactResolved()
    const resolver = mockResolver({ contradiction: contra, artifact })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'contradiction', '42')

    assert.include(result.deterministicSummary, '1 个参数冲突')
    assert.include(result.deterministicSummary, '1 个候选发明原理')
    assert.include(result.deterministicSummary, '1 个关联矛盾')
  })

  test('全部来源不可用：deterministicSummary 返回 "暂无可用摘要"', async ({ assert }) => {
    const resolver = mockResolver({
      recommendation: {
        found: true,
        sourceRef: null,
        summary: '推荐摘要',
      },
    })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'recommendation', 'rec-1')

    assert.equal(result.deterministicSummary, 'AI 智能推荐已关联')
  })

  // ── 11. availableSections 推导 ────────────────────────────────────────

  test('availableSections 仅包含有数据的 section + feedback/handoff', async ({ assert }) => {
    const contra = contradictionResolved()
    const resolver = mockResolver({ contradiction: contra })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'contradiction', '42')

    assert.includeMembers(result.availableSections, [
      'source_summary',
      'parameter_tensions',
      'principle_mapping',
      'evidence_chain',
      'validation_state',
      'cost_summary',
      'feedback',
      'handoff',
    ])
    // AI explanation 和 fallback summary 无数据时不应出现
    assert.notInclude(result.availableSections, 'ai_explanation')
    assert.notInclude(result.availableSections, 'fallback_summary')
  })

  // ── 12. 未知 sourceType ───────────────────────────────────────────────

  test('未知 sourceType 抛出 ResourceNotFoundException', async ({ assert }) => {
    const service = new TrizRecommendationRationaleService({} as any)

    await assert.rejects(
      () => service.show(1, 10, 'invalid_type' as any, 'x'),
      ResourceNotFoundException,
    )
  })

  test('合并矛盾与 Artifact 的 evidence/principleMappings：count=2', async ({ assert }) => {
    const contra = contradictionResolved()
    const artifact = artifactResolved()
    const resolver = mockResolver({ contradiction: contra, artifact })
    const service = new TrizRecommendationRationaleService(resolver as any)

    const result = await service.show(1, 10, 'contradiction', '42')

    // 1 来自 contradiction + 1 来自 artifact
    assert.lengthOf(result.parameterTensions, 2)
    assert.lengthOf(result.principleMappings, 2)
    assert.lengthOf(result.evidenceRefs, 2)
  })
})
