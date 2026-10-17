/**
 * 生成后在审查页协商调整（2026-09-28，检查点 C）。
 *
 * 草案已经排好，但可能超期（或做得比截止日早很多）。用户选方案或在对话里商量出决定后：
 * 程序在这份草案上改截止日 / 团队 / 范围（按能力整块移到第二期），用与生成时相同的排期程序
 * 重新排一遍（几秒），给出前后对比；用户确认才存成新的草案版本（仍是草案，不落正式表）。
 */
import type {
  FeasibilityAssessment,
  FeasibilityCapabilityEstimate,
  FeasibilityDecision,
  FeasibilityOption,
  PlanningTeamMember,
  ReplanPreview,
  ReplanSnapshot,
} from '@aiproj/types'
import { buildDraftCalendar } from '#services/ai_draft/cn_calendar'
import { isOngoingTask, planDraftResources } from '#services/ai_draft/resource_plan'
import { calendarNotices, effortOf } from './feasibility_service.js'
import {
  FOCUS_FACTOR,
  addWorkdays,
  replaceDateMentionsDeep,
  teamCapacity,
  workdaysBetween,
} from './planning_toolbox.js'

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const markedValue = (value: unknown): unknown => (isObject(value) ? value.value : undefined)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const asIso = (value: unknown): string | null =>
  typeof value === 'string' && ISO.test(value) ? value : null

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function userMarker(reason: string): JsonObject {
  return { confidence: 1, source: 'explicit', reason, needsConfirmation: false }
}

/** 草案里的团队：资源建议的角色与人数（生成时已按名册对齐）。 */
export function draftTeam(draft: JsonObject): PlanningTeamMember[] {
  return (Array.isArray(draft.resourceHints) ? draft.resourceHints : [])
    .filter(isObject)
    .map((hint) => ({
      role: String(markedValue(hint.role) ?? '').trim(),
      headcount: Math.round(Number(markedValue(hint.headcount)) || 0),
    }))
    .filter((member) => member.role && member.headcount > 0)
}

function tasksOf(draft: JsonObject): JsonObject[] {
  return (Array.isArray(draft.tasks) ? draft.tasks : []).filter(isObject)
}

function capabilityOf(task: JsonObject): { id: string; name: string } | null {
  const trace = isObject(task.trace) ? task.trace : null
  const id = typeof trace?.capabilityId === 'string' ? trace.capabilityId : null
  if (!id) return null
  return { id, name: typeof trace?.capabilityName === 'string' ? trace.capabilityName : id }
}

/**
 * 贯穿性工作（项目管理、测试、联调、部署上线、验收、培训）：不能整块放第二期；
 * 它们「依赖」所有功能只是因为要等功能做完，功能移走后它们照样做，不应挡住功能被放第二期。
 */
const CROSS_CUTTING =
  /项目管理|管理与验收|验收|测试|质量|联调|部署|上线|发布|投产|运维|培训|交付|运营准备/u

export function isCrossCutting(name: string): boolean {
  return CROSS_CUTTING.test(name)
}

/** 按能力汇总的工作量（人日 = 工期 × 负责角色数；持续性任务不计）与能力间依赖。 */
export function draftCapabilities(draft: JsonObject) {
  const effort = new Map<string, { name: string; personDays: number; tasks: number }>()
  const capabilityOfTask = new Map<string, string>()
  for (const task of tasksOf(draft)) {
    const capability = capabilityOf(task)
    if (!capability) continue
    capabilityOfTask.set(String(task.id), capability.id)
    if (isOngoingTask(markedValue(task.name))) continue
    const days = Number(markedValue(task.durationDays)) || 0
    const roles = markedValue(task.assigneeRoleIds)
    const people = Array.isArray(roles) && roles.length > 0 ? roles.length : 1
    const entry = effort.get(capability.id) ?? { name: capability.name, personDays: 0, tasks: 0 }
    entry.personDays += days * people
    entry.tasks++
    effort.set(capability.id, entry)
  }
  const dependsOn = new Map<string, string[]>()
  for (const dependency of (Array.isArray(draft.dependencies) ? draft.dependencies : []).filter(
    isObject,
  )) {
    const from = capabilityOfTask.get(String(dependency.predecessorId))
    const to = capabilityOfTask.get(String(dependency.successorId))
    if (!from || !to || from === to) continue
    const list = dependsOn.get(to) ?? []
    if (!list.includes(from)) list.push(from)
    dependsOn.set(to, list)
  }
  return { effort, dependsOn }
}

function schedule(draft: JsonObject, team: readonly PlanningTeamMember[], compress: boolean) {
  const charter = isObject(draft.charter) ? draft.charter : {}
  const start = asIso(markedValue(charter.startDate))
  const end = asIso(markedValue(charter.endDate))
  const calendar = buildDraftCalendar({ startDate: start, endDate: end })
  return planDraftResources(
    draft,
    team.map((member) => ({ role: member.role, headcount: member.headcount })),
    calendar.calendar,
    calendar.freezeWindows,
    { projectStart: start, compress },
  )
}

function snapshot(
  plan: ReturnType<typeof planDraftResources>,
  draft: JsonObject,
  team: PlanningTeamMember[],
): ReplanSnapshot {
  return {
    plannedEndDate: plan.report.plannedEndDate,
    deadline:
      plan.report.deadline ??
      asIso(markedValue((draft.charter as JsonObject | undefined)?.endDate)),
    exceededWorkdays: plan.report.deadlineExceededWorkdays,
    taskCount: tasksOf(draft).length,
    team,
  }
}

/** 把能力整块移到第二期：删任务、接续被切断的依赖、修剪空 WBS、清理验收标准与里程碑。 */
export function deferCapabilities(draft: JsonObject, capabilityIds: ReadonlySet<string>) {
  const removed = new Set(
    tasksOf(draft)
      .filter((task) => {
        const capability = capabilityOf(task)
        return capability !== null && capabilityIds.has(capability.id)
      })
      .map((task) => String(task.id)),
  )
  if (removed.size === 0) return { draft, removed, names: [] as string[] }
  const names = [
    ...new Set(
      tasksOf(draft)
        .filter((task) => removed.has(String(task.id)))
        .map((task) => capabilityOf(task)!.name),
    ),
  ]
  const dependencies = (Array.isArray(draft.dependencies) ? draft.dependencies : []).filter(
    isObject,
  )
  // 被移走任务的前驱直接接到它的后继上，保留剩余任务之间原有的先后关系。
  const preds = new Map<string, Set<string>>()
  const succs = new Map<string, Set<string>>()
  for (const dependency of dependencies) {
    const from = String(dependency.predecessorId)
    const to = String(dependency.successorId)
    ;(succs.get(from) ?? succs.set(from, new Set()).get(from)!).add(to)
    ;(preds.get(to) ?? preds.set(to, new Set()).get(to)!).add(from)
  }
  const keptAncestors = (id: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>()
    for (const pred of preds.get(id) ?? []) {
      if (seen.has(pred)) continue
      seen.add(pred)
      if (removed.has(pred)) for (const up of keptAncestors(pred, seen)) out.add(up)
      else out.add(pred)
    }
    return out
  }
  const kept = dependencies.filter(
    (dependency) =>
      !removed.has(String(dependency.predecessorId)) &&
      !removed.has(String(dependency.successorId)),
  )
  const existing = new Set(kept.map((d) => `${String(d.predecessorId)}>${String(d.successorId)}`))
  let bridge = 0
  for (const task of tasksOf(draft)) {
    const id = String(task.id)
    if (removed.has(id)) continue
    const hasRemovedPred = [...(preds.get(id) ?? [])].some((pred) => removed.has(pred))
    if (!hasRemovedPred) continue
    for (const ancestor of keptAncestors(id)) {
      const key = `${ancestor}>${id}`
      if (existing.has(key)) continue
      existing.add(key)
      kept.push({
        id: `dep-replan-${++bridge}`,
        predecessorId: ancestor,
        successorId: id,
        type: 'FS',
        lagDays: { value: 0, marker: userMarker('移出第二期的任务原本承接的先后关系') },
      })
    }
  }
  const tasks = tasksOf(draft).filter((task) => !removed.has(String(task.id)))
  const usedNodes = new Set(tasks.map((task) => String(task.wbsNodeId)))
  const prune = (nodes: unknown[]): unknown[] =>
    nodes.filter(isObject).flatMap((node) => {
      const children = prune(Array.isArray(node.children) ? node.children : [])
      const hadChildren = Array.isArray(node.children) && node.children.length > 0
      const keep = hadChildren
        ? children.length > 0
        : node.isNote === true || usedNodes.has(String(node.id))
      return keep ? [{ ...node, children }] : []
    })
  const charter = isObject(draft.charter) ? draft.charter : {}
  const scope = String(markedValue(charter.scope) ?? '')
  return {
    removed,
    names,
    draft: {
      ...draft,
      tasks,
      dependencies: kept,
      wbs: prune(Array.isArray(draft.wbs) ? draft.wbs : []),
      acceptanceCriteria: (Array.isArray(draft.acceptanceCriteria) ? draft.acceptanceCriteria : [])
        .filter(isObject)
        .filter(
          (item) => !(typeof item.linkedTaskId === 'string' && removed.has(item.linkedTaskId)),
        ),
      // 原来挂着任务、而这些任务全被移走的里程碑一并移走；没挂任务的保留。
      milestoneHints: (Array.isArray(draft.milestoneHints) ? draft.milestoneHints : [])
        .filter(isObject)
        .flatMap((milestone) => {
          const linked = (
            Array.isArray(milestone.linkedTaskIds) ? milestone.linkedTaskIds : []
          ).map(String)
          const remaining = linked.filter((id) => !removed.has(id))
          return linked.length > 0 && remaining.length === 0
            ? []
            : [{ ...milestone, linkedTaskIds: remaining }]
        }),
      charter: {
        ...charter,
        scope: {
          ...(isObject(charter.scope) ? charter.scope : {}),
          value: `${scope}${scope ? '\n' : ''}第二期再做（审查时决定，本期不排）：${names.join('、')}`,
        },
      },
    } as JsonObject,
  }
}

/**
 * 截止日改了以后，章程里模型写的目标 / 愿景 / 成功标准等文字若提到旧截止日，一并换成新日期
 * （2026-11-16 与「11 月 16 日」两种写法）。只换与旧截止日完全相同的日期，其它日期不动。
 */
export function rewriteCharterDate(charter: JsonObject, from: string, to: string): JsonObject {
  if (from === to) return charter
  const rewrite = (value: unknown): unknown => replaceDateMentionsDeep(value, from, to)
  const result: JsonObject = { ...charter }
  for (const [key, field] of Object.entries(charter)) {
    if (key === 'startDate' || key === 'endDate') continue
    if (isObject(field) && 'value' in field) result[key] = { ...field, value: rewrite(field.value) }
    else if (typeof field === 'string' || Array.isArray(field)) result[key] = rewrite(field)
  }
  return result
}

/** 按决定改草案并重排；返回新草案与前后对比（不落库）。 */
export function replanDraft(
  original: JsonObject,
  decision: Omit<FeasibilityDecision, 'decidedAt'>,
): { draft: JsonObject; preview: ReplanPreview } {
  const beforeTeam = draftTeam(original)
  const beforePlan = schedule(original, beforeTeam, false)
  let draft = clone(original)
  let removedTasks = 0
  if (decision.deferredCapabilityIds?.length) {
    const deferred = deferCapabilities(draft, new Set(decision.deferredCapabilityIds))
    draft = deferred.draft
    removedTasks = deferred.removed.size
  }
  if (decision.deadline && ISO.test(decision.deadline)) {
    const charter = isObject(draft.charter) ? draft.charter : {}
    const previous = asIso(markedValue(charter.endDate))
    draft.charter = {
      ...(previous ? rewriteCharterDate(charter, previous, decision.deadline) : charter),
      endDate: { value: decision.deadline, marker: userMarker('审查时协商调整的截止日') },
    }
  }
  const afterTeam = decision.team?.length
    ? decision.team.filter((member) => member.role && member.headcount > 0)
    : beforeTeam
  // 只改截止日时排期本身不变；改团队或范围才压缩重排（任务可以往前挪）。
  const plan = schedule(draft, afterTeam, Boolean(decision.team?.length || removedTasks))
  draft = {
    ...draft,
    tasks: plan.tasks,
    resourceHints: plan.resourceHints,
    riskHints: plan.riskHints,
    milestoneHints: plan.milestoneHints,
    ganttPreview: plan.ganttPreview,
  }
  if (decision.team?.length) {
    // 用户确认的人数写进资源建议的标注。
    draft.resourceHints = (draft.resourceHints as unknown[]).filter(isObject).map((hint) => {
      const member = afterTeam.find((item) => item.role === markedValue(hint.role))
      return member
        ? {
            ...hint,
            headcount: { value: member.headcount, marker: userMarker('审查时协商调整的团队人数') },
          }
        : hint
    })
  }
  const before = snapshot(beforePlan, original, beforeTeam)
  const after = snapshot(plan, draft, afterTeam)
  const beforeEnds = new Map(
    (beforePlan.tasks as unknown[])
      .filter(isObject)
      .map((task) => [String(task.id), String(markedValue(task.endDate) ?? '')]),
  )
  const movedTasks = (plan.tasks as unknown[])
    .filter(isObject)
    .map((task) => ({
      name: String(markedValue(task.name) ?? ''),
      fromEnd: beforeEnds.get(String(task.id)) ?? '',
      toEnd: String(markedValue(task.endDate) ?? ''),
    }))
    .filter((task) => task.fromEnd && task.toEnd && task.fromEnd !== task.toEnd)
    .sort(
      (a, b) =>
        Math.abs(Date.parse(b.toEnd) - Date.parse(b.fromEnd)) -
        Math.abs(Date.parse(a.toEnd) - Date.parse(a.fromEnd)),
    )
    .slice(0, 8)
  const endText = (s: ReplanSnapshot) =>
    `${s.plannedEndDate ?? '—'} 完工${s.exceededWorkdays > 0 ? `（晚于截止日 ${s.deadline} 约 ${s.exceededWorkdays} 个工作日）` : s.deadline ? `（截止日 ${s.deadline} 前完成）` : ''}`
  return {
    draft,
    preview: {
      decision,
      before,
      after,
      removedTasks,
      movedTasks,
      summary: `调整前：${endText(before)}；调整后：${endText(after)}${removedTasks ? `；移出 ${removedTasks} 个任务到第二期` : ''}。`,
      note:
        (decision.team?.length || removedTasks) &&
        (after.plannedEndDate ?? '') >= (before.plannedEndDate ?? '')
          ? '完工日没有提前：这份计划的瓶颈在任务依赖链上（前一项做完后一项才能开始），加人或减范围帮助不大；可以考虑推迟截止日，或在任务清单里调整依赖。'
          : null,
    },
  }
}

/**
 * 加人方案：逐个角色试加 1 人并真的重排，每轮留下让完工日提前最多的那个，最多加 4 人、赶上截止日就停。
 * 一个角色都帮不上（瓶颈在依赖链）就不给这个方案。
 */
export function searchStaffing(original: JsonObject, team: readonly PlanningTeamMember[]) {
  if (team.length === 0) return null
  let current = team.map((member) => ({ ...member }))
  let best = replanDraft(original, { kind: 'add_people', summary: '', team: current }).preview.after
  const start = best
  for (let round = 0; round < 4 && best.exceededWorkdays > 0; round++) {
    let pick: { team: PlanningTeamMember[]; after: ReplanSnapshot } | null = null
    for (const member of current) {
      if (isCrossCutting(member.role) && current.length > 1) continue
      const trial = current.map((item) =>
        item.role === member.role ? { ...item, headcount: item.headcount + 1 } : item,
      )
      const after = replanDraft(original, { kind: 'add_people', summary: '', team: trial }).preview
        .after
      if (
        (after.plannedEndDate ?? '') < (pick?.after.plannedEndDate ?? best.plannedEndDate ?? '')
      ) {
        pick = { team: trial, after }
      }
    }
    if (!pick) break
    current = pick.team
    best = pick.after
  }
  if (best.plannedEndDate === start.plannedEndDate) return null
  const added = current
    .map((member) => {
      const extra =
        member.headcount - (team.find((item) => item.role === member.role)?.headcount ?? 0)
      return extra > 0 ? `${member.role} +${extra}` : null
    })
    .filter(Boolean)
    .join('、')
  return { team: current, added, end: best.plannedEndDate, fits: best.exceededWorkdays === 0 }
}

/**
 * 放第二期方案：从最不核心的可放能力开始逐个移出并真的重排，赶上截止日就停，最多移两块
 * （再多就不是「晚点做」而是砍需求了，交给用户在对话里决定）。
 */
export function searchDeferral(
  original: JsonObject,
  estimates: readonly FeasibilityCapabilityEstimate[],
  dependsOn: ReadonlyMap<string, readonly string[]>,
) {
  const ids: string[] = []
  let after: ReplanSnapshot | null = null
  let best: { ids: string[]; after: ReplanSnapshot } | null = null
  const baseline =
    replanDraft(original, { kind: 'custom', summary: '' }).preview.before.plannedEndDate ?? ''
  for (let round = 0; round < 2; round++) {
    const candidate = [...estimates]
      .filter((estimate) => estimate.deferrable && !ids.includes(estimate.capabilityId))
      .filter(
        (estimate) =>
          !estimates.some(
            (other) =>
              !ids.includes(other.capabilityId) &&
              other.capabilityId !== estimate.capabilityId &&
              (dependsOn.get(other.capabilityId) ?? []).includes(estimate.capabilityId),
          ),
      )
      .sort((a, b) => b.priority - a.priority)[0]
    if (!candidate) break
    ids.push(candidate.capabilityId)
    after = replanDraft(original, {
      kind: 'defer',
      summary: '',
      deferredCapabilityIds: [...ids],
    }).preview.after
    // 只保留真的让完工日提前的移法；多移一块没有额外帮助就不移
    if ((after.plannedEndDate ?? '') < (best?.after.plannedEndDate ?? baseline)) {
      best = { ids: [...ids], after }
    }
    if (after.exceededWorkdays === 0) break
  }
  if (!best) return null
  const names = best.ids.map(
    (id) => estimates.find((estimate) => estimate.capabilityId === id)?.name ?? id,
  )
  return { ids: best.ids, names, after: best.after }
}

/** 审查页的现状评估：沿用生成前的结论与方案结构，数字来自这份草案的实际排期。 */
export function assessDraft(original: JsonObject): FeasibilityAssessment {
  const team = draftTeam(original)
  const plan = schedule(original, team, false)
  const charter = isObject(original.charter) ? original.charter : {}
  const startDate = asIso(markedValue(charter.startDate))
  const deadline = asIso(markedValue(charter.endDate))
  const headcount = team.reduce((sum, member) => sum + member.headcount, 0)
  const { effort, dependsOn: rawDependsOn } = draftCapabilities(original)
  const crossCutting = new Set(
    [...effort.entries()].filter(([, entry]) => isCrossCutting(entry.name)).map(([id]) => id),
  )
  // 贯穿性工作对功能的「依赖」不算数（功能移走它照样做）
  const dependsOn = new Map([...rawDependsOn].filter(([id]) => !crossCutting.has(id)))
  const estimates: FeasibilityCapabilityEstimate[] = [...effort.entries()].map(
    ([id, entry], index) => ({
      capabilityId: id,
      name: entry.name,
      low: Math.round(entry.personDays),
      high: Math.round(entry.personDays),
      // 不是贯穿性工作、且没有别的功能依赖它，才能整块移到第二期
      deferrable:
        !crossCutting.has(id) && ![...dependsOn.values()].some((list) => list.includes(id)),
      // 越靠后生成的能力越偏外围（理解层按主干在前排列）
      priority: index + 1,
      reason: `${entry.tasks} 个任务`,
    }),
  )
  const total = effortOf(estimates, null)
  const workdays =
    startDate && deadline && deadline >= startDate
      ? workdaysBetween(startDate, deadline).workdays
      : null
  const capacity =
    startDate && deadline && workdays && headcount > 0
      ? teamCapacity(team, startDate, deadline).personDays
      : null
  const exceeded = plan.report.deadlineExceededWorkdays
  const plannedEnd = plan.report.plannedEndDate
  const earlyBy =
    plannedEnd && deadline && plannedEnd < deadline
      ? workdaysBetween(plannedEnd, deadline).workdays - 1
      : 0
  const verdict: FeasibilityAssessment['verdict'] = !deadline
    ? 'unknown'
    : exceeded > 0
      ? 'over'
      : workdays && earlyBy > workdays * 0.25
        ? 'early'
        : earlyBy <= 2
          ? 'tight'
          : 'fits'
  const options: FeasibilityOption[] = []
  if (verdict === 'over' && plannedEnd) {
    options.push({
      id: 'extend',
      kind: 'extend',
      label: `截止日推迟到 ${plannedEnd}`,
      detail: `按现在的排期正好做完（多约 ${exceeded} 个工作日），团队与范围不变。`,
      decision: {
        kind: 'extend',
        summary: `截止日从 ${deadline} 推迟到 ${plannedEnd}`,
        deadline: plannedEnd,
      },
    })
    const staffed = searchStaffing(original, team)
    if (staffed) {
      options.push({
        id: 'add_people',
        kind: 'add_people',
        label: `加人：${staffed.added}`,
        detail: staffed.fits
          ? `程序按新人数实际重排过：${staffed.end} 完工，赶得上截止日。`
          : `程序按新人数实际重排过：${staffed.end} 完工，仍晚于截止日（瓶颈在依赖链上，加人帮助有限）。`,
        decision: { kind: 'add_people', summary: `团队加人：${staffed.added}`, team: staffed.team },
      })
    }
    const deferral = searchDeferral(original, estimates, dependsOn)
    if (deferral) {
      const { ids: deferredIds, names, after } = deferral
      {
        options.push({
          id: 'defer',
          kind: 'defer',
          label: `第二期再做：${names.join('、')}`,
          detail: `这些能力整块移出本期（约 ${Math.round(total.expected - effortOf(estimates, null, new Set(deferredIds)).expected)} 人日）。程序实际重排过：${after.plannedEndDate} 完工，${after.exceededWorkdays > 0 ? `仍晚于截止日约 ${after.exceededWorkdays} 个工作日` : '赶得上截止日'}。`,
          decision: {
            kind: 'defer',
            summary: `以下能力移到第二期：${names.join('、')}`,
            deferredCapabilityIds: deferredIds,
            deferredNames: names,
          },
        })
      }
    }
    // 建议：加人赶得上优先（不减范围）；只晚几天时推迟截止日，而不是砍掉整块功能——
    // 实测只晚 2 个工作日却建议把「订单锁定与窗口汇总」这种核心功能放第二期。晚得多时才建议放第二期。
    const fits = (kind: FeasibilityOption['kind']) =>
      options.find((option) => option.kind === kind && option.detail.includes('赶得上截止日'))
    const smallSlip = exceeded <= Math.max(2, Math.ceil((workdays ?? 0) * 0.1))
    const recommended =
      fits('add_people') ??
      (smallSlip ? null : fits('defer')) ??
      options.find((option) => option.kind === 'extend')
    if (recommended) recommended.recommended = true
  } else if (verdict === 'tight' && plannedEnd && workdays) {
    // 很紧：截止日往后留一成缓冲（至少 2 个工作日），任何返工不至于直接超期
    const buffer = Math.max(2, Math.ceil(workdays * 0.1))
    const bufferedTo = addWorkdays(plannedEnd, buffer + 1).date
    options.push({
      id: 'extend',
      kind: 'extend',
      label: `截止日延后到 ${bufferedTo}，留出缓冲`,
      detail: `排期不变，在完工日 ${plannedEnd} 之后留约 ${buffer} 个工作日缓冲，应对返工与联调问题。`,
      decision: {
        kind: 'extend',
        summary: `截止日从 ${deadline} 延后到 ${bufferedTo}（留 ${buffer} 个工作日缓冲）`,
        deadline: bufferedTo,
      },
    })
  } else if (verdict === 'early' && plannedEnd) {
    options.push({
      id: 'finish_early',
      kind: 'finish_early',
      label: `截止日提前到 ${plannedEnd}`,
      detail: `按现在的排期 ${plannedEnd} 就能做完，比截止日早约 ${earlyBy} 个工作日。`,
      decision: {
        kind: 'finish_early',
        summary: `截止日从 ${deadline} 提前到 ${plannedEnd}`,
        deadline: plannedEnd,
      },
    })
  }
  const summary =
    verdict === 'unknown'
      ? `按现在的排期 ${plannedEnd ?? '—'} 完工（没有截止日）。`
      : verdict === 'over'
        ? `按现在的排期 ${plannedEnd} 才能做完，比截止日 ${deadline} 晚约 ${exceeded} 个工作日。可以选一个方案，或者说说你的想法，我按新条件重排给你看。`
        : verdict === 'early'
          ? `按现在的排期 ${plannedEnd} 就能做完，比截止日 ${deadline} 早约 ${earlyBy} 个工作日。`
          : plannedEnd === deadline
            ? `按现在的排期正好在截止日 ${deadline} 当天完工，没有缓冲。`
            : `按现在的排期 ${plannedEnd} 完工，在截止日 ${deadline} 之前${verdict === 'tight' ? '，但几乎没有缓冲' : ''}。`
  return {
    verdict,
    startDate,
    deadline,
    workdays,
    team,
    teamSource: team.length > 0 ? 'user' : 'none',
    capacityPersonDays: capacity,
    effortPersonDays: total,
    historyFactor: null,
    estimates,
    calendarNotices: startDate && deadline ? calendarNotices({ startDate, deadline }) : [],
    contradictions: [],
    summary,
    options,
    plannedEndDate: plannedEnd ?? null,
  }
}

export { FOCUS_FACTOR }
