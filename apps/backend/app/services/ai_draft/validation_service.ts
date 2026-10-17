import type {
  DraftAutoFixDiff,
  DraftValidationDimension,
  DraftValidationIssue,
  DraftValidationPhase,
  DraftValidationReport,
  DraftValidationRuleId,
  ProjectDraft,
  ProjectDraftModification,
  ProjectDraftSelection,
  ProjectDraftTask,
} from '@aiproj/types'
import {
  DRAFT_VALIDATION_DIMENSION_WEIGHTS,
  DRAFT_VALIDATION_DIMENSIONS,
  DRAFT_VALIDATION_RULE_AUTO_FIXABLE,
  DRAFT_VALIDATION_RULE_DIMENSION,
  DRAFT_VALIDATION_RULE_PHASE,
  DRAFT_VALIDATION_RULE_SEVERITY,
} from '@aiproj/types'
import { detectDependencyCycle } from '#services/task_dependency_service'
import {
  createWorkingCalendar,
  isWorkingDay,
  parseIsoDate,
  snapToWorkingDay,
  formatIsoDate,
} from '#services/gantt_working_calendar'
import { flattenWbs, validateProjectDraft } from './schema.ts'
import { buildDraftCalendar } from './cn_calendar.ts'
import { isOngoingTask } from './resource_plan.ts'

/**
 * 校验与生成必须用同一份工作日历（含法定节假日与调休上班日）。
 * 原先校验只排除周末：生成按调休把任务排在周六上班日，校验却判为非工作日并阻断导入（实测缺陷）。
 */
function draftWorkingCalendar(draft: ProjectDraft) {
  const asDate = (value: unknown) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  try {
    return buildDraftCalendar({
      startDate: asDate(draft.charter?.startDate?.value),
      endDate: asDate(draft.charter?.endDate?.value),
    }).calendar
  } catch {
    return createWorkingCalendar()
  }
}

type ValidationPhaseOption = DraftValidationPhase | 'all'

export interface DraftValidationContext {
  phase?: ValidationPhaseOption
  selection?: ProjectDraftSelection | null
  modifications?: ProjectDraftModification[] | null
}

export interface DraftValidationOptions {
  autoFix?: boolean
}

export interface RuleContext {
  phase: ValidationPhaseOption
}

export type DraftValidationRule = (
  draft: ProjectDraft,
  ctx: RuleContext,
  opts: DraftValidationOptions,
) => DraftValidationIssue[]

export interface RegisteredRule {
  id: DraftValidationRuleId
  run: DraftValidationRule
}

const MIN_VE009_TASKS = 2
const MIN_VE009_DEPENDENCIES = 1
const DAY_MS = 86_400_000
const TERM_SYNONYMS = [
  ['milestone', '里程碑', '节点'],
  ['acceptance', '验收', '交付验收'],
  ['task', '任务', '工作项'],
]

/** 多人/团体角色的关键词；命中即视为「多人团队提示」，不是同一单人资源。 */
const TEAM_ROLE_PATTERN =
  /团队|小组|组|部门|中心|委员会|办公室|PMO|供应商|乙方|外包|服务商|项目组|职能线/iu
/** 负责人文本分隔符：支持顿号/逗号/斜杠/「与、和、及」组合。 */
const ASSIGNEE_SEPARATOR = /[、,，,/与和及]+/u

function splitAssigneeRoles(value: string): string[] {
  return value
    .split(ASSIGNEE_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function isTeamRole(role: string): boolean {
  return TEAM_ROLE_PATTERN.test(role)
}

/** 任务负责人的稳定角色 ID 列表：优先草案结构化字段，缺失时按 assigneeHint 分词推导。 */
function assigneeRoles(task: ProjectDraftTask): string[] {
  if (task.assigneeRoleIds?.value && task.assigneeRoleIds.value.length > 0) {
    return task.assigneeRoleIds.value.map((role) => role.trim()).filter(Boolean)
  }
  return splitAssigneeRoles(task.assigneeHint.value)
}

function normalizeRoleKey(role: string): string {
  return role.normalize('NFKC').replace(/\s+/g, '').trim()
}

/** resourceHints → 角色容量映射（同角色累加 headcount）。 */
function roleCapacityMap(draft: ProjectDraft): Map<string, number> {
  const capacity = new Map<string, number>()
  for (const resource of draft.resourceHints) {
    const key = normalizeRoleKey(resource.role.value)
    if (!key) continue
    const headcount = numericValue(resource.headcount.value)
    capacity.set(key, (capacity.get(key) ?? 0) + headcount)
  }
  return capacity
}

/** 查找负责人在资源建议中的容量：精确匹配优先，其次双向包含匹配。 */
function capacityForRole(role: string, capacityMap: Map<string, number>): number | null {
  const key = normalizeRoleKey(role)
  // 空键会「包含于」任何角色名而误配容量。
  if (!key) return null
  const exact = capacityMap.get(key)
  if (exact !== undefined) return exact
  for (const [candidate, count] of capacityMap) {
    if (candidate.includes(key) || key.includes(candidate)) return count
  }
  return null
}

export class RuleRegistry {
  private readonly rules = new Map<DraftValidationRuleId, DraftValidationRule>()

  register(id: DraftValidationRuleId, run: DraftValidationRule): this {
    this.rules.set(id, run)
    return this
  }

  forPhase(phase: ValidationPhaseOption): RegisteredRule[] {
    return [...this.rules.entries()]
      .filter(([id]) => phase === 'all' || DRAFT_VALIDATION_RULE_PHASE[id] === phase)
      .map(([id, run]) => ({ id, run }))
  }
}

export class DraftValidationService {
  readonly registry = buildRuleRegistry()

  validate(
    draft: ProjectDraft,
    context: DraftValidationContext = {},
    opts: DraftValidationOptions = {},
  ): DraftValidationReport {
    const phase = context.phase ?? 'all'
    const effectiveDraft =
      phase === 'validating'
        ? applyModifications(
            filterDraftBySelection(draft, context.selection),
            context.modifications,
          )
        : draft
    const issues: DraftValidationIssue[] = []

    for (const rule of this.registry.forPhase(phase)) {
      try {
        issues.push(
          ...rule
            .run(effectiveDraft, { phase }, opts)
            .map((validationIssue) => enrichIssue(validationIssue)),
        )
      } catch (error) {
        issues.push(
          enrichIssue({
            ruleId: rule.id,
            severity: DRAFT_VALIDATION_RULE_SEVERITY[rule.id],
            message: `校验规则执行失败：${error instanceof Error ? error.message : String(error)}`,
            path: null,
            failed: true,
          }),
        )
      }
    }

    return assembleReport(issues, [])
  }

  autoFix(
    draft: ProjectDraft,
    context: DraftValidationContext = {},
  ): {
    draft: ProjectDraft
    report: DraftValidationReport
    diffs: DraftAutoFixDiff[]
  } {
    const next = deepClone(draft)
    const before = this.validate(next, context)
    const diffs: DraftAutoFixDiff[] = []
    const candidates = before.ruleResults
      .filter((validationIssue) => validationIssue.autoFixable)
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))

    for (const validationIssue of candidates) {
      const diff = applyAutoFix(next, validationIssue)
      if (diff) diffs.push(diff)
    }

    const after = this.validate(next, context)
    return {
      draft: next,
      report: { ...after, autoFixDiffs: diffs, canConfirm: false },
      diffs,
    }
  }
}

function buildRuleRegistry(): RuleRegistry {
  return new RuleRegistry()
    .register('HL-001', (draft) => durationMismatch(draft, 'HL-001'))
    .register('HL-002', numericReasonability)
    .register('HL-003', logicalConsistency)
    .register('HL-004', assumptionCompleteness)
    .register('HL-005', traceabilityBaseline)
    .register('HL-006', timeFeasibility)
    .register('HL-007', dependencyCycleRule('HL-007'))
    .register('HL-008', resourceOverloadRule('HL-008'))
    .register('HL-009', terminologyConsistency)
    .register('HL-010', scopeCreep)
    .register('VE-001', sameResourceSameDayConflict)
    .register('VE-002', dependencyCycleRule('VE-002'))
    .register('VE-003', resourceOverloadRule('VE-003'))
    .register('VE-004', criticalTasksHaveOwners)
    .register('VE-005', (draft) => missingDeliverableCoverage(draft, 'VE-005'))
    .register('VE-006', physicalTimelineFeasibility)
    .register('VE-007', milestoneTargetDates)
    .register('VE-008', singleTaskDurationReasonable)
    .register('VE-009', criticalPathComputable)
    .register('VE-010', requiredFieldsComplete)
    .register('VE-011', wbsLeafTasks)
    .register('VE-012', ganttTaskListSync)
}

function issue(
  ruleId: DraftValidationRuleId,
  message: string,
  path: string | null,
): DraftValidationIssue {
  return {
    ruleId,
    severity: DRAFT_VALIDATION_RULE_SEVERITY[ruleId],
    message,
    path,
  }
}

function enrichIssue(input: DraftValidationIssue): DraftValidationIssue {
  const knownId = input.ruleId as DraftValidationRuleId
  return {
    ...input,
    autoFixable:
      input.autoFixable ??
      (knownId in DRAFT_VALIDATION_RULE_AUTO_FIXABLE
        ? DRAFT_VALIDATION_RULE_AUTO_FIXABLE[knownId]
        : false),
    dimension:
      input.dimension ??
      (knownId in DRAFT_VALIDATION_RULE_DIMENSION
        ? DRAFT_VALIDATION_RULE_DIMENSION[knownId]
        : 'completeness'),
  }
}

function assembleReport(
  ruleResults: DraftValidationIssue[],
  autoFixDiffs: DraftAutoFixDiff[],
): DraftValidationReport {
  const dimensionScores = calculateDimensionScores(ruleResults)
  const confidenceScore = Math.round(
    DRAFT_VALIDATION_DIMENSIONS.reduce(
      (sum, dimension) =>
        sum + dimensionScores[dimension] * DRAFT_VALIDATION_DIMENSION_WEIGHTS[dimension],
      0,
    ),
  )
  const blocking = ruleResults.filter((item) => item.severity === 'blocking')
  const warning = ruleResults.filter((item) => item.severity === 'warning')
  const info = ruleResults.filter((item) => item.severity === 'info')
  return {
    overallRiskLevel: riskLevel(confidenceScore, ruleResults),
    confidenceScore,
    dimensionScores,
    blocking,
    warning,
    info,
    ruleResults,
    autoFixDiffs,
    canConfirm: blocking.length === 0,
  }
}

function calculateDimensionScores(
  issues: DraftValidationIssue[],
): Record<DraftValidationDimension, number> {
  const scores = Object.fromEntries(
    DRAFT_VALIDATION_DIMENSIONS.map((dimension) => [dimension, 100]),
  ) as Record<DraftValidationDimension, number>
  for (const item of issues) {
    const dimension = item.dimension ?? 'completeness'
    scores[dimension] = Math.max(0, scores[dimension] - penalty(item.severity))
  }
  return scores
}

function penalty(severity: DraftValidationIssue['severity']): number {
  if (severity === 'blocking') return 25
  if (severity === 'warning') return 15
  return 5
}

function riskLevel(
  score: number,
  issues: DraftValidationIssue[],
): DraftValidationReport['overallRiskLevel'] {
  if (issues.some((item) => item.severity === 'blocking')) return score < 60 ? 'critical' : 'high'
  if (score >= 90) return 'low'
  if (score >= 70) return 'medium'
  if (score >= 60) return 'high'
  return 'critical'
}

function severityRank(severity: DraftValidationIssue['severity']): number {
  if (severity === 'blocking') return 0
  if (severity === 'warning') return 1
  return 2
}

function missingDeliverableCoverage(
  draft: ProjectDraft,
  ruleId: 'HL-001' | 'VE-005',
): DraftValidationIssue[] {
  return draft.acceptanceCriteria
    .map((criterion, index) =>
      criterion.linkedTaskId === null
        ? issue(ruleId, '验收标准没有关联到任何任务。', `acceptanceCriteria[${index}]`)
        : null,
    )
    .filter((item): item is DraftValidationIssue => item !== null)
}

/**
 * HL-001 工期约束符合度（§9.4.1，允许 20% 误差）：比较的是任务排期的**实际跨度**，
 * 不是把任务工期相加——并行任务的工期总和天然大于日历跨度，旧实现对任何有并行的
 * 大型项目都会误报并阻断导入。跨度同时按日历天与工作日两种口径计算，
 * ganttPreview.totalDurationDays 与任一口径相符即通过。
 */
function durationMismatch(draft: ProjectDraft, ruleId: 'HL-001'): DraftValidationIssue[] {
  const previewTotal = numericValue(draft.ganttPreview.totalDurationDays.value)
  if (previewTotal <= 0) return []
  const spans = scheduleSpanDays(draft)
  if (spans.length === 0) return []
  const withinTolerance = spans.some((span) => Math.abs(span - previewTotal) / previewTotal <= 0.2)
  return withinTolerance
    ? []
    : [
        issue(
          ruleId,
          '甘特预览的总工期与任务排期跨度相差超过 20%。',
          'ganttPreview.totalDurationDays',
        ),
      ]
}

/** 任务排期跨度（最早开始 → 最晚结束，含首尾）：[日历天, 工作日]；无可用日期时回退关键路径工期。 */
function scheduleSpanDays(draft: ProjectDraft): number[] {
  const starts = draft.tasks
    .map((task) => parseSafe(task.startDate.value))
    .filter((value): value is number => value !== null)
  const ends = draft.tasks
    .map((task) => parseSafe(task.endDate.value))
    .filter((value): value is number => value !== null)
  if (starts.length > 0 && ends.length > 0) {
    const first = Math.min(...starts)
    const last = Math.max(...ends)
    if (last >= first) {
      const calendar = draftWorkingCalendar(draft)
      let workingDays = 0
      for (let current = first; current <= last; current += DAY_MS) {
        if (isWorkingDay(calendar, current)) workingDays += 1
      }
      return [Math.round((last - first) / DAY_MS) + 1, workingDays]
    }
  }
  const byId = new Map(draft.tasks.map((task) => [task.id, task]))
  const criticalPath = computeCriticalPathIds(draft)
    .map((id) => numericValue(byId.get(id)?.durationDays.value ?? 0))
    .reduce((sum, days) => sum + days, 0)
  return criticalPath > 0 ? [criticalPath] : []
}

function numericReasonability(draft: ProjectDraft): DraftValidationIssue[] {
  const out: DraftValidationIssue[] = []
  draft.tasks.forEach((task, index) => {
    const duration = numericValue(task.durationDays.value)
    if (duration < 0.5 || duration > 30) {
      out.push(issue('HL-002', '任务工期应在 0.5–30 天之间。', `tasks[${index}].durationDays`))
    }
    if (duration > 30) {
      out.push(
        issue('HL-002', '非里程碑任务的工期不应超过 30 天。', `tasks[${index}].durationDays`),
      )
    }
    if (assigneeCount(task.assigneeHint.value) > 5) {
      out.push(issue('HL-002', '单个任务不宜安排超过 5 人。', `tasks[${index}].assigneeHint`))
    }
  })
  return out
}

function logicalConsistency(draft: ProjectDraft): DraftValidationIssue[] {
  const structural = validateProjectDraft(draft)
  const out = structural.ok
    ? []
    : structural.errors.map((error) => issue('HL-003', error.message, error.path))
  draft.milestoneHints.forEach((milestone, index) => {
    if (!milestone.targetDate.value) {
      out.push(issue('HL-003', '里程碑必须有目标日期。', `milestoneHints[${index}].targetDate`))
    }
  })
  return out
}

function assumptionCompleteness(draft: ProjectDraft): DraftValidationIssue[] {
  return collectMarkedFields(draft)
    .filter(({ marked }) => marked.marker.source !== 'explicit' && !marked.marker.needsConfirmation)
    .map(({ path }) => issue('HL-004', '影响大的 AI 推断 / 默认字段必须标记为待确认。', path))
}

function traceabilityBaseline(draft: ProjectDraft): DraftValidationIssue[] {
  return draft.tasks
    .map((task, index) =>
      !task.durationDays.marker.reason
        ? issue(
            'HL-005',
            '工期估算缺少可追溯的依据。',
            `tasks[${index}].durationDays.marker.reason`,
          )
        : null,
    )
    .filter((item): item is DraftValidationIssue => item !== null)
}

function timeFeasibility(draft: ProjectDraft): DraftValidationIssue[] {
  const calendar = draftWorkingCalendar(draft)
  const out: DraftValidationIssue[] = []
  draft.tasks.forEach((task, index) => {
    for (const field of ['startDate', 'endDate'] as const) {
      const timestamp = parseSafe(task[field].value)
      if (timestamp !== null && !isWorkingDay(calendar, timestamp)) {
        out.push(issue('HL-006', '任务日期落在非工作日。', `tasks[${index}].${field}`))
      }
    }
  })
  if (maxDailyAssigneeLoad(draft) > totalCapacity(draft) * 1.5) {
    out.push(issue('HL-006', '并行工作量超过可用人力的 1.5 倍。', 'tasks'))
  }
  return out
}

function dependencyCycleRule(ruleId: 'HL-007' | 'VE-002'): DraftValidationRule {
  return (draft) => {
    // TODO-DEBT: sec13-T038-shared-dependency-cycle - import the draft-facing helper
    // from the dependency package once backend/frontend scheduling code is split.
    return detectDependencyCycle(draft.dependencies)
      ? [issue(ruleId, '任务依赖出现了环（互相等待）。', 'dependencies')]
      : []
  }
}

function resourceOverloadRule(ruleId: 'HL-008' | 'VE-003'): DraftValidationRule {
  return (draft) => {
    const capacity = totalCapacity(draft)
    const issues: DraftValidationIssue[] = []
    // 保留既有聚合语义：全量并行人数超过总容量即命中（如 '甲、乙、丙' 3 人 > 2 容量）。
    if (capacity > 0 && maxDailyAssigneeLoad(draft) > capacity) {
      issues.push(issue(ruleId, '分配的工作量超出可用人力。', 'tasks'))
    }
    // 角色级容量裁决：同一团体角色同日并发超过 headcount 也命中（VE-003 可定位到角色）。
    for (const point of roleOverloadPoints(draft)) {
      if (capacityForRole(point.role, roleCapacityMap(draft)) !== null) {
        issues.push(
          issue(
            ruleId,
            `角色「${point.role}」在 ${point.day} 超出可用人力（${point.load} > ${point.capacity}）。`,
            'tasks',
          ),
        )
      }
    }
    return [...new Map(issues.map((item) => [`${item.ruleId}:${item.message}`, item])).values()]
  }
}

function terminologyConsistency(draft: ProjectDraft): DraftValidationIssue[] {
  const text = [
    draft.charter.title.value,
    draft.charter.scope.value,
    ...draft.tasks.map((task) => task.name.value),
    ...draft.wbs.flatMap((node) => [
      node.name.value,
      ...node.children.map((child) => child.name.value),
    ]),
  ].join(' ')
  const mixedGroups = TERM_SYNONYMS.filter(
    (group) => group.filter((term) => text.includes(term)).length > 1,
  )
  return mixedGroups.length
    ? [issue('HL-009', '同一概念混用了不同说法，转正前请统一术语。', null)]
    : []
}

function scopeCreep(draft: ProjectDraft): DraftValidationIssue[] {
  const unmatched = draft.acceptanceCriteria.filter(
    (criterion) => criterion.linkedSuccessIndex === null,
  )
  return unmatched.length > 3
    ? [
        issue(
          'HL-010',
          '有超过 3 项交付物没有对应到成功标准，可能超出了需求范围，请核对。',
          'acceptanceCriteria',
        ),
      ]
    : []
}

function sameResourceSameDayConflict(draft: ProjectDraft): DraftValidationIssue[] {
  const seen = new Map<string, string>()
  const out: DraftValidationIssue[] = []
  const capacityMap = roleCapacityMap(draft)
  draft.tasks.forEach((task, index) => {
    // 按稳定角色 ID 分段：只有「明确同一单人资源」才构成 VE-001 阻断；
    // 「应用开发团队与运营团队」会被拆成两个角色，不再整串当作一个资源 ID。
    for (const role of assigneeRoles(task)) {
      if (isTeamRole(role)) continue
      // 资源建议里有人数依据的角色（按角色 ID 或负责人描述匹配，如 backend-dev ↔「后端开发组」
      // ↔ 资源「后端开发」×10）是多人资源：超载由 VE-003 / HL-008 按容量判定，不按单人阻断。
      const hint = task.assigneeHint.value.trim()
      if (
        capacityForRole(role, capacityMap) !== null ||
        (hint.length > 0 && capacityForRole(hint, capacityMap) !== null)
      ) {
        continue
      }
      for (const day of daysBetween(task.startDate.value, task.endDate.value)) {
        const key = `${role}:${day}`
        const previous = seen.get(key)
        if (previous && previous !== task.id) {
          out.push(
            issue('VE-001', `同一角色在同一天安排了多项任务（角色：${role}）。`, `tasks[${index}]`),
          )
          return
        }
        seen.set(key, task.id)
      }
    }
  })
  return out
}

function criticalTasksHaveOwners(draft: ProjectDraft): DraftValidationIssue[] {
  const critical = new Set(draft.ganttPreview.criticalPathTaskIds)
  return draft.tasks
    .map((task, index) =>
      critical.has(task.id) && !task.assigneeHint.value.trim()
        ? issue('VE-004', '关键任务必须有负责人。', `tasks[${index}].assigneeHint`)
        : null,
    )
    .filter((item): item is DraftValidationIssue => item !== null)
}

function physicalTimelineFeasibility(draft: ProjectDraft): DraftValidationIssue[] {
  return draft.tasks
    .map((task, index) => {
      const start = parseSafe(task.startDate.value)
      const end = parseSafe(task.endDate.value)
      return start !== null && end !== null && end < start
        ? issue('VE-006', '任务结束日期早于开始日期。', `tasks[${index}].endDate`)
        : null
    })
    .filter((item): item is DraftValidationIssue => item !== null)
}

function milestoneTargetDates(draft: ProjectDraft): DraftValidationIssue[] {
  return draft.milestoneHints
    .map((milestone, index) =>
      milestone.targetDate.value
        ? null
        : issue('VE-007', '里程碑需要目标日期。', `milestoneHints[${index}].targetDate`),
    )
    .filter((item): item is DraftValidationIssue => item !== null)
}

function singleTaskDurationReasonable(draft: ProjectDraft): DraftValidationIssue[] {
  return draft.tasks
    .map((task, index) => {
      const duration = numericValue(task.durationDays.value)
      return duration < 0.5 || duration > 30
        ? issue('VE-008', '单个任务工期超出 0.5–30 天。', `tasks[${index}].durationDays`)
        : null
    })
    .filter((item): item is DraftValidationIssue => item !== null)
}

function criticalPathComputable(draft: ProjectDraft): DraftValidationIssue[] {
  if (draft.tasks.length < MIN_VE009_TASKS || draft.dependencies.length < MIN_VE009_DEPENDENCIES) {
    return [
      issue(
        'VE-009',
        '草案任务太少，无法算出有意义的关键路径。',
        'ganttPreview.criticalPathTaskIds',
      ),
    ]
  }
  // TODO-DEBT: sec13-T038-shared-critical-path - reuse the critical-path module
  // directly after it moves out of apps/frontend into a workspace package.
  return computeCriticalPathIds(draft).length
    ? []
    : [issue('VE-009', '无法为这份草案计算关键路径。', 'dependencies')]
}

function requiredFieldsComplete(draft: ProjectDraft): DraftValidationIssue[] {
  const out: DraftValidationIssue[] = []
  if (!draft.charter.title.value.trim())
    out.push(issue('VE-010', '缺少项目名称。', 'charter.title'))
  if (!draft.charter.scope.value.trim())
    out.push(issue('VE-010', '缺少项目范围。', 'charter.scope'))
  if (!draft.tasks.length) out.push(issue('VE-010', '至少需要一项任务。', 'tasks'))
  return out
}

function wbsLeafTasks(draft: ProjectDraft): DraftValidationIssue[] {
  const tasksByWbs = new Set(draft.tasks.map((task) => task.wbsNodeId))
  return flattenWbs(draft.wbs)
    .filter((node) => node.isLeaf && !node.isNote && !tasksByWbs.has(node.id))
    .map((node) => issue('VE-011', 'WBS 末级节点没有对应的任务。', `wbs.${node.outlineCode}`))
}

function ganttTaskListSync(draft: ProjectDraft): DraftValidationIssue[] {
  const taskIds = new Set(draft.tasks.map((task) => task.id))
  return draft.ganttPreview.criticalPathTaskIds
    .filter((id) => !taskIds.has(id))
    .map((id) =>
      issue('VE-012', '甘特预览引用了不存在的任务。', `ganttPreview.criticalPathTaskIds.${id}`),
    )
}

function filterDraftBySelection(
  draft: ProjectDraft,
  selection?: ProjectDraftSelection | null,
): ProjectDraft {
  if (!selection) return draft
  const next = deepClone(draft)
  const taskIds = new Set(selection.taskIds)
  const wbsNodeIds = new Set(selection.wbsNodeIds)
  const acceptanceIds = new Set(selection.acceptanceIds)
  const milestoneIds = new Set(selection.milestoneIds)
  next.tasks = next.tasks.filter((task) => !taskIds.size || taskIds.has(task.id))
  next.dependencies = next.dependencies.filter(
    (dependency) => taskIds.has(dependency.predecessorId) && taskIds.has(dependency.successorId),
  )
  next.acceptanceCriteria = next.acceptanceCriteria.filter(
    (criterion) => !acceptanceIds.size || acceptanceIds.has(criterion.id),
  )
  next.milestoneHints = next.milestoneHints.filter(
    (milestone) => !milestoneIds.size || milestoneIds.has(milestone.id),
  )
  if (wbsNodeIds.size) next.wbs = next.wbs.filter((node) => wbsNodeIds.has(node.id))
  return next
}

function applyModifications(
  draft: ProjectDraft,
  modifications?: ProjectDraftModification[] | null,
): ProjectDraft {
  if (!modifications?.length) return draft
  const next = deepClone(draft)
  for (const modification of modifications)
    setValueAtPath(next, modification.path, modification.value)
  return next
}

function applyAutoFix(draft: ProjectDraft, item: DraftValidationIssue): DraftAutoFixDiff | null {
  if (!item.path) return null
  if (item.ruleId === 'HL-002' || item.ruleId === 'VE-008') {
    const match = /^tasks\[(\d+)]\.durationDays$/.exec(item.path)
    if (!match) return null
    const index = Number(match[1])
    const task = draft.tasks[index]
    if (!task) return null
    const before = task.durationDays.value
    task.durationDays.value = Math.min(30, Math.max(0.5, numericValue(before)))
    return { path: item.path, before, after: task.durationDays.value, reason: item.message }
  }
  if (item.ruleId === 'HL-004') {
    const marked = readMarkedAtPath(draft, item.path)
    if (!marked) return null
    const before = marked.marker.needsConfirmation
    marked.marker.needsConfirmation = true
    return {
      path: `${item.path}.marker.needsConfirmation`,
      before,
      after: true,
      reason: item.message,
    }
  }
  if (item.ruleId === 'HL-006') {
    const marked = readMarkedAtPath(draft, item.path)
    if (!marked || typeof marked.value !== 'string') return null
    const before = marked.value
    marked.value = formatIsoDate(
      snapToWorkingDay(draftWorkingCalendar(draft), parseIsoDate(before), 1),
    )
    return { path: item.path, before, after: marked.value, reason: item.message }
  }
  return null
}

function collectMarkedFields(draft: ProjectDraft) {
  return [
    { path: 'charter.startDate', marked: draft.charter.startDate },
    { path: 'charter.endDate', marked: draft.charter.endDate },
    ...draft.tasks.flatMap((task, index) => [
      { path: `tasks[${index}].durationDays`, marked: task.durationDays },
      { path: `tasks[${index}].startDate`, marked: task.startDate },
      { path: `tasks[${index}].endDate`, marked: task.endDate },
      { path: `tasks[${index}].assigneeHint`, marked: task.assigneeHint },
    ]),
    ...draft.dependencies.map((dependency, index) => ({
      path: `dependencies[${index}].lagDays`,
      marked: dependency.lagDays,
    })),
    ...draft.riskHints.map((risk, index) => ({
      path: `riskHints[${index}].level`,
      marked: risk.level,
    })),
    ...draft.milestoneHints.map((milestone, index) => ({
      path: `milestoneHints[${index}].targetDate`,
      marked: milestone.targetDate,
    })),
  ]
}

/**
 * 占用角色容量的任务：例会、周报、进度跟踪等持续性管理工作每周只占几小时，
 * 排期平衡时不占容量（见 resource_plan.isOngoingTask），这里保持同一口径，否则会误报超载。
 */
function capacityTasks(draft: ProjectDraft): ProjectDraft['tasks'] {
  return draft.tasks.filter((task) => !isOngoingTask(task.name.value))
}

function maxDailyAssigneeLoad(draft: ProjectDraft): number {
  const load = new Map<string, number>()
  for (const task of capacityTasks(draft)) {
    const roles = assigneeRoles(task)
    if (roles.length === 0) continue
    for (const day of daysBetween(task.startDate.value, task.endDate.value)) {
      load.set(day, (load.get(day) ?? 0) + roles.length)
    }
  }
  return Math.max(0, ...load.values())
}

/** 每日按角色聚合负载（day → role → 并发任务数）。 */
function dailyRoleLoads(draft: ProjectDraft): Map<string, Map<string, number>> {
  const byDay = new Map<string, Map<string, number>>()
  for (const task of capacityTasks(draft)) {
    for (const role of assigneeRoles(task)) {
      for (const day of daysBetween(task.startDate.value, task.endDate.value)) {
        const dayRoles = byDay.get(day) ?? new Map<string, number>()
        dayRoles.set(role, (dayRoles.get(role) ?? 0) + 1)
        byDay.set(day, dayRoles)
      }
    }
  }
  return byDay
}

/** 有容量裁决依据的角色超载点：单人资源默认容量 1；团体角色按 resourceHints.headcount。 */
function roleOverloadPoints(
  draft: ProjectDraft,
): Array<{ day: string; role: string; load: number; capacity: number }> {
  const capacityMap = roleCapacityMap(draft)
  const points: Array<{ day: string; role: string; load: number; capacity: number }> = []
  for (const [day, roles] of dailyRoleLoads(draft)) {
    for (const [role, load] of roles) {
      // 资源建议给出人数的角色一律按人数裁决（「后端开发」×10 不是单人资源）；
      // 无人数依据时，单人角色按 1 人，团体角色无从裁决。
      const capacity = capacityForRole(role, capacityMap) ?? (isTeamRole(role) ? null : 1)
      if (capacity === null) continue
      if (load > capacity) points.push({ day, role, load, capacity })
    }
  }
  return points
}

function totalCapacity(draft: ProjectDraft): number {
  return draft.resourceHints.reduce(
    (sum, resource) => sum + numericValue(resource.headcount.value),
    0,
  )
}

function assigneeCount(value: string): number {
  if (!value.trim()) return 0
  return value.split(ASSIGNEE_SEPARATOR).filter(Boolean).length
}

function daysBetween(startIso: string, endIso: string): string[] {
  const start = parseSafe(startIso)
  const end = parseSafe(endIso)
  if (start === null || end === null || end < start) return []
  const days: string[] = []
  for (let current = start; current <= end; current += DAY_MS) days.push(formatIsoDate(current))
  return days
}

function parseSafe(value: string): number | null {
  try {
    return parseIsoDate(value)
  } catch {
    return null
  }
}

function numericValue(value: number): number {
  return Number.isFinite(value) ? Number(value) : 0
}

function computeCriticalPathIds(draft: ProjectDraft): string[] {
  if (detectDependencyCycle(draft.dependencies)) return []
  const successors = new Map<string, string[]>()
  const indegree = new Map(draft.tasks.map((task) => [task.id, 0]))
  for (const dependency of draft.dependencies) {
    successors.set(dependency.predecessorId, [
      ...(successors.get(dependency.predecessorId) ?? []),
      dependency.successorId,
    ])
    indegree.set(dependency.successorId, (indegree.get(dependency.successorId) ?? 0) + 1)
  }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const next of successors.get(id) ?? []) {
      const count = (indegree.get(next) ?? 1) - 1
      indegree.set(next, count)
      if (count === 0) queue.push(next)
    }
  }
  return order.length === draft.tasks.length ? order : []
}

function readMarkedAtPath(
  draft: ProjectDraft,
  path: string,
): { value: unknown; marker: { needsConfirmation: boolean } } | null {
  const match = /^tasks\[(\d+)]\.(durationDays|startDate|endDate|assigneeHint)$/.exec(path)
  if (match) {
    const task = draft.tasks[Number(match[1])]
    const key = match[2] as keyof Pick<
      ProjectDraftTask,
      'durationDays' | 'startDate' | 'endDate' | 'assigneeHint'
    >
    return task?.[key] ?? null
  }
  if (path === 'charter.startDate') return draft.charter.startDate
  if (path === 'charter.endDate') return draft.charter.endDate
  return null
}

function setValueAtPath(
  target: unknown,
  path: string,
  value: ProjectDraftModification['value'],
): void {
  const parts = path.replace(/\[(\d+)]/g, '.$1').split('.')
  let cursor = target as Record<string, unknown>
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (typeof next !== 'object' || next === null) return
    cursor = next as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
