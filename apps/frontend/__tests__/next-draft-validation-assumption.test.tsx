import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { AiMarker, DraftValidationReport, Marked, ProjectDraft } from '@aiproj/types'
import { PROJECT_DRAFT_SCHEMA_VERSION } from '@aiproj/types'
import { extractDraftAssumptions } from '@/lib/next/draft-review-helpers'
import { NextDraftAssumptionList } from '@/components/next/review/NextDraftAssumptionList'
import { NextDraftAutoFixDiff } from '@/components/next/review/NextDraftAutoFixDiff'
import { NextDraftValidationReport } from '@/components/next/review/NextDraftValidationReport'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function marked<T>(value: T, marker: Partial<AiMarker> = {}): Marked<T> {
  return {
    value,
    marker: {
      confidence: 0.8,
      source: 'inferred',
      reason: '默认推断理由',
      needsConfirmation: false,
      ...marker,
    },
  }
}

/** 覆盖 9 模块的完整草案夹具；needsConfirmation === true 字段共 12 个（高影响 9 个）。 */
function buildDraft(): ProjectDraft {
  return {
    schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
    projectType: 'software',
    charter: {
      title: marked('电商管理后台'),
      vision: marked('统一数字化运营'),
      scope: marked('订单、商品与客户管理'),
      objectives: marked(['上线订单管理', '上线商品管理']),
      successCriteria: marked(['订单流程可用']),
      startDate: marked('2026-07-01', {
        needsConfirmation: true,
        confidence: 0.9,
        reason: '根据业务启动诉求推断起始日期',
      }),
      endDate: marked('2026-10-31', {
        needsConfirmation: true,
        confidence: 0.82,
        reason: '根据里程碑倒排推断结束日期为 10 月底',
      }),
    },
    wbs: [
      {
        id: 'wbs-1',
        parentId: null,
        outlineCode: '1',
        isLeaf: false,
        isNote: false,
        name: marked('基础平台'),
        description: marked('平台基础能力建设', {
          needsConfirmation: true,
          confidence: 0.6,
          reason: '依据行业惯例推断范围覆盖',
        }),
        children: [],
      },
    ],
    tasks: [
      {
        id: 'task-1',
        wbsNodeId: 'wbs-1',
        status: 'not_started',
        name: marked('核心算法实现'),
        description: marked('实现核心算法模块'),
        durationDays: marked(10, {
          needsConfirmation: true,
          confidence: 0.75,
          reason: '根据类似算法复杂度与历史交付经验推算工期需 10 个工作日',
        }),
        startDate: marked('2026-07-06', {
          needsConfirmation: true,
          confidence: 0.7,
          reason: '按资源到位时间推断',
        }),
        endDate: marked('2026-07-17', {
          needsConfirmation: true,
          confidence: 0.7,
          reason: '按 10 天工期顺排',
        }),
        assigneeHint: marked('高级算法工程师', {
          needsConfirmation: true,
          confidence: 0.68,
          reason: '按角色技能匹配推断负责人',
        }),
      },
      {
        id: 'task-2',
        wbsNodeId: 'wbs-1',
        status: 'not_started',
        name: marked('需求分析'),
        description: marked('收集并整理需求'),
        durationDays: marked(3),
        startDate: marked('2026-07-01'),
        endDate: marked('2026-07-03'),
        assigneeHint: marked('产品经理'),
      },
    ],
    dependencies: [
      {
        id: 'dep-1',
        predecessorId: 'task-1',
        successorId: 'task-2',
        type: 'FS',
        lagDays: marked(2, {
          needsConfirmation: true,
          confidence: 0.55,
          reason: '按交付缓冲推断滞后 2 天',
        }),
      },
    ],
    acceptanceCriteria: [
      {
        id: 'acc-1',
        statement: marked('后台可创建订单'),
        linkedTaskId: null,
        linkedSuccessIndex: 0,
      },
    ],
    resourceHints: [
      {
        id: 'res-1',
        role: marked('后端开发'),
        headcount: marked(3),
        allocationNote: marked('全职投入'),
      },
    ],
    riskHints: [
      {
        id: 'risk-1',
        description: marked('第三方支付接口不稳定'),
        level: marked('high', {
          needsConfirmation: true,
          confidence: 0.72,
          reason: '根据历史集成经验推断风险等级为高',
        }),
        mitigation: marked('预留备用支付通道'),
      },
    ],
    milestoneHints: [
      {
        id: 'ms-1',
        name: marked('联调完成', {
          needsConfirmation: true,
          confidence: 0.65,
          reason: '按排期倒排推断联调完成时间',
        }),
        targetDate: marked('2026-09-30', {
          needsConfirmation: true,
          confidence: 0.66,
          reason: '按里程碑序列推断目标日期',
        }),
        linkedTaskIds: [],
      },
    ],
    ganttPreview: {
      startDate: marked('2026-07-01', {
        needsConfirmation: true,
        confidence: 0.9,
        reason: '依据章程起始日推断',
      }),
      endDate: marked('2026-10-31'),
      totalDurationDays: marked(87),
      criticalPathTaskIds: ['task-1'],
      phaseCount: 3,
    },
  }
}

/** 深拷贝后将全部 Marked 字段的 needsConfirmation 置 false（模拟无待确认假设草案）。 */
function clearNeedsConfirmation(draft: ProjectDraft): ProjectDraft {
  const clone = structuredClone(draft) as ProjectDraft
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record.marker !== null && typeof record.marker === 'object') {
      ;(record.marker as { needsConfirmation: boolean }).needsConfirmation = false
      return
    }
    for (const value of Object.values(record)) walk(value)
  }
  walk(clone)
  return clone
}

function buildReport(overrides: Partial<DraftValidationReport> = {}): DraftValidationReport {
  return {
    overallRiskLevel: 'low',
    confidenceScore: 84,
    dimensionScores: {
      factualAccuracy: 88,
      logicalConsistency: 85,
      assumptionClarity: 80,
      completeness: 90,
      numericPlausibility: 78,
    },
    blocking: [],
    warning: [],
    info: [],
    ruleResults: [],
    autoFixDiffs: [],
    canConfirm: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// W2.1 extractDraftAssumptions：AIMarker 待确认假设遍历提取
// ---------------------------------------------------------------------------

describe('extractDraftAssumptions', () => {
  test('只提取 needsConfirmation === true 的 Marked 字段，路径与遍历顺序确定', () => {
    const items = extractDraftAssumptions(buildDraft())
    expect(items.map((item) => item.path)).toEqual([
      'charter.startDate',
      'charter.endDate',
      'wbs[0].description',
      'tasks[0].durationDays',
      'tasks[0].startDate',
      'tasks[0].endDate',
      'tasks[0].assigneeHint',
      'dependencies[0].lagDays',
      'riskHints[0].level',
      'milestoneHints[0].name',
      'milestoneHints[0].targetDate',
      'ganttPreview.startDate',
    ])
  })

  test('条目携带解包取值、来源分类、置信度与中文理由', () => {
    const item = extractDraftAssumptions(buildDraft()).find(
      (candidate) => candidate.path === 'tasks[0].durationDays',
    )
    expect(item).toBeDefined()
    expect(item?.value).toBe(10)
    expect(item?.source).toBe('inferred')
    expect(item?.confidence).toBe(0.75)
    expect(item?.reason).toBe('根据类似算法复杂度与历史交付经验推算工期需 10 个工作日')
    expect(item?.moduleName).toBe('任务清单')
    expect(item?.id).toBe('tasks[0].durationDays')
  })

  test('高影响清单命中：工期/起止日/负责人/滞后天数/风险等级/里程碑日期', () => {
    const items = extractDraftAssumptions(buildDraft())
    const highImpactPaths = items.filter((item) => item.isHighImpact).map((item) => item.path)
    expect(highImpactPaths).toEqual([
      'charter.startDate',
      'charter.endDate',
      'tasks[0].durationDays',
      'tasks[0].startDate',
      'tasks[0].endDate',
      'tasks[0].assigneeHint',
      'dependencies[0].lagDays',
      'riskHints[0].level',
      'milestoneHints[0].targetDate',
    ])
    // 依据 PROJECT_DRAFT_HIGH_IMPACT_FIELDS 权威清单：ganttPreview 起止日为章程起止日的投影，不重复标高影响
    expect(items.find((item) => item.path === 'ganttPreview.startDate')?.isHighImpact).toBe(false)
    const nonImpact = items.find((item) => item.path === 'wbs[0].description')
    expect(nonImpact?.isHighImpact).toBe(false)
    expect(items.find((item) => item.path === 'milestoneHints[0].name')?.isHighImpact).toBe(false)
  })

  test('label 解析：任务以名称为主体、章程与风险以模块为前缀、WBS 携带节点名', () => {
    const items = extractDraftAssumptions(buildDraft())
    const byPath = new Map(items.map((item) => [item.path, item]))
    expect(byPath.get('tasks[0].durationDays')?.label).toBe('任务: 核心算法实现 - 预估工期')
    expect(byPath.get('charter.endDate')?.label).toBe('项目章程 - 计划结束日')
    expect(byPath.get('wbs[0].description')?.label).toBe('WBS 节点: 基础平台 - 描述')
    expect(byPath.get('riskHints[0].level')?.label).toBe('风险提示 - 风险等级')
    expect(byPath.get('ganttPreview.startDate')?.label).toBe('甘特预览 - 计划起始日')
    expect(byPath.get('tasks[0].assigneeHint')?.label).toBe('任务: 核心算法实现 - 负责人建议')
  })
})

// ---------------------------------------------------------------------------
// W2.2 NextDraftAssumptionList：假设清单卡片
// ---------------------------------------------------------------------------

describe('NextDraftAssumptionList', () => {
  test('渲染常驻提示、来源分类、置信度百分比、中文理由与高影响琥珀徽章', () => {
    const { container } = render(<NextDraftAssumptionList draft={buildDraft()} />)
    expect(screen.getByText('AI 假设检查清单')).toBeInTheDocument()
    expect(screen.getByText('12 项待确认')).toBeInTheDocument()
    expect(
      screen.getByText('以下要素由 AI 启发式推断得出，待确认转正阶段人工裁决'),
    ).toBeInTheDocument()
    expect(screen.getByText('任务: 核心算法实现 - 预估工期')).toBeInTheDocument()
    expect(screen.getByText('tasks[0].durationDays')).toBeInTheDocument()
    expect(screen.getByText('10 天')).toBeInTheDocument()
    expect(screen.getByText('置信度: 75%')).toBeInTheDocument()
    expect(screen.getAllByText('AI 推断（inferred）').length).toBeGreaterThan(0)
    expect(
      screen.getByText('根据类似算法复杂度与历史交付经验推算工期需 10 个工作日'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('高影响假设').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-assumption-high-impact="true"]').length).toBe(9)
  })

  test('无待确认假设时展示安静通过空态', () => {
    render(<NextDraftAssumptionList draft={clearNeedsConfirmation(buildDraft())} />)
    expect(
      screen.getByText('自检完毕，本次生成未检测到需特别关注的高风险推断假设'),
    ).toBeInTheDocument()
    expect(screen.getByText('0 项待确认')).toBeInTheDocument()
    expect(screen.queryByText('高影响假设')).not.toBeInTheDocument()
  })

  test('draft 为 null 时静默不渲染（由主容器兜底）', () => {
    const { container } = render(<NextDraftAssumptionList draft={null} />)
    expect(container.querySelector('[data-next-assumption-list]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// W2.3 NextDraftValidationReport：反幻觉五维自检报告
// ---------------------------------------------------------------------------

describe('NextDraftValidationReport', () => {
  test('五维能量条：中文维度名、既定权重标签、实测得分与综合置信度', () => {
    const { container } = render(<NextDraftValidationReport validation={buildReport()} />)
    expect(screen.getByText('反幻觉自检报告')).toBeInTheDocument()
    for (const label of ['事实准确性', '逻辑一致性', '假设清晰度', '完整性', '数值合理性']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    for (const weight of ['0.30', '0.25', '0.20', '0.10', '0.15']) {
      expect(screen.getAllByText(`权重 ${weight}`).length).toBe(1)
    }
    const factual = container.querySelector('[data-dimension="factualAccuracy"]')
    expect(factual).not.toBeNull()
    expect(within(factual as HTMLElement).getByText('88')).toBeInTheDocument()
    const bar = factual?.querySelector('[data-dimension-score]') as HTMLElement
    expect(bar.style.width).toBe('88%')
    expect(
      container.querySelector('[data-dimension="numericPlausibility"]')?.textContent,
    ).toContain('权重 0.15')
    expect(
      container.querySelector('[data-dimension="numericPlausibility"]')?.textContent,
    ).toContain('78')
    expect(container.querySelector('[data-confidence-score]')?.textContent).toBe('84')
  })

  test.each([
    ['low', '低风险'],
    ['medium', '中风险'],
    ['high', '高风险'],
    ['critical', '严重风险'],
  ] as const)('整体风险等级徽章：%s → %s（颜色 + 图标 + 中文双通道）', (level, label) => {
    render(<NextDraftValidationReport validation={buildReport({ overallRiskLevel: level })} />)
    const badge = screen.getByText(label)
    expect(badge).toBeInTheDocument()
    expect(badge.closest('[data-risk-level]')?.getAttribute('data-risk-level')).toBe(level)
  })

  test('Blocking 与 Warning 分组明细：规则 ID、严重度、消息与字段路径', () => {
    render(
      <NextDraftValidationReport
        validation={buildReport({
          overallRiskLevel: 'medium',
          canConfirm: false,
          blocking: [
            {
              ruleId: 'HL-007',
              severity: 'blocking',
              message: '检测到任务依赖循环：task-1 -> task-2 -> task-1',
              path: 'dependencies',
            },
          ],
          warning: [
            {
              ruleId: 'HL-004',
              severity: 'warning',
              message: '假设清晰度警告',
              path: 'charter.endDate',
            },
          ],
        })}
      />,
    )
    expect(screen.getByText('阻断项（1）')).toBeInTheDocument()
    expect(screen.getByText('[HL-007]')).toBeInTheDocument()
    expect(screen.getByText('阻断')).toBeInTheDocument()
    expect(screen.getByText('检测到任务依赖循环：task-1 -> task-2 -> task-1')).toBeInTheDocument()
    expect(screen.getByText('dependencies')).toBeInTheDocument()
    expect(screen.getByText('警告项（1）')).toBeInTheDocument()
    expect(screen.getByText('[HL-004]')).toBeInTheDocument()
    expect(screen.getByText('警告')).toBeInTheDocument()
    expect(screen.getByText('假设清晰度警告')).toBeInTheDocument()
    expect(screen.getByText('charter.endDate')).toBeInTheDocument()
  })

  test('零违规时展示「无阻断项 / 无警告项」中性提示', () => {
    render(<NextDraftValidationReport validation={buildReport()} />)
    expect(screen.getByText('阻断项（0）')).toBeInTheDocument()
    expect(screen.getByText('无阻断项')).toBeInTheDocument()
    expect(screen.getByText('警告项（0）')).toBeInTheDocument()
    expect(screen.getByText('无警告项')).toBeInTheDocument()
  })

  test('validation 为 null 时静默不渲染（由主容器兜底）', () => {
    const { container } = render(<NextDraftValidationReport validation={null} />)
    expect(container.querySelector('[data-next-validation-report]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// W2.4 NextDraftAutoFixDiff：自动修正对比
// ---------------------------------------------------------------------------

describe('NextDraftAutoFixDiff', () => {
  test('Diff 对比卡：路径、修正前删除线、修正后高亮、修正原因与工期「天」单位', () => {
    const { container } = render(
      <NextDraftAutoFixDiff
        diffs={[
          {
            path: 'tasks[1].durationDays',
            before: 0,
            after: 1,
            reason: 'HL-002 规则要求单任务工期至少 0.5 天',
          },
        ]}
      />,
    )
    expect(screen.getByText('自动修正 Diff')).toBeInTheDocument()
    expect(screen.getByText('1 处')).toBeInTheDocument()
    expect(screen.getByText('tasks[1].durationDays')).toBeInTheDocument()
    const before = container.querySelector('[data-fix-diff-before]') as HTMLElement
    expect(before.textContent).toBe('0 天')
    expect(before).toHaveClass('line-through')
    const after = container.querySelector('[data-fix-diff-after]') as HTMLElement
    expect(after.textContent).toBe('1 天')
    expect(after).toHaveClass('text-[var(--nx-status-success)]')
    expect(screen.getByText('HL-002 规则要求单任务工期至少 0.5 天')).toBeInTheDocument()
  })

  test('空数组时展示「系统自检完成，无自动修正调整」只读提示', () => {
    render(<NextDraftAutoFixDiff diffs={[]} />)
    expect(screen.getByText('系统自检完成，无自动修正调整')).toBeInTheDocument()
    expect(screen.queryByText('1 处')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// W2.5 红线断言：审查态零表单写操作入口（RL-01 / RL-06）
// ---------------------------------------------------------------------------

describe('只读红线（RL-01 / RL-06）', () => {
  test('三个组件不渲染任何表单控件、按钮、链接或写操作入口（只读「汇出报告卡」按钮除外）', () => {
    const { container: assumptions } = render(<NextDraftAssumptionList draft={buildDraft()} />)
    const { container: report } = render(
      <NextDraftValidationReport
        validation={buildReport({
          blocking: [
            { ruleId: 'HL-001', severity: 'blocking', message: '事实一致性失败', path: 'charter' },
          ],
        })}
      />,
    )
    const { container: diff } = render(
      <NextDraftAutoFixDiff
        diffs={[{ path: 'tasks[0].durationDays', before: 0, after: 1, reason: '修正' }]}
      />,
    )
    for (const container of [assumptions, report, diff]) {
      // v3-ui-next-chart-export W2 在报告头部新增只读「汇出报告卡」按钮
      // （[data-validation-report-export]，导出衍生入口而非写操作入口）——
      // 从「零控件」断言中显式排除，其余表单/按钮/链接零容忍。
      const intrusion = Array.from(
        container.querySelectorAll('input, button, select, textarea, form, a, [role="button"]'),
      ).filter((el) => !(el instanceof HTMLElement && el.dataset.validationReportExport === 'true'))
      expect(intrusion).toHaveLength(0)
    }
  })
})
