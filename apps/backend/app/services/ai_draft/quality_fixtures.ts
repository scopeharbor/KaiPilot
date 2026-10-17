import type { ConfirmedProjectContext, Marked, ProjectDraft } from '@aiproj/types'
import { fixtureDraft } from './fixtures.ts'

function explicit<T extends string | number | string[]>(value: T): Marked<T> {
  return {
    value,
    marker: {
      source: 'explicit',
      confidence: 1,
      reason: '离线质量回归夹具中的已确认事实。',
      needsConfirmation: false,
    },
  }
}

/** 不含生产数据或真实凭据的固定回归输入。 */
export const INTERNAL_TICKET_QUALITY_CONTEXT: ConfirmedProjectContext = {
  schemaVersion: '1.0',
  rawInput: '离线夹具：为运营团队建设内部工单系统。',
  parsedIntent: {
    schemaVersion: '1.0',
    projectType: 'software',
    projectName: '运营工单协作系统',
    objectives: ['统一受理内部工单并按 SLA 跟踪处理时效'],
    deliverables: ['工单受理、升级与数据看板'],
    timeline: { startDate: '2026-09-01', deadline: '2026-10-30', durationDays: 60 },
    constraints: ['仅供内部使用'],
    entities: [
      {
        type: 'role',
        value: '5 人运营团队',
        text: '5 人运营团队',
        start: 0,
        end: 7,
        confidence: 1,
        source: 'explicit',
      },
    ],
    overallConfidence: 1,
  },
  resolvedFields: {
    projectGoal: explicit('统一受理内部工单并按 SLA 跟踪处理时效'),
    corePain: explicit('150 名员工的请求分散在多个渠道，容易遗漏且无法追踪升级'),
    targetUser: explicit('150 名内部员工与 5 人运营团队'),
    successMetrics: explicit('2026-10-30 前完成验收，工单遗漏率低于 1%'),
    scopeBoundary: explicit('首期包含工单受理、SLA、升级和数据看板；不包含 OA 请假报销审批'),
    teamSize: explicit(5),
    startDate: explicit('2026-09-01'),
    performanceTarget: explicit('150 名员工并发使用时核心页面响应低于 2 秒'),
    rolloutStrategy: explicit('先由 20 名员工试点，再分批推广至 150 名员工'),
  },
  assumptions: {},
  unresolvedCriticalFields: [],
  unansweredOptionalFields: [],
}

export function correctInternalTicketDraft(): ProjectDraft {
  const draft = structuredClone(fixtureDraft('software'))
  draft.charter.title.value = '运营工单协作系统'
  draft.charter.vision.value = '为 150 名内部员工与 5 人运营团队建立统一、可追踪的服务请求闭环。'
  draft.charter.scope.value =
    '首期包含工单受理、SLA、升级和数据看板；不包含 OA 请假报销审批。先由 20 名员工试点，再分批推广至 150 名员工。'
  draft.charter.objectives.value = ['统一受理内部工单并按 SLA 跟踪处理时效']
  draft.charter.successCriteria.value = [
    '2026-10-30 前完成验收，工单遗漏率低于 1%',
    '150 名员工并发使用时核心页面响应低于 2 秒',
  ]
  draft.charter.startDate.value = '2026-09-01'
  draft.charter.endDate.value = '2026-10-30'
  draft.tasks[0].name.value = '工单受理与分类规则确认'
  draft.tasks[0].description.value = '确认 150 名员工的提单入口、分类、优先级与 SLA。'
  draft.tasks[1].name.value = 'SLA 与升级流程设计'
  draft.tasks[1].description.value = '设计超时提醒、逐级升级与运营处理责任。'
  draft.tasks[2].name.value = '工单处理闭环开发'
  draft.tasks[2].description.value = '实现受理、分派、处理、升级和关闭。'
  draft.tasks[3].name.value = '运营数据看板开发'
  draft.tasks[3].description.value = '展示 SLA 达成率、积压量与升级工单。'
  draft.tasks[4].name.value = '20 人试点与分批推广'
  draft.tasks[4].description.value = '先由 20 名员工试点，再推广至 150 名员工。'
  draft.wbs[0].name.value = '流程与规则设计'
  draft.wbs[0].description.value = '确认工单分类、SLA 和升级责任。'
  draft.wbs[1].name.value = '开发、试点与推广'
  draft.wbs[1].description.value = '实现工单闭环、数据看板并完成分批推广。'
  const leaves = draft.wbs.flatMap((node) => node.children)
  for (const [index, leaf] of leaves.entries()) {
    const task = draft.tasks[index]
    if (!task) continue
    leaf.name.value = task.name.value
    leaf.description.value = task.description.value
  }
  draft.acceptanceCriteria[0].statement.value = '2026-10-30 前完成验收，工单遗漏率低于 1%。'
  draft.acceptanceCriteria[1].statement.value = '核心页面在 150 名员工使用时响应低于 2 秒。'
  draft.resourceHints[0].role.value = '运营流程负责人'
  draft.resourceHints[0].headcount.value = 5
  draft.riskHints[0].description.value = 'SLA 口径与升级责任未对齐可能造成处理遗漏。'
  draft.riskHints[0].mitigation.value = '上线前由 5 人运营团队逐条确认 SLA 与升级矩阵。'
  draft.riskHints[1].description.value = '试点反馈未闭环会影响 150 名员工的推广采用。'
  draft.riskHints[1].mitigation.value = '20 人试点期间每日收集并分级处理反馈。'
  draft.ganttPreview.startDate.value = '2026-09-01'
  draft.ganttPreview.endDate.value = '2026-10-30'
  return draft
}

/** 结构合法但领域错误的负样例。 */
export function wrongOaDraftForTicketContext(): ProjectDraft {
  return structuredClone(fixtureDraft('software'))
}
