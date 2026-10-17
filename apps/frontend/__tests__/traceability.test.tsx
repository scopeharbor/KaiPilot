import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EntitySourceSummary } from '@/components/traceability/entity-source-summary'
import { SourceAttributionDetail } from '@/components/traceability/source-attribution-detail'
import { TraceabilityLinksList } from '@/components/traceability/traceability-links-list'
import type {
  EntitySourceAttribution,
  AttributionDetail,
  TraceabilityLink,
} from '@/lib/api/traceability'

// ---------------------------------------------------------------------------
// 夹具数据
// ---------------------------------------------------------------------------

function makeEntitySourceAttribution(
  overrides: Partial<EntitySourceAttribution> = {},
): EntitySourceAttribution {
  return {
    entityId: 'task_001',
    entityType: 'task',
    hasFieldLevel: true,
    fieldAttributions: [
      {
        fieldPath: 'title',
        generatedBy: 'llm',
        confidence: 0.92,
        summary: 'AI 根据 Objective 推断',
        attributionId: 10,
      },
    ],
    entityAttribution: {
      attributionId: 1,
      generatedBy: 'llm',
      stageId: 'stage_2_3',
      confidence: 0.85,
      summary: '由 LLM 在任务拆解阶段生成',
      humanReviewStatus: 'reviewed_and_accepted',
      evidenceCount: 3,
      sourceRefCount: 2,
    },
    ...overrides,
  }
}

function makeAttributionDetail(overrides: Partial<AttributionDetail> = {}): AttributionDetail {
  return {
    id: 1,
    compilerRunId: 42,
    draftSessionId: null,
    stageId: 'stage_2_3',
    entityId: 'task_001',
    fieldPath: null,
    sourceRefs: [
      {
        refId: 'ctx_pkt_abc123',
        artifactKind: 'context_packet',
        version: 1,
        summaryLevel: 'compact',
        label: '任务上下文',
        organizationId: 1,
      },
    ],
    generatedBy: {
      kind: 'llm',
      provider: 'anthropic',
      model: 'claude-5',
      ruleId: null,
    },
    confidence: 0.85,
    assumptions: ['任务名称符合命名规范', '前置依赖已满足'],
    summary: '由 LLM 在任务拆解阶段根据工作包描述生成',
    evidenceSnippets: [
      {
        refId: 'ref_001',
        label: '生成依据',
        snippet: '根据工作包"用户认证模块"描述生成任务"实现登录接口"',
        charOffset: 0,
        charLength: 30,
        contentHash: 'abc123def456',
      },
    ],
    humanReviewStatus: 'reviewed_and_accepted',
    humanReviewedBy: 5,
    createdAt: '2026-07-10T08:00:00.000Z',
    ...overrides,
  }
}

function makeTraceabilityLink(overrides: Partial<TraceabilityLink> = {}): TraceabilityLink {
  return {
    linkId: 1,
    relationType: 'decomposes_into',
    direction: 'unidirectional',
    sourceEntityType: 'objective',
    sourceEntityId: 'obj_001',
    targetEntityType: 'deliverable',
    targetEntityId: 'del_002',
    strength: 1,
    attributionId: 1,
    createdAt: '2026-07-10T08:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// EntitySourceSummary
// ---------------------------------------------------------------------------

describe('EntitySourceSummary', () => {
  test('渲染实体级来源归因信息', () => {
    const attribution = makeEntitySourceAttribution()
    render(<EntitySourceSummary attribution={attribution} />)

    // 标题
    expect(screen.getByText('来源追溯')).toBeInTheDocument()
    // 实体类型与 ID
    expect(screen.getByText(/task/)).toBeInTheDocument()
    expect(screen.getByText(/task_001/)).toBeInTheDocument()
    // 生成方式（实体级 + 字段级共两个）
    const llmBadges = screen.getAllByText('LLM 生成')
    expect(llmBadges).toHaveLength(2)
    // 阶段
    expect(screen.getByText(/阶段: stage_2_3/)).toBeInTheDocument()
    // 审查状态
    expect(screen.getByText('已确认')).toBeInTheDocument()
    // 置信度
    expect(screen.getByText('85%')).toBeInTheDocument()
    // 统计数字
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    // 字段级归因
    expect(screen.getByText('标题')).toBeInTheDocument()
    expect(screen.getByText('92%')).toBeInTheDocument()
  })

  test('entityAttribution 为 null 时显示空状态', () => {
    const attribution = makeEntitySourceAttribution({
      entityAttribution: null,
      fieldAttributions: [],
    })
    render(<EntitySourceSummary attribution={attribution} />)

    expect(screen.getByText('暂无来源归因信息')).toBeInTheDocument()
    // 不应渲染字段级区域
    expect(screen.queryByText('字段级别归因')).not.toBeInTheDocument()
  })

  test('无字段级归因时不渲染字段区域', () => {
    const attribution = makeEntitySourceAttribution({
      fieldAttributions: [],
      hasFieldLevel: false,
    })
    render(<EntitySourceSummary attribution={attribution} />)

    expect(screen.queryByText('字段级别归因')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// SourceAttributionDetail
// ---------------------------------------------------------------------------

describe('SourceAttributionDetail', () => {
  test('渲染完整归因详情', () => {
    const detail = makeAttributionDetail()
    render(<SourceAttributionDetail attribution={detail} />)

    // 标题
    expect(screen.getByText('归因详情')).toBeInTheDocument()
    // 生成信息
    expect(screen.getByText('LLM 生成')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('claude-5')).toBeInTheDocument()
    // 阶段
    expect(screen.getByText('stage_2_3')).toBeInTheDocument()
    // 置信度
    expect(screen.getByText('85%')).toBeInTheDocument()
    // 假设列表
    expect(screen.getByText('任务名称符合命名规范')).toBeInTheDocument()
    expect(screen.getByText('前置依赖已满足')).toBeInTheDocument()
    // 摘要
    expect(screen.getByText(/由 LLM 在任务拆解阶段/)).toBeInTheDocument()
    // 证据片段
    expect(screen.getByText('生成依据')).toBeInTheDocument()
    expect(
      screen.getByText(/根据工作包.*用户认证模块.*描述生成任务.*实现登录接口/),
    ).toBeInTheDocument()
    // hash 片段
    expect(screen.getByText(/abc123def456/)).toBeInTheDocument()
    // 审查状态
    expect(screen.getByText('已确认')).toBeInTheDocument()
    expect(screen.getByText(/审查人: #5/)).toBeInTheDocument()
    // 来源引用
    expect(screen.getByText('上下文包')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText(/ctx_pkt_abc123/)).toBeInTheDocument()
  })

  test('assumptions 为空数组时不渲染假设列表', () => {
    const detail = makeAttributionDetail({ assumptions: [] })
    render(<SourceAttributionDetail attribution={detail} />)

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText('无假设记录')).toBeInTheDocument()
  })

  test('evidenceSnippets 为 null 时不渲染证据区域', () => {
    const detail = makeAttributionDetail({ evidenceSnippets: null })
    render(<SourceAttributionDetail attribution={detail} />)

    expect(screen.queryByText('证据片段')).not.toBeInTheDocument()
  })

  test('draftSessionId 非 null 时显示草案会话编号', () => {
    const detail = makeAttributionDetail({ draftSessionId: 7 })
    render(<SourceAttributionDetail attribution={detail} />)

    expect(screen.getByText('#7')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// TraceabilityLinksList
// ---------------------------------------------------------------------------

describe('TraceabilityLinksList', () => {
  test('渲染追溯链接列表', () => {
    const link = makeTraceabilityLink()
    render(<TraceabilityLinksList links={[link]} />)

    // 统计
    expect(screen.getByText('追溯链接 (1)')).toBeInTheDocument()
    // 关系类型
    expect(screen.getByText('分解为')).toBeInTheDocument()
    // 强度
    expect(screen.getByText('强')).toBeInTheDocument()
    // 方向
    expect(screen.getByText('单向')).toBeInTheDocument()
    // 源/目标实体
    expect(screen.getByText('目标')).toBeInTheDocument()
    expect(screen.getByText('obj_001')).toBeInTheDocument()
    expect(screen.getByText('del_002')).toBeInTheDocument()
    expect(screen.getByText('交付物')).toBeInTheDocument()
    // attribution
    expect(screen.getByText(/归因: #1/)).toBeInTheDocument()
  })

  test('空列表显示空状态', () => {
    render(<TraceabilityLinksList links={[]} />)

    expect(screen.getByText('追溯链接')).toBeInTheDocument()
    expect(screen.getByText(/暂无追溯链接/)).toBeInTheDocument()
  })

  test('多条链接以分隔线隔开', () => {
    const link1 = makeTraceabilityLink()
    const link2 = makeTraceabilityLink({
      linkId: 2,
      relationType: 'affects',
      sourceEntityType: 'risk',
      sourceEntityId: 'risk_001',
      targetEntityType: 'task',
      targetEntityId: 'task_002',
    })
    render(<TraceabilityLinksList links={[link1, link2]} />)

    // 两条链接都存在
    expect(screen.getByText('分解为')).toBeInTheDocument()
    expect(screen.getByText('影响')).toBeInTheDocument()
    expect(screen.getByText('风险')).toBeInTheDocument()
    expect(screen.getByText('任务')).toBeInTheDocument()
  })

  test('attributionId 为 null 时不显示归因编号', () => {
    const link = makeTraceabilityLink({ attributionId: null })
    render(<TraceabilityLinksList links={[link]} />)

    expect(screen.queryByText(/归因: #/)).not.toBeInTheDocument()
  })
})
