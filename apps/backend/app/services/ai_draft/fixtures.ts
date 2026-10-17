/**
 * ai-draft-generation / T036 —— 固定草案夹具（5 类 × 确定性 builder）。
 *
 * spec「固定夹具回归」：五类简体中文项目输入必须稳定生成符合 schema 的草案样本。
 * 本文件既是测试回归数据源，也是生成服务在无真实 Provider 时的确定性 fallback 内容源
 * （`ProjectDraftGenerationService` 的 mock 路径直接复用，保证无 key 联调与 CI 稳定）。
 *
 * 全部字面量、无随机源、无外部 fetch。builder 产物保证通过
 * `validateProjectDraft`（schema + 引用完整性 + 高影响字段 marker 覆盖）。
 */

import type {
  AiMarker,
  Marked,
  ProjectDraft,
  ProjectDraftAcceptanceCriterion,
  ProjectDraftDependency,
  ProjectDraftMilestoneHint,
  ProjectDraftResourceHint,
  ProjectDraftRiskHint,
  ProjectDraftRiskLevel,
  ProjectDraftTask,
  ProjectDraftWbsNode,
  ProjectType,
} from '@aiproj/types'
import { PROJECT_DRAFT_SCHEMA_VERSION } from '@aiproj/types'
import { isWorkingDay, parseIsoDate, type WorkingCalendar } from '#services/gantt_working_calendar'
import { buildDraftCalendar } from './cn_calendar.ts'

// ── marker 助手 ──────────────────────────────────────────────────────────
function marker(
  source: AiMarker['source'],
  reason: string,
  confidence: number,
  needsConfirmation: boolean,
): AiMarker {
  return { source, reason, confidence, needsConfirmation }
}
function inferred<T>(value: T, reason: string, confidence = 0.72): Marked<T> {
  return { value, marker: marker('inferred', reason, confidence, false) }
}
/** 高影响推断字段：needsConfirmation 强制 true。 */
function highImpact<T>(value: T, reason: string, confidence = 0.6): Marked<T> {
  return { value, marker: marker('inferred', reason, confidence, true) }
}

// ── 日期助手（UTC，避免时区偏移；纯字符串 ISO date）────────────────────────
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const base = Date.UTC(y, (m ?? 1) - 1, d ?? 1)
  const next = new Date(base + days * 86_400_000)
  return next.toISOString().slice(0, 10)
}

/** 按中国工作日历（周末 + 法定节假日 + 调休）顺延到工作日，与 HL-006 的判定口径一致。 */
function nextWorkingDay(iso: string, calendar: WorkingCalendar): string {
  let out = iso
  while (!isWorkingDay(calendar, parseIsoDate(out))) out = addDays(out, 1)
  return out
}

// ── 蓝图 → 合法草案 ────────────────────────────────────────────────────────
export interface DraftBlueprintTask {
  name: string
  description: string
  durationDays: number
  assignee: string
}
export interface DraftBlueprintPhase {
  name: string
  description: string
  tasks: DraftBlueprintTask[]
}
export interface DraftBlueprint {
  projectType: ProjectType
  title: string
  vision: string
  scope: string
  objectives: string[]
  successCriteria: string[]
  startDate: string
  roles: Array<{ role: string; headcount: number; note: string }>
  risks: Array<{ description: string; level: ProjectDraftRiskLevel; mitigation: string }>
  phases: DraftBlueprintPhase[]
}

/**
 * 从蓝图确定性构造 `ProjectDraft`：
 *   - WBS：每个 phase = 顶层非叶节点，其下每个任务 = 叶节点（isLeaf, 非说明），保证叶必映射任务；
 *   - tasks：线性排期（起止连续），一个任务对应一个 WBS 叶节点；
 *   - dependencies：任务链式 FS 依赖（形成关键路径），predecessor/successor 均引用存在任务；
 *   - milestones：每个 phase 末形成一个里程碑，关联该 phase 最后一个任务。
 */
export function buildDraftFromBlueprint(bp: DraftBlueprint): ProjectDraft {
  const wbs: ProjectDraftWbsNode[] = []
  const tasks: ProjectDraftTask[] = []
  const dependencies: ProjectDraftDependency[] = []
  const milestoneHints: ProjectDraftMilestoneHint[] = []

  const calendar = buildDraftCalendar({ startDate: bp.startDate, endDate: null }).calendar
  let cursor = bp.startDate
  let projectEnd = bp.startDate
  let totalDuration = 0
  let prevTaskId: string | null = null
  const allTaskIds: string[] = []

  bp.phases.forEach((phase, pi) => {
    const phaseId = `w-p${pi + 1}`
    const leaves: ProjectDraftWbsNode[] = []
    let lastTaskIdInPhase = ''

    phase.tasks.forEach((bt, ti) => {
      const leafId = `w-p${pi + 1}-${ti + 1}`
      const taskId = `t-p${pi + 1}-${ti + 1}`
      const startDate = nextWorkingDay(cursor, calendar)
      const endDate = nextWorkingDay(addDays(startDate, Math.max(0, bt.durationDays - 1)), calendar)
      cursor = nextWorkingDay(addDays(endDate, 1), calendar)
      projectEnd = endDate
      totalDuration += bt.durationDays
      allTaskIds.push(taskId)
      lastTaskIdInPhase = taskId

      leaves.push({
        id: leafId,
        parentId: phaseId,
        outlineCode: `${pi + 1}.${ti + 1}`,
        name: inferred(bt.name, '由任务名推断的 WBS 叶节点。'),
        description: inferred(bt.description, '由任务范围推断。'),
        isLeaf: true,
        isNote: false,
        children: [],
      })

      tasks.push({
        id: taskId,
        wbsNodeId: leafId,
        name: inferred(bt.name, '由项目分解推断的任务。'),
        description: inferred(bt.description, '由任务范围推断。'),
        status: 'not_started',
        durationDays: highImpact(bt.durationDays, '工期为 AI 估算，需人工确认。'),
        startDate: highImpact(startDate, '开始日期由排期推算，需人工确认。'),
        endDate: highImpact(endDate, '结束日期由工期推算，需人工确认。'),
        assigneeHint: highImpact(bt.assignee, '负责人角色为 AI 建议，需人工指派。', 0.5),
      })

      if (prevTaskId) {
        dependencies.push({
          id: `d-${dependencies.length + 1}`,
          predecessorId: prevTaskId,
          successorId: taskId,
          type: 'FS',
          lagDays: highImpact(0, '默认无滞后，需人工确认。', 0.7),
        })
      }
      prevTaskId = taskId
    })

    wbs.push({
      id: phaseId,
      parentId: null,
      outlineCode: `${pi + 1}`,
      name: inferred(phase.name, '由项目阶段推断的 WBS 顶层节点。'),
      description: inferred(phase.description, '由阶段目标推断。'),
      isLeaf: false,
      isNote: false,
      children: leaves,
    })

    milestoneHints.push({
      id: `m-${pi + 1}`,
      name: inferred(`${phase.name}完成`, '由阶段末推断的里程碑。'),
      targetDate: highImpact(projectEnd, '里程碑日期由排期推算，需人工确认。'),
      linkedTaskIds: lastTaskIdInPhase ? [lastTaskIdInPhase] : [],
    })
  })

  const acceptanceCriteria: ProjectDraftAcceptanceCriterion[] = bp.successCriteria.map(
    (statement, i) => ({
      id: `a-${i + 1}`,
      statement: inferred(statement, '由项目成功标准推断的验收条目。'),
      linkedTaskId: allTaskIds[Math.min(i, Math.max(0, allTaskIds.length - 1))] ?? null,
      linkedSuccessIndex: i,
    }),
  )

  const resourceHints: ProjectDraftResourceHint[] = bp.roles.map((r, i) => ({
    id: `r-${i + 1}`,
    role: inferred(r.role, '由项目类型推断的角色需求。'),
    headcount: inferred(r.headcount, '人数为 AI 建议。'),
    allocationNote: inferred(r.note, '分配说明为 AI 建议。'),
  }))

  const riskHints: ProjectDraftRiskHint[] = bp.risks.map((rk, i) => ({
    id: `rk-${i + 1}`,
    description: inferred(rk.description, '由项目类型推断的风险。'),
    level: highImpact(rk.level, '风险等级为 AI 评估，需人工确认。'),
    mitigation: inferred(rk.mitigation, '缓解措施为 AI 建议。'),
  }))

  return {
    schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
    projectType: bp.projectType,
    charter: {
      title: inferred(bp.title, '由一句话输入推断的项目标题。', 0.8),
      vision: inferred(bp.vision, '由项目目标推断的愿景。'),
      scope: inferred(bp.scope, '由交付物推断的范围。'),
      objectives: inferred(bp.objectives, '由目标表述推断。'),
      successCriteria: inferred(bp.successCriteria, '由验收标准推断。'),
      startDate: highImpact(bp.startDate, '开始日期由澄清上下文推算，需人工确认。'),
      endDate: highImpact(projectEnd, '结束日期由总工期推算，需人工确认。'),
    },
    wbs,
    tasks,
    dependencies,
    acceptanceCriteria,
    resourceHints,
    riskHints,
    milestoneHints,
    ganttPreview: {
      startDate: inferred(bp.startDate, '整体起始。'),
      endDate: inferred(projectEnd, '整体结束。'),
      totalDurationDays: inferred(totalDuration, '总工期为各任务工期之和。'),
      criticalPathTaskIds: allTaskIds,
      phaseCount: bp.phases.length,
    },
  }
}

// ── 5 类蓝图 ───────────────────────────────────────────────────────────────
export const DRAFT_BLUEPRINTS: Record<ProjectType, DraftBlueprint> = {
  software: {
    projectType: 'software',
    title: '企业内部 OA 审批系统',
    vision: '用统一审批中台减少纸质流转，把审批周期从天级降到分钟级。',
    scope: '覆盖请假、报销、印章三类流程的申请、审批、归档与提醒。',
    objectives: ['减少重复录入', '打通审批与通知'],
    successCriteria: ['三类流程线上化率 100%', '平均审批时长下降 50%'],
    startDate: '2026-08-01',
    roles: [
      { role: '后端工程师', headcount: 2, note: '负责审批引擎与接口。' },
      { role: '前端工程师', headcount: 1, note: '负责审批工作台。' },
    ],
    risks: [
      { description: '审批规则频繁变更', level: 'medium', mitigation: '规则可配置化。' },
      { description: '与既有 HR 系统集成不稳定', level: 'high', mitigation: '预留联调周期。' },
    ],
    phases: [
      {
        name: '需求与设计',
        description: '梳理三类流程并产出方案。',
        tasks: [
          {
            name: '流程调研',
            description: '访谈业务方梳理审批链。',
            durationDays: 5,
            assignee: '产品',
          },
          {
            name: '技术方案设计',
            description: '设计审批引擎与数据模型。',
            durationDays: 4,
            assignee: '后端工程师',
          },
        ],
      },
      {
        name: '开发与联调',
        description: '实现并联调三类流程。',
        tasks: [
          {
            name: '审批引擎开发',
            description: '实现可配置审批流。',
            durationDays: 10,
            assignee: '后端工程师',
          },
          {
            name: '审批工作台开发',
            description: '实现申请与审批界面。',
            durationDays: 8,
            assignee: '前端工程师',
          },
          {
            name: 'HR 系统联调',
            description: '打通组织与人员数据。',
            durationDays: 4,
            assignee: '后端工程师',
          },
        ],
      },
    ],
  },
  event: {
    projectType: 'event',
    title: '公司年度技术峰会',
    vision: '打造有影响力的技术品牌活动，线下线上双轨触达。',
    scope: '线下 300 人、线上直播 5000 人，含招商、议程、执行与复盘。',
    objectives: ['提升技术品牌影响力', '沉淀可复用会务流程'],
    successCriteria: ['线下到场率 ≥ 85%', '直播观看峰值 ≥ 5000'],
    startDate: '2026-09-01',
    roles: [
      { role: '会务负责人', headcount: 1, note: '统筹整体执行。' },
      { role: '市场推广', headcount: 2, note: '负责招商与宣发。' },
    ],
    risks: [
      { description: '嘉宾档期不确定', level: 'high', mitigation: '提前锁定备选嘉宾。' },
      { description: '直播技术故障', level: 'medium', mitigation: '双路直播冗余。' },
    ],
    phases: [
      {
        name: '筹备',
        description: '确定主题、嘉宾与场地。',
        tasks: [
          {
            name: '主题与议程策划',
            description: '确定峰会主题与议程。',
            durationDays: 6,
            assignee: '会务负责人',
          },
          {
            name: '场地与供应商',
            description: '确定场地并签约供应商。',
            durationDays: 5,
            assignee: '会务负责人',
          },
        ],
      },
      {
        name: '执行与复盘',
        description: '现场执行并总结。',
        tasks: [
          {
            name: '宣发与招商',
            description: '多渠道宣传并邀约参会。',
            durationDays: 12,
            assignee: '市场推广',
          },
          {
            name: '现场执行',
            description: '峰会当天现场统筹。',
            durationDays: 2,
            assignee: '会务负责人',
          },
          {
            name: '活动复盘',
            description: '数据复盘与经验沉淀。',
            durationDays: 2,
            assignee: '会务负责人',
          },
        ],
      },
    ],
  },
  research: {
    projectType: 'research',
    title: '低代码平台市场调研报告',
    vision: '为产品决策提供权威的市场格局参考。',
    scope: '含 8 家厂商横向对比、访谈与结论报告。',
    objectives: ['厘清市场格局', '输出可决策的对比结论'],
    successCriteria: ['覆盖 8 家主流厂商', '形成结构化对比矩阵'],
    startDate: '2026-08-15',
    roles: [
      { role: '研究员', headcount: 2, note: '负责资料收集与分析。' },
      { role: '行业顾问', headcount: 1, note: '提供专业判断。' },
    ],
    risks: [
      { description: '公开数据不足', level: 'medium', mitigation: '补充专家访谈。' },
      { description: '结论主观偏差', level: 'low', mitigation: '交叉验证。' },
    ],
    phases: [
      {
        name: '资料收集',
        description: '收集厂商与市场资料。',
        tasks: [
          {
            name: '厂商资料梳理',
            description: '梳理 8 家厂商公开资料。',
            durationDays: 7,
            assignee: '研究员',
          },
          {
            name: '专家访谈',
            description: '访谈行业专家补充判断。',
            durationDays: 5,
            assignee: '研究员',
          },
        ],
      },
      {
        name: '分析与成稿',
        description: '分析并撰写报告。',
        tasks: [
          {
            name: '对比分析',
            description: '构建横向对比矩阵。',
            durationDays: 6,
            assignee: '研究员',
          },
          {
            name: '报告撰写',
            description: '撰写并评审报告。',
            durationDays: 5,
            assignee: '行业顾问',
          },
        ],
      },
    ],
  },
  product: {
    projectType: 'product',
    title: '智能温控咖啡机',
    vision: '打造面向咖啡师的高精度温控产品，建立硬件品牌。',
    scope: 'V1 完成工业设计、样机制作与首批 50 台试产。',
    objectives: ['验证温控核心技术', '完成小批量试产'],
    successCriteria: ['温控精度 ±0.5℃', '试产良率 ≥ 90%'],
    startDate: '2026-08-10',
    roles: [
      { role: '结构工程师', headcount: 1, note: '负责工业与结构设计。' },
      { role: '硬件工程师', headcount: 2, note: '负责温控与电路。' },
    ],
    risks: [
      { description: '供应链交期波动', level: 'high', mitigation: '多供应商备份。' },
      { description: '温控算法不达标', level: 'high', mitigation: '预研关键算法。' },
    ],
    phases: [
      {
        name: '设计',
        description: '完成工业与结构设计。',
        tasks: [
          {
            name: '工业设计',
            description: '外观与人机交互设计。',
            durationDays: 8,
            assignee: '结构工程师',
          },
          {
            name: '温控方案设计',
            description: '设计温控算法与电路。',
            durationDays: 7,
            assignee: '硬件工程师',
          },
        ],
      },
      {
        name: '样机与试产',
        description: '打样并小批量试产。',
        tasks: [
          {
            name: '样机制作',
            description: '制作可运行样机。',
            durationDays: 10,
            assignee: '硬件工程师',
          },
          {
            name: '首批试产',
            description: '完成 50 台试产。',
            durationDays: 12,
            assignee: '结构工程师',
          },
        ],
      },
    ],
  },
  general: {
    projectType: 'general',
    title: '通用项目启动计划',
    vision: '以最小可用闭环快速启动并验证目标。',
    scope: '含目标澄清、方案制定与首轮执行。',
    objectives: ['明确目标与范围', '完成首轮交付'],
    successCriteria: ['目标与范围获干系人确认', '首轮交付按期完成'],
    startDate: '2026-08-05',
    roles: [
      { role: '项目负责人', headcount: 1, note: '统筹项目推进。' },
      { role: '执行成员', headcount: 2, note: '负责具体交付。' },
    ],
    risks: [
      { description: '目标不清晰', level: 'medium', mitigation: '提前对齐干系人。' },
      { description: '资源投入不足', level: 'low', mitigation: '分阶段投入。' },
    ],
    phases: [
      {
        name: '规划',
        description: '明确目标与方案。',
        tasks: [
          {
            name: '目标澄清',
            description: '与干系人对齐目标。',
            durationDays: 3,
            assignee: '项目负责人',
          },
          {
            name: '方案制定',
            description: '制定执行方案与计划。',
            durationDays: 4,
            assignee: '项目负责人',
          },
        ],
      },
      {
        name: '执行',
        description: '首轮执行与验收。',
        tasks: [
          {
            name: '首轮交付',
            description: '完成首轮交付物。',
            durationDays: 8,
            assignee: '执行成员',
          },
          {
            name: '阶段验收',
            description: '组织阶段验收。',
            durationDays: 2,
            assignee: '项目负责人',
          },
        ],
      },
    ],
  },
}

/** 便捷函数：按项目类型取得确定性草案样本。 */
export function fixtureDraft(projectType: ProjectType): ProjectDraft {
  return buildDraftFromBlueprint(DRAFT_BLUEPRINTS[projectType])
}
