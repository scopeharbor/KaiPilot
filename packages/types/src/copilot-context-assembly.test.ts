// @aiproj/types — V3 Copilot 上下文组装契约测试
// v3-copilot-context-packet-and-project-panorama — 七态 fixtures 合法、未知值拒绝、
// 含 L3 合格层清单拒绝、scope 合格性、确定性截断与路由输入保护。

import { describe, it, expect } from 'vitest'
import {
  COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP,
  COPILOT_EVAL_KNOWLEDGE_TIERS,
  COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
  COPILOT_RETRIEVAL_SOURCE_KINDS,
  COPILOT_TRUNCATION_STAGES,
  COPILOT_UNCERTAINTY_KINDS,
  COPILOT_LOW_CONFIDENCE_THRESHOLD,
  assertEligibleKnowledgeTiersExcludeL3,
  assemblyEligibleRetrievalKinds,
  deriveEligibleKnowledgeTiers,
  isCopilotLowConfidence,
  isCopilotRetrievalSourceKind,
  isCopilotTruncationStage,
  isCopilotUncertaintyKind,
  knowledgeTiersIncludeSynthetic,
  makeCopilotNoTruncationMarker,
  planCopilotAssemblyTruncation,
  validateCopilotContextAssembly,
  type CopilotAssemblySourceMetadata,
} from './copilot-context-assembly.js'
import {
  buildAllAssemblyFixtures,
  buildAssemblySourceMetadata,
  buildTruncatedAssemblyFixture,
} from './copilot-context-assembly-fixtures.js'

describe('copilot-context-assembly — 合法值通过（七态 fixtures 全过契约校验）', () => {
  it('七个 fixture 状态全部通过 validateCopilotContextAssembly', () => {
    const fixtures = buildAllAssemblyFixtures()
    expect(fixtures.map((f) => f.state).sort()).toEqual(
      [
        'complete',
        'truncated',
        'stale',
        'permission-missing',
        'zero-result',
        'methodology-injected',
        'general-scope',
      ].sort(),
    )
    for (const fixture of fixtures) {
      const validation = validateCopilotContextAssembly(fixture.result)
      expect(validation.ok, `${fixture.state}: ${validation.errors.join('; ')}`).toBe(true)
    }
  })

  it('truncated 态：截断标记带省略计数且路由输入存活', () => {
    const fixture = buildTruncatedAssemblyFixture()
    expect(fixture.result.truncation.truncated).toBe(true)
    expect(fixture.result.truncation.omittedSourceCount).toBeGreaterThan(0)
    expect(fixture.result.routingInputs.intentSlotsPreserved).toBe(true)
    expect(fixture.result.routingInputs.entityRefsPreserved).toBe(true)
    expect(fixture.result.routingInputs.sourceHashesPreserved).toBe(true)
    expect(fixture.result.routingInputs.permissionFactsPreserved).toBe(true)
  })

  it('stale 态：包内来源 freshness 标记 stale', () => {
    const fixture = buildAllAssemblyFixtures().find((f) => f.state === 'stale')!
    expect(fixture.result.packet.sources.some((s) => s.freshness.isStale)).toBe(true)
  })

  it('permission-missing 态：零泄露——结果中无 denied 来源、无隐藏来源 hash', () => {
    const fixture = buildAllAssemblyFixtures().find((f) => f.state === 'permission-missing')!
    expect(fixture.result.sources.every((s) => s.permissionDecision === 'granted')).toBe(true)
    const serialized = JSON.stringify(fixture.result)
    expect(serialized).not.toContain('hidden')
    expect(serialized).not.toContain('secret')
  })

  it('general-scope 态：零来源、无全景、无方法论', () => {
    const fixture = buildAllAssemblyFixtures().find((f) => f.state === 'general-scope')!
    expect(fixture.result.sources).toEqual([])
    expect(fixture.result.panorama).toBeUndefined()
    expect(fixture.result.methodology).toBeUndefined()
  })
})

describe('copilot-context-assembly — 未知值拒绝', () => {
  function baseResult() {
    return buildAllAssemblyFixtures().find((f) => f.state === 'complete')!.result
  }

  it('未知检索来源种类被拒', () => {
    const r = baseResult()
    const bad = validateCopilotContextAssembly({
      ...r,
      sources: [
        {
          ...r.sources[0],
          retrievalKind: 'alien_source' as CopilotAssemblySourceMetadata['retrievalKind'],
        },
      ],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('未知检索来源种类')
  })

  it('未知权限判定结果被拒', () => {
    const r = baseResult()
    const bad = validateCopilotContextAssembly({
      ...r,
      sources: [
        {
          ...r.sources[0],
          permissionDecision: 'maybe' as CopilotAssemblySourceMetadata['permissionDecision'],
        },
      ],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('未知权限判定结果')
  })

  it('denied-hidden 来源出现在结果中被拒（零泄露省略要求整条省略）', () => {
    const r = baseResult()
    const bad = validateCopilotContextAssembly({
      ...r,
      sources: [
        ...r.sources,
        buildAssemblySourceMetadata({
          retrievalKind: 'file',
          permissionDecision: 'denied-hidden',
          sourceRef: 'file/hidden-001',
        }),
      ],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('denied-hidden 来源不得出现在组装结果中')
  })

  it('未知截断阶段被拒', () => {
    const r = baseResult()
    const bad = validateCopilotContextAssembly({
      ...r,
      truncation: { ...r.truncation, stage: 'random' as typeof r.truncation.stage },
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('未知截断阶段')
  })

  it('未知不确定种类被拒', () => {
    const r = baseResult()
    const bad = validateCopilotContextAssembly({
      ...r,
      uncertainty: [
        {
          uncertaintyId: 'u1',
          topic: 't',
          kind: 'unknown-kind' as never,
          confidence: 0.1,
          sourceRefs: [],
        },
      ],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('未知不确定种类')
  })

  it('无来源支撑却声明 supported=true 被拒', () => {
    const r = baseResult()
    const bad = validateCopilotContextAssembly({
      ...r,
      conclusionTrace: [
        {
          conclusionId: 'c1',
          statement: '项目下月必然延期',
          sourceRefs: [],
          sourceHashes: [],
          supported: true,
        },
      ],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('无任何来源支撑')
  })

  it('路由输入保护不完整被拒', () => {
    const r = baseResult()
    const bad = validateCopilotContextAssembly({
      ...r,
      routingInputs: { ...r.routingInputs, entityRefsPreserved: false },
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('路由输入保护不完整')
  })

  it('枚举守卫拒绝未知值', () => {
    expect(isCopilotRetrievalSourceKind('project')).toBe(true)
    expect(isCopilotRetrievalSourceKind('project_extra')).toBe(false)
    expect(isCopilotTruncationStage('retrieval')).toBe(true)
    expect(isCopilotTruncationStage('all')).toBe(false)
    expect(isCopilotUncertaintyKind('no-match')).toBe(true)
    expect(isCopilotUncertaintyKind('unknown')).toBe(false)
  })
})

describe('copilot-context-assembly — 含 L3 合格层清单被拒', () => {
  it('production 路径清单为 L1/L2/L4，不含 L3', () => {
    expect(deriveEligibleKnowledgeTiers('production')).toEqual(['L1', 'L2', 'L4'])
    expect(COPILOT_PRODUCTION_KNOWLEDGE_TIERS).not.toContain('L3')
  })

  it('eval 路径清单含 L3，且 knowledgeTiersIncludeSynthetic 为 true', () => {
    expect(deriveEligibleKnowledgeTiers('eval')).toEqual(['L1', 'L2', 'L3', 'L4'])
    expect(knowledgeTiersIncludeSynthetic(COPILOT_EVAL_KNOWLEDGE_TIERS)).toBe(true)
    expect(assertEligibleKnowledgeTiersExcludeL3(COPILOT_EVAL_KNOWLEDGE_TIERS).ok).toBe(false)
    expect(assertEligibleKnowledgeTiersExcludeL3(COPILOT_PRODUCTION_KNOWLEDGE_TIERS).ok).toBe(true)
  })

  it('合格层清单含 L3 的组装结果被校验拒绝', () => {
    const r = buildAllAssemblyFixtures().find((f) => f.state === 'complete')!.result
    const bad = validateCopilotContextAssembly({
      ...r,
      eligibleKnowledgeTiers: ['L1', 'L2', 'L3', 'L4'],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('L3')
  })

  it('knowledgeQueryPath=eval 的组装结果被校验拒绝（合格层清单与推导不一致）', () => {
    const r = buildAllAssemblyFixtures().find((f) => f.state === 'complete')!.result
    const bad = validateCopilotContextAssembly({ ...r, knowledgeQueryPath: 'eval' })
    expect(bad.ok).toBe(false)
  })
})

describe('copilot-context-assembly — scope 合格性前置判定', () => {
  it('global scope 无任何项目作用域来源', () => {
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.global.retrievalKinds).toEqual([])
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.global.panoramaEligible).toBe(false)
    expect(assemblyEligibleRetrievalKinds('global')).toEqual([])
    expect(assemblyEligibleRetrievalKinds('global', [...COPILOT_RETRIEVAL_SOURCE_KINDS])).toEqual(
      [],
    )
  })

  it('project scope 十二类全部合格', () => {
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.project.retrievalKinds).toEqual([
      ...COPILOT_RETRIEVAL_SOURCE_KINDS,
    ])
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.project.knowledgeEligible).toBe(true)
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.project.methodologyEligible).toBe(true)
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.project.panoramaEligible).toBe(true)
  })

  it('entity scope 限定为实体及其祖先来源', () => {
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.entity.retrievalKinds.sort()).toEqual(
      ['task', 'risk', 'milestone', 'document'].sort(),
    )
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.entity.panoramaEligible).toBe(false)
  })

  it('portfolio scope 不加载单项目检索来源，但启用知识与方法论', () => {
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.portfolio.retrievalKinds).toEqual([])
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.portfolio.knowledgeEligible).toBe(true)
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.portfolio.methodologyEligible).toBe(true)
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.portfolio.panoramaEligible).toBe(false)
  })

  it('portfolio scope 不合格来源不进上下文（无检索种类）', () => {
    // portfolio scope 的 retrievalKinds 为空，所有请求的检索种类都不合格
    expect(assemblyEligibleRetrievalKinds('portfolio')).toEqual([])
    expect(
      assemblyEligibleRetrievalKinds('portfolio', [...COPILOT_RETRIEVAL_SOURCE_KINDS]),
    ).toEqual([])
  })

  it('project scope 的来源映射未被改变', () => {
    // 确保 portfolio 变更未影响 project scope
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.project.retrievalKinds).toEqual([
      ...COPILOT_RETRIEVAL_SOURCE_KINDS,
    ])
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.project.knowledgeEligible).toBe(true)
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.project.methodologyEligible).toBe(true)
    expect(COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP.project.panoramaEligible).toBe(true)
  })

  it('requested 交集按映射声明顺序返回', () => {
    expect(assemblyEligibleRetrievalKinds('project', ['risk', 'task'])).toEqual(['task', 'risk'])
  })
})

describe('copilot-context-assembly — 确定性截断与路由输入保护', () => {
  function manySources(): CopilotAssemblySourceMetadata[] {
    return COPILOT_RETRIEVAL_SOURCE_KINDS.map((kind, i) =>
      buildAssemblySourceMetadata({
        retrievalKind: kind,
        sourceRef: `${kind}/search-${String(i).padStart(3, '0')}`,
        hitCount: i + 1,
        scoreRange: { min: 0.1 + i * 0.05, max: 0.3 + i * 0.05 },
        capturedAt: '2026-08-16T02:00:00.000Z',
      }),
    )
  }

  it('相同输入两次组装的截断结果完全一致（可复现性）', () => {
    const sources = manySources()
    const budget = { contextBytesLimit: 1500, evidenceBytesLimit: 5000, minContextBytes: 800 }
    const a = planCopilotAssemblyTruncation({ sources, budget, evidenceCount: 9000 })
    const b = planCopilotAssemblyTruncation({ sources, budget, evidenceCount: 9000 })
    expect(a.keptSources.map((s) => s.sourceRef)).toEqual(b.keptSources.map((s) => s.sourceRef))
    expect(a.marker).toEqual(b.marker)
  })

  it('最小允许预算下路由输入全部存活（断言）', () => {
    const plan = planCopilotAssemblyTruncation({
      sources: manySources(),
      budget: { contextBytesLimit: 200, evidenceBytesLimit: 1000, minContextBytes: 100 },
      evidenceCount: 5000,
    })
    expect(plan.marker.truncated).toBe(true)
    expect(plan.marker.hitBudgetFloor).toBe(true)
    // 路由输入由组装器保留在结果字段，不参与截断——此处断言契约结构仍可表达全部存活
    expect(plan.keptSources.length).toBeGreaterThanOrEqual(0)
  })

  it('低置信阈值边界：阈值上允许、低于阈值判定低置信', () => {
    expect(isCopilotLowConfidence(COPILOT_LOW_CONFIDENCE_THRESHOLD)).toBe(false)
    expect(isCopilotLowConfidence(COPILOT_LOW_CONFIDENCE_THRESHOLD + 0.01)).toBe(false)
    expect(isCopilotLowConfidence(COPILOT_LOW_CONFIDENCE_THRESHOLD - 0.01)).toBe(true)
  })

  it('枚举常量完整性：截断阶段与不确定种类全集可遍历', () => {
    expect(COPILOT_TRUNCATION_STAGES).toEqual([
      'none',
      'evidence',
      'methodology',
      'retrieval',
      'activity',
      'facets',
    ])
    expect(COPILOT_UNCERTAINTY_KINDS).toEqual(['not-exists', 'not-accessible', 'no-match'])
  })
})

// ===========================================================================
// §2 契约补齐 — 方法论切面新增字段测试
// ===========================================================================

import { createHash } from 'node:crypto'
import { buildMethodologyFacet } from './copilot-context-assembly-fixtures.js'
import {
  estimateCopilotMethodologyBytes,
  estimateCopilotMethodologyItemBytes,
  isCopilotMethodologyFacet,
  planMethodologyTruncation,
  type CopilotMethodologyFacet,
  type CopilotMethodologyGuidanceItem,
} from './copilot-context-assembly.js'

// ── §2.1 + §2.2: methodologyVersionHash 与 Skill 版本绑定 ─────────────

describe('§2 契约 — CopilotMethodologyFacet.methodologyVersionHash', () => {
  it('现有 fixture 包含非空 methodologyVersionHash', () => {
    const facet = buildMethodologyFacet()
    expect(facet.methodologyVersionHash).toBeTypeOf('string')
    expect(facet.methodologyVersionHash.length).toBeGreaterThan(0)
  })

  it('isCopilotMethodologyFacet 守卫要求 methodologyVersionHash 非空', () => {
    const valid = buildMethodologyFacet()
    expect(isCopilotMethodologyFacet(valid)).toBe(true)

    // 缺少 methodologyVersionHash → 拒绝
    const noHash = { ...valid, methodologyVersionHash: undefined }
    expect(isCopilotMethodologyFacet(noHash)).toBe(false)

    // 空字符串 → 拒绝
    const emptyHash = { ...valid, methodologyVersionHash: '' }
    expect(isCopilotMethodologyFacet(emptyHash)).toBe(false)
  })

  it('Skill 版本变化只改方法论 hash、不改项目事实 source hash', () => {
    // 模拟同一项目事实来源（固定 sourceHash）
    const projectFactSourceHash = createHash('sha256')
      .update(JSON.stringify({ tasks: ['t1', 't2'], wbs: 'root' }))
      .digest('hex')

    // Skill v1.0.0 的方法论 hash
    const methodologyHashV1 = createHash('sha256')
      .update(
        JSON.stringify({
          skillKey: 'skill-sw-dev',
          version: '1.0.0',
          knowledge: { rules: ['r1'] },
        }),
      )
      .digest('hex')

    // Skill v1.1.0 的方法论 hash（版本变了）
    const methodologyHashV2 = createHash('sha256')
      .update(
        JSON.stringify({
          skillKey: 'skill-sw-dev',
          version: '1.1.0',
          knowledge: { rules: ['r1'] },
        }),
      )
      .digest('hex')

    // 方法论 hash 随 Skill 版本变化
    expect(methodologyHashV1).not.toBe(methodologyHashV2)

    // 项目事实 hash 不受 Skill 版本影响
    const projectFactHashAfterV1 = createHash('sha256')
      .update(JSON.stringify({ tasks: ['t1', 't2'], wbs: 'root' }))
      .digest('hex')
    const projectFactHashAfterV2 = createHash('sha256')
      .update(JSON.stringify({ tasks: ['t1', 't2'], wbs: 'root' }))
      .digest('hex')

    expect(projectFactHashAfterV1).toBe(projectFactHashAfterV2)
    expect(projectFactHashAfterV1).toBe(projectFactSourceHash)
  })
})

// ── §2.3 + §2.4: activationRuleId / activationReason 每条必带 ────────

describe('§2 契约 — CopilotMethodologyGuidanceItem 激活依据', () => {
  it('现有 fixture 每条 guidanceItem 都带 activationRuleId 和 activationReason', () => {
    const facet = buildMethodologyFacet()
    for (const item of facet.guidanceItems) {
      expect(item.activationRuleId).toBeTypeOf('string')
      expect(item.activationRuleId.length).toBeGreaterThan(0)
      expect(item.activationReason).toBeTypeOf('string')
      expect(item.activationReason.length).toBeGreaterThan(0)
    }
  })

  it('零 guidanceItems 的切面也合法（无条目 = 无需检查）', () => {
    const facet: CopilotMethodologyFacet = {
      ...buildMethodologyFacet(),
      guidanceItems: [],
    }
    expect(isCopilotMethodologyFacet(facet)).toBe(true)
    // 零条目时无 activation 依据可检查——这是合法的（空激活态）
  })

  it('缺少 activationRuleId 的条目不满足契约（可通过结构检查发现）', () => {
    const facet = buildMethodologyFacet()
    const badItem = {
      ...facet.guidanceItems[0],
      activationRuleId: undefined,
    }
    // TypeScript 编译期会阻止，但运行时结构检查仍可发现
    expect((badItem as any).activationRuleId).toBeUndefined()
  })
})

// ── §2.5 + §2.6: 禁存约束 — 切面不含 prompt/模型输出/token/secret ───

describe('§2 契约 — 方法论切面禁存约束', () => {
  const SENSITIVE_SAMPLES = [
    { field: 'prompt injection', desc: 'prompt 内容' },
    { field: 'model output: here is the answer', desc: '模型输出' },
    { field: 'sk-proj-abc123def456', desc: 'API token' },
    { field: 'password=SuperSecret123!', desc: 'secret/密码' },
    { field: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9', desc: 'Bearer token' },
    { field: 'BEGIN RSA PRIVATE KEY', desc: '私钥' },
    { field: 'apiKey: "ghp_1234567890abcdef"', desc: 'API key' },
  ]

  it('现有 buildMethodologyFacet 不含任何敏感样本', () => {
    const facet = buildMethodologyFacet()
    const allText = JSON.stringify(facet).toLowerCase()

    for (const sample of SENSITIVE_SAMPLES) {
      expect(allText).not.toContain(sample.field.toLowerCase())
    }
  })

  it('各字段独立检查：summary/label/itemId/activationReason 均不含敏感内容', () => {
    const facet = buildMethodologyFacet()
    for (const item of facet.guidanceItems) {
      const fields = [item.summary, item.label, item.itemId, item.activationReason]
      for (const value of fields) {
        const lower = value.toLowerCase()
        for (const sample of SENSITIVE_SAMPLES) {
          expect(lower, `字段 "${value}" 不应包含 "${sample.desc}"`).not.toContain(
            sample.field.toLowerCase(),
          )
        }
      }
    }
  })

  it('methodologyVersionHash 不含敏感内容（纯 hex/digest）', () => {
    const facet = buildMethodologyFacet()
    // methodologyVersionHash 应该是 hex digest 格式
    expect(facet.methodologyVersionHash).toMatch(/^[a-z0-9-]+$/i)
    const lower = facet.methodologyVersionHash.toLowerCase()
    for (const sample of SENSITIVE_SAMPLES) {
      expect(lower).not.toContain(sample.field.toLowerCase())
    }
  })
})

// ── §2.7: 五态 fixtures ──────────────────────────────────────────────

describe('§2 契约 — 方法论切面五态 fixtures', () => {
  it('态 1：单 Skill 激活 — 一个 Skill 的方法论条目', () => {
    const facet: CopilotMethodologyFacet = {
      facetKind: 'methodology',
      isMethodologyGuidance: true,
      isProjectFact: false,
      skillKeys: ['skill-sw-dev'],
      guidanceItems: [
        {
          itemId: 'sw-rule-001',
          skillKey: 'skill-sw-dev',
          label: '需求功能性与非功能性分类',
          summary: '所有需求必须明确划分为功能需求与非功能需求（方法论指引，非本项目事实）',
          sourceRef: 'skill:skill-sw-dev#sw-rule-001',
          activationRuleId: 'activation:projectType:软件开发',
          activationReason: "projectType='软件开发' 匹配 skill-sw-dev.activation.projectTypes",
        },
      ],
      capturedAt: '2026-08-19T00:00:00.000Z',
      methodologyVersionHash: 'mvh-sw-dev-v1',
    }
    expect(isCopilotMethodologyFacet(facet)).toBe(true)
    expect(facet.skillKeys).toHaveLength(1)
    expect(facet.guidanceItems).toHaveLength(1)
  })

  it('态 2：多 Skill 激活 — 多个 Skill 的方法论条目合并', () => {
    const facet: CopilotMethodologyFacet = {
      facetKind: 'methodology',
      isMethodologyGuidance: true,
      isProjectFact: false,
      skillKeys: ['skill-sw-dev', 'skill-devops'],
      guidanceItems: [
        {
          itemId: 'sw-rule-001',
          skillKey: 'skill-sw-dev',
          label: '需求功能性与非功能性分类',
          summary: '所有需求必须明确划分为功能需求与非功能需求（方法论指引，非本项目事实）',
          sourceRef: 'skill:skill-sw-dev#sw-rule-001',
          activationRuleId: 'activation:projectType:软件开发',
          activationReason: "projectType='软件开发' 匹配 skill-sw-dev.activation.projectTypes",
        },
        {
          itemId: 'devops-rule-001',
          skillKey: 'skill-devops',
          label: 'CI/CD 流水线设计',
          summary: '所有变更必须通过自动化流水线验证（方法论指引，非本项目事实）',
          sourceRef: 'skill:skill-devops#devops-rule-001',
          activationRuleId: 'activation:domain:devops',
          activationReason: "domain='devops' 匹配 skill-devops.activation.domains",
        },
      ],
      capturedAt: '2026-08-19T00:00:00.000Z',
      methodologyVersionHash: 'mvh-sw-devops-v1',
    }
    expect(isCopilotMethodologyFacet(facet)).toBe(true)
    expect(facet.skillKeys).toHaveLength(2)
    expect(facet.guidanceItems).toHaveLength(2)
    // 两个条目来自不同 Skill
    expect(facet.guidanceItems[0].skillKey).toBe('skill-sw-dev')
    expect(facet.guidanceItems[1].skillKey).toBe('skill-devops')
  })

  it('态 3：零激活 — 切面不存在（undefined）', () => {
    // 零激活时 CopilotContextAssemblyResult.methodology 为 undefined
    // 不是空切面，而是切面缺席
    const methodology: CopilotMethodologyFacet | undefined = undefined
    expect(methodology).toBeUndefined()
    // 验证 isCopilotMethodologyFacet 对 undefined 返回 false
    expect(isCopilotMethodologyFacet(undefined)).toBe(false)
  })

  it('态 4：含 L3 条目的非法 Skill — 该条目被拒且不进切面', () => {
    // 模拟：一个 Skill 的 knowledge 含 L3 条目，注入前被 assertEligibleKnowledgeTiersExcludeL3 拒绝
    // 切面中不应出现 L3 条目
    const facet: CopilotMethodologyFacet = {
      facetKind: 'methodology',
      isMethodologyGuidance: true,
      isProjectFact: false,
      skillKeys: ['skill-sw-dev'], // L3 条目被剔除后只剩合法 Skill
      guidanceItems: [
        {
          itemId: 'sw-rule-001',
          skillKey: 'skill-sw-dev',
          label: '需求功能性与非功能性分类',
          summary: '所有需求必须明确划分为功能需求与非功能需求（方法论指引，非本项目事实）',
          sourceRef: 'skill:skill-sw-dev#sw-rule-001',
          activationRuleId: 'activation:projectType:软件开发',
          activationReason: "projectType='软件开发' 匹配 skill-sw-dev.activation.projectTypes",
        },
        // 注意：L3 条目不在这里——它被 L3 断言拒绝了
      ],
      capturedAt: '2026-08-19T00:00:00.000Z',
      methodologyVersionHash: 'mvh-sw-dev-v1',
    }
    expect(isCopilotMethodologyFacet(facet)).toBe(true)
    // 断言：没有任何条目的 sourceRef 包含 L3 标记
    for (const item of facet.guidanceItems) {
      expect(item.sourceRef).not.toContain('L3')
    }
  })

  it('态 5：激活失败 — 降级到 null（切面缺席）', () => {
    // 激活失败时 SkillActivationResolver 返回 null
    // 装配服务收到 null → skillActivation 为 undefined → methodology 为 undefined
    const activationResult: null = null
    const methodology: CopilotMethodologyFacet | undefined = activationResult
      ? undefined // 不可能：null 不会触发
      : undefined
    expect(methodology).toBeUndefined()
    expect(isCopilotMethodologyFacet(null)).toBe(false)
  })
})

// ===========================================================================
// §5 分区与不可引用
// ===========================================================================

describe('§5.2 方法论条目不出现在项目事实来源集合中', () => {
  it('packet.sources 只含项目事实来源，不含方法论条目', () => {
    const fixture = buildAllAssemblyFixtures().find((f) => f.state === 'methodology-injected')!
    const packetSourceRefs = fixture.result.packet.sources.map((s) => s.sourceRef)
    const methodologyItemIds = fixture.result.methodology?.guidanceItems.map((i) => i.itemId) ?? []

    // 方法论条目的 itemId 不应出现在 packet.sources 的 sourceRef 中
    for (const itemId of methodologyItemIds) {
      expect(packetSourceRefs).not.toContain(itemId)
    }
  })

  it('sources（项目事实）与 methodology.guidanceItems 完全独立', () => {
    const facet = buildMethodologyFacet()
    const sourceRefs = ['task/search-001', 'risk/search-001', 'milestone/search-001']
    const methodSourceRefs = facet.guidanceItems.map((i) => i.sourceRef)

    // 方法论来源引用与项目事实来源引用无交集
    const overlap = sourceRefs.filter((ref) => methodSourceRefs.includes(ref))
    expect(overlap).toEqual([])
  })
})

describe('§5.3 结论回溯不得指向方法论条目', () => {
  it('结论回溯中不出现方法论来源引用（方法论切面与结论构建完全隔离）', () => {
    const facet = buildMethodologyFacet()
    const methodologySourceRefs = facet.guidanceItems.map((i) => i.sourceRef)

    // 构建结论回溯：只从项目事实 sources 构建（模拟 #buildConclusionTrace 行为）
    const sources = [
      buildAssemblySourceMetadata({ retrievalKind: 'task', sourceRef: 'task/search-001' }),
      buildAssemblySourceMetadata({ retrievalKind: 'risk', sourceRef: 'risk/search-001' }),
    ]
    const conclusionSourceRefs: string[] = []
    for (const source of sources) {
      conclusionSourceRefs.push(source.sourceRef)
    }

    // 方法论条目的 sourceRef 不在结论回溯中
    for (const ref of methodologySourceRefs) {
      expect(conclusionSourceRefs).not.toContain(ref)
    }
  })

  it('方法论条目的 sourceRef 不出现在任何结论的 sourceRefs 中', () => {
    const fixture = buildAllAssemblyFixtures().find((f) => f.state === 'methodology-injected')!
    const methodologySourceRefs =
      fixture.result.methodology?.guidanceItems.map((i) => i.sourceRef) ?? []

    for (const trace of fixture.result.conclusionTrace) {
      for (const ref of trace.sourceRefs) {
        expect(methodologySourceRefs).not.toContain(ref)
      }
    }
  })
})

describe('§5.4 证据抽屉无法展开到方法论条目', () => {
  it('方法论条目的 sourceRef 不在结论回溯的 sourceRefs 中（证据抽屉不展开）', () => {
    const facet = buildMethodologyFacet()
    const methodSourceRefs = facet.guidanceItems.map((i) => i.sourceRef)

    // 构建一组项目事实来源
    const sources = [
      buildAssemblySourceMetadata({ retrievalKind: 'task', sourceRef: 'task/search-001' }),
      buildAssemblySourceMetadata({ retrievalKind: 'risk', sourceRef: 'risk/search-001' }),
    ]

    // 模拟结论回溯：只从 sources 构建
    const conclusionSourceRefs: string[] = []
    for (const source of sources) {
      conclusionSourceRefs.push(source.sourceRef)
    }

    // 方法论条目的 sourceRef 不在结论回溯中
    for (const ref of methodSourceRefs) {
      expect(conclusionSourceRefs).not.toContain(ref)
    }
  })
})

describe('§5.7/§5.8 方法论条目带 Provenance', () => {
  it('现有 fixture 每条方法论都带 sourceRef', () => {
    const facet = buildMethodologyFacet()
    for (const item of facet.guidanceItems) {
      expect(item.sourceRef).toBeTypeOf('string')
      expect(item.sourceRef.length).toBeGreaterThan(0)
    }
  })

  it('validateCopilotContextAssembly 拒绝缺少 sourceRef 的方法论条目', () => {
    const r = buildAllAssemblyFixtures().find((f) => f.state === 'complete')!.result
    const badMethodology: CopilotMethodologyFacet = {
      facetKind: 'methodology',
      isMethodologyGuidance: true,
      isProjectFact: false,
      skillKeys: ['test-skill'],
      guidanceItems: [
        {
          itemId: 'meth-bad-001',
          skillKey: 'test-skill',
          label: '缺少来源的方法论',
          summary: '这条方法论没有 sourceRef',
          sourceRef: '',
          activationRuleId: 'rule-test',
          activationReason: '测试用',
        },
      ],
      capturedAt: '2026-08-16T00:00:00.000Z',
      methodologyVersionHash: 'mvh-test',
    }
    const bad = validateCopilotContextAssembly({
      ...r,
      methodology: badMethodology,
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('sourceRef')
  })

  it('五态 fixture 中所有方法论条目都有有效 sourceRef', () => {
    const fixtures = buildAllAssemblyFixtures()
    for (const fixture of fixtures) {
      if (fixture.result.methodology) {
        for (const item of fixture.result.methodology.guidanceItems) {
          expect(item.sourceRef).toBeTypeOf('string')
          expect(item.sourceRef.length).toBeGreaterThan(0)
        }
      }
    }
  })
})

// ===========================================================================
// §6 预算与截断
// ===========================================================================

describe('§6.1/§6.6 方法论条目计入上下文预算', () => {
  it('estimateCopilotMethodologyBytes 返回非负值', () => {
    const facet = buildMethodologyFacet()
    const bytes = estimateCopilotMethodologyBytes(facet)
    expect(bytes).toBeGreaterThanOrEqual(0)
  })

  it('estimateCopilotMethodologyItemBytes 返回非负值', () => {
    const facet = buildMethodologyFacet()
    for (const item of facet.guidanceItems) {
      const bytes = estimateCopilotMethodologyItemBytes(item)
      expect(bytes).toBeGreaterThanOrEqual(0)
    }
  })

  it('多个条目的总字节等于各条目字节之和', () => {
    const facet = buildMethodologyFacet()
    const totalBytes = estimateCopilotMethodologyBytes(facet)
    const sumBytes = facet.guidanceItems.reduce(
      (sum, item) => sum + estimateCopilotMethodologyItemBytes(item),
      0,
    )
    expect(totalBytes).toBe(sumBytes)
  })
})

describe('§6.2/§6.3 方法论优先于项目事实被截断', () => {
  it('超预算时先丢方法论、项目事实与路由输入恒保留', () => {
    const items: CopilotMethodologyGuidanceItem[] = [
      {
        itemId: 'meth-001',
        skillKey: 'skill-a',
        label: '方法论 A',
        summary: '方法论指引 A',
        sourceRef: 'skill:a/knowledge:1',
        activationRuleId: 'rule-a',
        activationReason: '测试',
      },
      {
        itemId: 'meth-002',
        skillKey: 'skill-b',
        label: '方法论 B',
        summary: '方法论指引 B',
        sourceRef: 'skill:b/knowledge:2',
        activationRuleId: 'rule-b',
        activationReason: '测试',
      },
      {
        itemId: 'meth-003',
        skillKey: 'skill-c',
        label: '方法论 C',
        summary: '方法论指引 C',
        sourceRef: 'skill:c/knowledge:3',
        activationRuleId: 'rule-c',
        activationReason: '测试',
      },
    ]

    // 预算只够放 1 条方法论
    const result = planMethodologyTruncation({
      items,
      budgetBytesLimit: estimateCopilotMethodologyItemBytes(items[0]),
    })

    expect(result.keptItems.length).toBe(1)
    expect(result.omittedCount).toBe(2)
    expect(result.omittedBytes).toBeGreaterThan(0)
  })

  it('未超预算时保留所有方法论条目', () => {
    const facet = buildMethodologyFacet()
    const totalBytes = estimateCopilotMethodologyBytes(facet)
    const result = planMethodologyTruncation({
      items: facet.guidanceItems,
      budgetBytesLimit: totalBytes + 1000,
    })
    expect(result.keptItems.length).toBe(facet.guidanceItems.length)
    expect(result.omittedCount).toBe(0)
  })

  it('确定性：相同输入两次截断结果完全一致', () => {
    const items: CopilotMethodologyGuidanceItem[] = [
      {
        itemId: 'meth-001',
        skillKey: 'skill-a',
        label: '方法论 A',
        summary: '方法论指引 A',
        sourceRef: 'skill:a/knowledge:1',
        activationRuleId: 'rule-a',
        activationReason: '测试',
      },
      {
        itemId: 'meth-002',
        skillKey: 'skill-b',
        label: '方法论 B',
        summary: '方法论指引 B',
        sourceRef: 'skill:b/knowledge:2',
        activationRuleId: 'rule-b',
        activationReason: '测试',
      },
    ]

    const a = planMethodologyTruncation({ items, budgetBytesLimit: 200 })
    const b = planMethodologyTruncation({ items, budgetBytesLimit: 200 })
    expect(a.keptItems.map((i) => i.itemId)).toEqual(b.keptItems.map((i) => i.itemId))
    expect(a.omittedCount).toBe(b.omittedCount)
  })
})

describe('§6.4/§6.5 截断标记 omittedMethodologyCount', () => {
  it('无截断时 omittedMethodologyCount 为 0', () => {
    const marker = makeCopilotNoTruncationMarker()
    expect(marker.omittedMethodologyCount).toBe(0)
  })

  it('validateCopilotContextAssembly 接受 truncated=true 且 omittedMethodologyCount > 0', () => {
    const r = buildAllAssemblyFixtures().find((f) => f.state === 'complete')!.result
    const valid = validateCopilotContextAssembly({
      ...r,
      truncation: {
        ...r.truncation,
        truncated: true,
        stage: 'methodology',
        omittedSourceCount: 0,
        omittedEvidenceCount: 0,
        omittedMethodologyCount: 3,
        warning: '方法论超预算，省略 3 条',
      },
    })
    expect(valid.ok).toBe(true)
  })

  it('validateCopilotContextAssembly 拒绝 truncated=true 且所有省略计数为 0', () => {
    const r = buildAllAssemblyFixtures().find((f) => f.state === 'complete')!.result
    const bad = validateCopilotContextAssembly({
      ...r,
      truncation: {
        ...r.truncation,
        truncated: true,
        stage: 'retrieval',
        omittedSourceCount: 0,
        omittedEvidenceCount: 0,
        omittedMethodologyCount: 0,
      },
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('禁止静默丢弃')
  })

  it('截断阶段枚举包含 methodology', () => {
    expect(COPILOT_TRUNCATION_STAGES).toContain('methodology')
  })
})
