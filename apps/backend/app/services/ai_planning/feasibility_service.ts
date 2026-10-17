/**
 * 生成前的可行性评估与协商（2026-09-28，检查点 B + 日历提醒 A）。
 *
 * 时机：项目理解出来之后、开始生成之前（生成的 9 个模块中间不打断用户）。
 * 分工：模型估每项能力的工作量、指出前后矛盾；程序算工作日、产能、各方案的新日期与人数。
 * 结果只是建议——「推迟 / 加人 / 放第二期 / 照原计划」由用户选或在对话里商量，确认后才写进上下文。
 */
import type {
  ConfirmedProjectContext,
  FeasibilityAssessment,
  FeasibilityCapabilityEstimate,
  FeasibilityDecision,
  FeasibilityNegotiationReply,
  FeasibilityNegotiationTurn,
  FeasibilityOption,
  PlanningTeamMember,
} from '@aiproj/types'
import { contextTeamRoster } from '#services/ai_draft/resource_plan'
import { todayAnchor } from '#services/ai_intent/core_information_needs'
import { formatIsoDate, parseIsoDate } from '#services/gantt_working_calendar'
import {
  FOCUS_FACTOR,
  addWorkdays,
  dateInfo,
  generateWithPlanningTools,
  replaceDateMentionsDeep,
  teamCapacity,
  workdaysBetween,
  type TextGateway,
} from './planning_toolbox.js'

const DAY_MS = 86_400_000
const round1 = (value: number) => Math.round(value * 10) / 10

export interface FeasibilityFrame {
  startDate: string
  deadline: string | null
  team: PlanningTeamMember[]
  teamSource: FeasibilityAssessment['teamSource']
  historyFactor: number | null
}

/** 从上下文取开工日、截止日、团队与历史校准系数（开工日缺失按下一个工作日）。 */
export function feasibilityFrame(context: ConfirmedProjectContext, now: Date): FeasibilityFrame {
  const timeline = context.parsedIntent.timeline
  const today = formatIsoDate(todayAnchor(now) + DAY_MS)
  const startDate =
    timeline.startDate && /^\d{4}-\d{2}-\d{2}$/.test(timeline.startDate)
      ? timeline.startDate
      : dateInfo(today).nextWorkday
  let deadline =
    timeline.deadline && /^\d{4}-\d{2}-\d{2}$/.test(timeline.deadline) ? timeline.deadline : null
  if (!deadline && timeline.durationDays && timeline.durationDays > 0) {
    deadline = formatIsoDate(parseIsoDate(startDate) + (timeline.durationDays - 1) * DAY_MS)
  }
  const roster = contextTeamRoster(context)
  const factor = context.planningMemory?.durationFactor?.factor
  return {
    startDate,
    deadline,
    team: roster.map((entry) => ({ role: entry.role, headcount: entry.headcount })),
    teamSource:
      roster.length === 0 ? 'none' : roster.some((entry) => entry.source === 'ai') ? 'ai' : 'user',
    historyFactor: typeof factor === 'number' && Number.isFinite(factor) ? factor : null,
  }
}

/** 检查点 A：日历提醒（程序算，不靠模型）。 */
export function calendarNotices(frame: Pick<FeasibilityFrame, 'startDate' | 'deadline'>): string[] {
  const notices: string[] = []
  const start = dateInfo(frame.startDate)
  if (!start.isWorkday) {
    notices.push(
      `开工日 ${frame.startDate}（${start.weekday}${start.note ? `，${start.note}` : ''}）不上班，实际从 ${start.nextWorkday} 开始。`,
    )
  }
  if (!frame.deadline) return notices
  if (frame.deadline < frame.startDate) {
    notices.push(`截止日 ${frame.deadline} 早于开工日 ${frame.startDate}，请确认日期。`)
    return notices
  }
  const end = dateInfo(frame.deadline)
  if (!end.isWorkday) {
    notices.push(
      `截止日 ${frame.deadline} 是${end.note ?? end.weekday}，不上班；按前一个工作日 ${end.previousWorkday} 交付计算。`,
    )
  }
  const window = workdaysBetween(frame.startDate, frame.deadline)
  if (window.holidays.length > 0) {
    notices.push(
      `这段时间有法定假期：${window.holidays.join('；')}。${window.calendarDays} 天里实际工作日 ${window.workdays} 天。`,
    )
  }
  if (window.makeupWorkdays.length > 0) {
    notices.push(`调休上班：${window.makeupWorkdays.join('、')}（已算进工作日）。`)
  }
  if (window.workdays < 5) {
    notices.push(`只有 ${window.workdays} 个工作日，几乎只够做一件小事，请确认时间是否写对。`)
  }
  return notices
}

// ---------------------------------------------------------------------------
// 方案计算（纯程序）
// ---------------------------------------------------------------------------

function expectedOf(estimate: Pick<FeasibilityCapabilityEstimate, 'low' | 'high'>): number {
  return (estimate.low + estimate.high) / 2
}

export function effortOf(
  estimates: readonly FeasibilityCapabilityEstimate[],
  historyFactor: number | null,
  deferred: ReadonlySet<string> = new Set(),
) {
  const kept = estimates.filter((estimate) => !deferred.has(estimate.capabilityId))
  const factor = historyFactor ?? 1
  return {
    low: round1(kept.reduce((sum, e) => sum + e.low, 0) * factor),
    high: round1(kept.reduce((sum, e) => sum + e.high, 0) * factor),
    expected: round1(kept.reduce((sum, e) => sum + expectedOf(e), 0) * factor),
  }
}

/** 按这个团队做完 expected 人日要到哪天。 */
export function finishDate(startDate: string, expected: number, headcount: number): string | null {
  if (headcount <= 0 || expected <= 0) return null
  return addWorkdays(startDate, Math.max(1, Math.ceil(expected / (headcount * FOCUS_FACTOR)))).date
}

/** 放第二期：从最不核心的开始挑，被保留能力依赖的不能挑，挑到做得完为止。 */
export function chooseDeferrals(
  estimates: readonly FeasibilityCapabilityEstimate[],
  dependsOn: ReadonlyMap<string, readonly string[]>,
  capacity: number,
  historyFactor: number | null,
): string[] {
  const deferred = new Set<string>()
  const candidates = [...estimates]
    .filter((estimate) => estimate.deferrable && estimate.capabilityId !== 'overall')
    .sort((a, b) => b.priority - a.priority || expectedOf(b) - expectedOf(a))
  let progress = true
  while (effortOf(estimates, historyFactor, deferred).expected > capacity && progress) {
    progress = false
    for (const candidate of candidates) {
      if (deferred.has(candidate.capabilityId)) continue
      const neededByKept = estimates.some(
        (other) =>
          !deferred.has(other.capabilityId) &&
          other.capabilityId !== candidate.capabilityId &&
          (dependsOn.get(other.capabilityId) ?? []).includes(candidate.capabilityId),
      )
      if (neededByKept) continue
      deferred.add(candidate.capabilityId)
      progress = true
      break
    }
  }
  return [...deferred]
}

/** 按比例把团队扩到 target 人（每个角色至少保留原人数）。 */
export function scaleTeam(
  team: readonly PlanningTeamMember[],
  target: number,
): PlanningTeamMember[] {
  const total = team.reduce((sum, member) => sum + member.headcount, 0)
  if (total <= 0 || target <= total) return team.map((member) => ({ ...member }))
  const scaled = team.map((member) => ({
    ...member,
    headcount: Math.max(member.headcount, Math.floor((member.headcount * target) / total)),
  }))
  let remaining = target - scaled.reduce((sum, member) => sum + member.headcount, 0)
  // 余数给原本人数最多的角色（通常是开发，最能并行）
  const order = [...scaled].sort((a, b) => b.headcount - a.headcount)
  for (let index = 0; remaining > 0; index = (index + 1) % order.length, remaining--) {
    order[index]!.headcount++
  }
  return scaled
}

function teamText(team: readonly PlanningTeamMember[]): string {
  return team.map((member) => `${member.role} ${member.headcount}`).join('、')
}

function teamDiff(
  before: readonly PlanningTeamMember[],
  after: readonly PlanningTeamMember[],
): string {
  return after
    .map((member) => {
      const was = before.find((item) => item.role === member.role)?.headcount ?? 0
      return member.headcount > was ? `${member.role} +${member.headcount - was}` : null
    })
    .filter(Boolean)
    .join('、')
}

/** 根据估算结果生成结论、摘要与可选方案（全部由程序计算，模型不参与数字）。 */
export function buildAssessment(args: {
  frame: FeasibilityFrame
  estimates: FeasibilityCapabilityEstimate[]
  dependsOn: ReadonlyMap<string, readonly string[]>
  contradictions: string[]
}): FeasibilityAssessment {
  const { frame, estimates } = args
  const effort = effortOf(estimates, frame.historyFactor)
  const headcount = frame.team.reduce((sum, member) => sum + member.headcount, 0)
  const notices = calendarNotices(frame)
  const capacity =
    frame.deadline && frame.deadline >= frame.startDate && headcount > 0
      ? teamCapacity(frame.team, frame.startDate, frame.deadline)
      : null
  const workdays =
    frame.deadline && frame.deadline >= frame.startDate
      ? workdaysBetween(frame.startDate, frame.deadline).workdays
      : null
  const projected = finishDate(frame.startDate, effort.expected, headcount)
  const options: FeasibilityOption[] = []
  const asIs: FeasibilityOption = {
    id: 'as_is',
    kind: 'as_is',
    label: '照原计划生成',
    detail: '不改时间、团队和范围；生成后若仍超期，在审查页再商量。',
    decision: { kind: 'as_is', summary: '生成前评估后决定照原计划生成' },
  }

  let verdict: FeasibilityAssessment['verdict'] = 'unknown'
  let summary: string
  const effortText = `预计工作量约 ${effort.low}–${effort.high} 人日（取中值 ${effort.expected}）${
    frame.historyFactor && frame.historyFactor !== 1
      ? `，已按你们过去的执行偏差 ×${frame.historyFactor} 校准`
      : ''
  }`
  if (!capacity || !workdays || headcount === 0) {
    summary =
      headcount === 0
        ? `${effortText}。还不知道团队人数，生成时会按工作量估算团队。`
        : `${effortText}。没有截止日，按 ${teamText(frame.team)} 预计 ${projected ?? '—'} 完成。`
    options.push(asIs)
  } else {
    const ratio = effort.expected / Math.max(1, capacity.personDays)
    verdict = ratio > 1.1 ? 'over' : ratio > 0.9 ? 'tight' : ratio < 0.6 ? 'early' : 'fits'
    const who = `${frame.teamSource === 'ai' ? 'AI 建议的团队' : '你们'}（${teamText(frame.team)}，共 ${headcount} 人）`
    summary = `${effortText}；${who}在 ${frame.startDate}~${frame.deadline} 的 ${workdays} 个工作日里可投入约 ${capacity.personDays} 人日（已按 ${FOCUS_FACTOR} 可投入系数折算，扣掉会议、沟通、请假等）。`
    const neededWorkdays = Math.ceil(effort.expected / (headcount * FOCUS_FACTOR))

    if (verdict === 'over' || verdict === 'tight') {
      summary +=
        verdict === 'over'
          ? ` 照现在的人手预计要到 ${projected} 才能做完，比截止日晚约 ${neededWorkdays - workdays} 个工作日。`
          : ' 刚好够，但几乎没有缓冲，任何返工都会超期。'
      // 推迟：做完所需的工作日（tight 时多留一成缓冲）
      const extendTo = addWorkdays(
        frame.startDate,
        verdict === 'tight' ? Math.ceil(neededWorkdays * 1.1) : neededWorkdays,
      ).date
      if (extendTo > frame.deadline!) {
        options.push({
          id: 'extend',
          kind: 'extend',
          label: `截止日推迟到 ${extendTo}`,
          detail: `多出约 ${workdaysBetween(frame.deadline!, extendTo).workdays - 1} 个工作日${verdict === 'tight' ? '（含一成缓冲）' : ''}，团队与范围不变。`,
          decision: {
            kind: 'extend',
            summary: `截止日从 ${frame.deadline} 推迟到 ${extendTo}`,
            deadline: extendTo,
          },
        })
      }
      // 加人
      const targetHeadcount = Math.ceil(
        (effort.expected * (verdict === 'tight' ? 1.1 : 1)) / (workdays * FOCUS_FACTOR),
      )
      if (targetHeadcount > headcount) {
        const team = scaleTeam(frame.team, targetHeadcount)
        options.push({
          id: 'add_people',
          kind: 'add_people',
          label: `加 ${targetHeadcount - headcount} 人（${teamDiff(frame.team, team)}）`,
          detail: `截止日和范围不变。注意：新人要熟悉项目，加人不一定按比例缩短工期。`,
          decision: {
            kind: 'add_people',
            summary: `团队调整为 ${teamText(team)}（加 ${targetHeadcount - headcount} 人）`,
            team,
          },
        })
      }
      // 放第二期
      const deferredIds = chooseDeferrals(
        estimates,
        args.dependsOn,
        capacity.personDays,
        frame.historyFactor,
      )
      if (deferredIds.length > 0) {
        const names = deferredIds.map(
          (id) => estimates.find((estimate) => estimate.capabilityId === id)?.name ?? id,
        )
        const after = effortOf(estimates, frame.historyFactor, new Set(deferredIds))
        options.push({
          id: 'defer',
          kind: 'defer',
          label: `第二期再做：${names.join('、')}`,
          detail: `这一期工作量降到约 ${after.expected} 人日，按现有人手预计 ${finishDate(frame.startDate, after.expected, headcount)} 完成。`,
          decision: {
            kind: 'defer',
            summary: `以下能力移到第二期：${names.join('、')}`,
            deferredCapabilityIds: deferredIds,
            deferredNames: names,
          },
        })
      }
      // 推荐：推迟不超过 15% 就推迟；否则优先放第二期；再否则加人
      const recommended =
        options.find((option) => option.kind === 'extend' && neededWorkdays <= workdays * 1.15) ??
        options.find((option) => option.kind === 'defer') ??
        options.find((option) => option.kind === 'add_people')
      if (recommended) recommended.recommended = true
      options.push(asIs)
    } else if (verdict === 'early') {
      const earlyTo = addWorkdays(frame.startDate, Math.ceil(neededWorkdays * 1.15)).date
      summary += ` 照现在的人手预计 ${projected} 就能做完，比截止日早不少。`
      if (earlyTo < frame.deadline!) {
        options.push({
          id: 'finish_early',
          kind: 'finish_early',
          label: `截止日提前到 ${earlyTo}`,
          detail: '按预计完工日再留一成半缓冲；也可以保持原截止日，把多出的时间当缓冲。',
          decision: {
            kind: 'finish_early',
            summary: `截止日从 ${frame.deadline} 提前到 ${earlyTo}`,
            deadline: earlyTo,
          },
        })
      }
      options.push({ ...asIs, label: '保持原截止日（多出的时间当缓冲）', recommended: true })
    } else {
      summary += ' 时间与人手基本匹配。'
      options.push({ ...asIs, recommended: true })
    }
  }

  return {
    verdict,
    startDate: frame.startDate,
    deadline: frame.deadline,
    workdays,
    team: frame.team,
    teamSource: frame.teamSource,
    capacityPersonDays: capacity?.personDays ?? null,
    effortPersonDays: effort,
    historyFactor: frame.historyFactor,
    estimates,
    calendarNotices: notices,
    contradictions: args.contradictions,
    summary,
    options,
  }
}

// ---------------------------------------------------------------------------
// 模型：估工作量、找矛盾
// ---------------------------------------------------------------------------

const ESTIMATE_SYSTEM = [
  '你是资深项目经理，正在开工前评估工作量。只输出 JSON：',
  '{"estimates":[{"capabilityId":"…","low":人日,"high":人日,"deferrable":true|false,"priority":1..N,"reason":"一句话"}],"contradictions":["…"]}',
  '规则：',
  '- 每项能力都要估（capabilityId 用给出的 id），人日含设计、开发、自测与修复，按给出的团队角色估；low/high 是乐观与保守值；',
  '- 另加一项 capabilityId="overall"：项目管理、联调、整体测试、上线与培训等不属于单项能力的工作，deferrable=false；',
  '- priority：1 = 没有它项目就不成立；越大越可以晚点做；deferrable=true 表示可以放第二期且不影响第一期上线；',
  '- contradictions：需求里前后矛盾、或会明显影响排期却没说清的地方（如「3 人两周做完 20 个模块」「上线日早于开工日」「既要私有化又说用公有云」），每条一句话、说清楚矛盾在哪、建议怎么确认；没有就给空数组，不要凑；',
  '- 日期、工作日、人日请用计划工具箱让程序算，不要心算。',
].join('\n')

interface EstimateInput {
  gateway: TextGateway
  context: ConfirmedProjectContext
  now: Date
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
  signal?: AbortSignal
}

export async function assessFeasibility(input: EstimateInput): Promise<FeasibilityAssessment> {
  const frame = feasibilityFrame(input.context, input.now)
  const understanding = input.context.planUnderstanding
  const capabilities = understanding?.capabilities ?? []
  const dependsOn = new Map(
    capabilities.map((capability) => [capability.id, capability.dependsOn ?? []]),
  )
  const userPrompt = JSON.stringify({
    today: formatIsoDate(todayAnchor(input.now)),
    project: input.context.parsedIntent.projectName,
    problem: understanding?.problemStatement,
    successPicture: understanding?.successPicture,
    capabilities: capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      purpose: capability.purpose,
      deliverables: capability.deliverables,
      dependsOn: capability.dependsOn,
    })),
    constraints: understanding?.constraints ?? input.context.parsedIntent.constraints,
    answeredQuestions: understanding?.answeredQuestions ?? [],
    startDate: frame.startDate,
    deadline: frame.deadline,
    team: frame.team,
    teamSource: frame.teamSource,
    requirementExcerpt: input.context.rawInput.slice(0, 6_000),
  })
  const result = await generateWithPlanningTools({
    gateway: input.gateway,
    systemPrompt: ESTIMATE_SYSTEM,
    userPrompt,
    sentence: '评估工作量与能否如期完成',
    promptName: 'plan.feasibility',
    now: input.now,
    // 推理模型的思考过程也算在输出额度里
    maxOutputTokens: 16_000,
    ...(input.onText ? { onText: input.onText } : {}),
    ...(input.onReasoning ? { onReasoning: input.onReasoning } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  })
  const estimates = normalizeEstimates(result.answer?.estimates, capabilities)
  if (estimates.length === 0) throw new Error('模型没有给出可用的工作量估算')
  const contradictions = (
    Array.isArray(result.answer?.contradictions) ? result.answer.contradictions : []
  )
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 200))
    .slice(0, 5)
  return buildAssessment({ frame, estimates, dependsOn, contradictions })
}

export function normalizeEstimates(
  raw: unknown,
  capabilities: ReadonlyArray<{ id: string; name: string }>,
): FeasibilityCapabilityEstimate[] {
  const names = new Map(capabilities.map((capability) => [capability.id, capability.name]))
  const seen = new Set<string>()
  const out: FeasibilityCapabilityEstimate[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const id = String(record.capabilityId ?? '')
    if (!id || seen.has(id) || (id !== 'overall' && !names.has(id))) continue
    let low = Number(record.low)
    let high = Number(record.high)
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0) continue
    if (high < low) [low, high] = [high, low]
    seen.add(id)
    out.push({
      capabilityId: id,
      name: id === 'overall' ? '整体联调、测试与上线' : names.get(id)!,
      low: round1(Math.min(low, 2_000)),
      high: round1(Math.min(high, 3_000)),
      deferrable: id !== 'overall' && record.deferrable === true,
      priority: Number.isFinite(Number(record.priority)) ? Number(record.priority) : 1,
      reason: typeof record.reason === 'string' ? record.reason.slice(0, 160) : '',
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// 协商：用户用自己的话说想法，模型回应并提出方案，程序核算数字
// ---------------------------------------------------------------------------

const NEGOTIATE_SYSTEM = [
  '你在和项目负责人商量「这个项目能不能如期完成、怎么调整」。语气平实、简短（3–5 句），用简体中文。',
  '只输出 JSON：{"reply":"对用户说的话","proposal":null 或 {"kind":"extend|add_people|defer|as_is|finish_early|custom","deadline":"YYYY-MM-DD"|null,"team":[{"role":"…","headcount":N}]|null,"deferredCapabilityIds":["…"]|null}}',
  '规则：',
  '- 用户的想法若与已知信息矛盾（例如要求提前却不加人也不减范围、要加的角色其实不是瓶颈、日期落在假期），直接指出并给出可行的替代；',
  '- 用户说得不清楚时先问一个具体问题，proposal 给 null；',
  '- 能落成方案时给 proposal：只填改动的字段；team 要给调整后的完整团队；deferredCapabilityIds 只能用评估里出现的 id；',
  '- 你只提建议，最终由用户点确认；不要说「已经帮你改好了」。',
  '- 日期与人日用计划工具箱让程序算。',
  '- assessment.plannedEndDate 有值时，计划已经按任务依赖与角色真实排好：能否按期、缓冲多少，一律以 plannedEndDate 与 deadline 比较为准；人日合计只是粗估，不要用人日差额得出与真实排期相反的结论（例如真实排期在截止日前完工，就不能说「已经差几人日、做不完」）。',
].join('\n')

export async function negotiateFeasibility(input: {
  gateway: TextGateway
  assessment: FeasibilityAssessment
  history: FeasibilityNegotiationTurn[]
  message: string
  now: Date
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
  signal?: AbortSignal
}): Promise<FeasibilityNegotiationReply> {
  const { assessment } = input
  const userPrompt = JSON.stringify({
    today: formatIsoDate(todayAnchor(input.now)),
    assessment: {
      summary: assessment.summary,
      startDate: assessment.startDate,
      deadline: assessment.deadline,
      ...(assessment.plannedEndDate ? { plannedEndDate: assessment.plannedEndDate } : {}),
      workdays: assessment.workdays,
      team: assessment.team,
      capacityPersonDays: assessment.capacityPersonDays,
      effortPersonDays: assessment.effortPersonDays,
      capabilities: assessment.estimates.map((estimate) => ({
        id: estimate.capabilityId,
        name: estimate.name,
        personDays: `${estimate.low}-${estimate.high}`,
        deferrable: estimate.deferrable,
        priority: estimate.priority,
      })),
      calendarNotices: assessment.calendarNotices,
      contradictions: assessment.contradictions,
      options: assessment.options.map((option) => option.label),
    },
    history: input.history
      .slice(-8)
      .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 600) })),
    message: input.message.slice(0, 1_000),
  })
  const result = await generateWithPlanningTools({
    gateway: input.gateway,
    systemPrompt: NEGOTIATE_SYSTEM,
    userPrompt,
    sentence: '商量能否如期完成',
    promptName: 'plan.feasibility_negotiate',
    now: input.now,
    maxOutputTokens: 8_000,
    ...(input.onText ? { onText: input.onText } : {}),
    ...(input.onReasoning ? { onReasoning: input.onReasoning } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  })
  const reply =
    typeof result.answer?.reply === 'string' && result.answer.reply.trim()
      ? result.answer.reply.trim().slice(0, 1_200)
      : '我没能理解这个想法，可以换个说法，或直接选上面的方案。'
  return { reply, proposal: priceProposal(result.answer?.proposal, assessment) }
}

/** 把模型提的方案落成可确认的选项：字段逐一校验，数字由程序重算。 */
export function priceProposal(
  raw: unknown,
  assessment: FeasibilityAssessment,
): FeasibilityOption | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const kinds = ['extend', 'add_people', 'defer', 'as_is', 'finish_early', 'custom'] as const
  const kind = kinds.find((item) => item === record.kind)
  if (!kind) return null
  const frame = { startDate: assessment.startDate ?? formatIsoDate(Date.now()) }
  const deadline =
    typeof record.deadline === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.deadline) &&
    record.deadline >= frame.startDate
      ? record.deadline
      : null
  const team = Array.isArray(record.team)
    ? record.team
        .filter(
          (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
        )
        .map((item) => ({
          role: String(item.role ?? '').trim(),
          headcount: Math.round(Number(item.headcount)),
        }))
        .filter((member) => member.role && member.headcount > 0 && member.headcount <= 200)
        .slice(0, 20)
    : []
  const known = new Set(assessment.estimates.map((estimate) => estimate.capabilityId))
  const deferredIds = Array.isArray(record.deferredCapabilityIds)
    ? [...new Set(record.deferredCapabilityIds.map(String))].filter(
        (id) => known.has(id) && id !== 'overall',
      )
    : []
  if (kind !== 'as_is' && !deadline && team.length === 0 && deferredIds.length === 0) return null

  const nextDeadline = deadline ?? assessment.deadline
  const nextTeam = team.length > 0 ? team : assessment.team
  const headcount = nextTeam.reduce((sum, member) => sum + member.headcount, 0)
  const effort = effortOf(assessment.estimates, assessment.historyFactor, new Set(deferredIds))
  const projected = finishDate(frame.startDate, effort.expected, headcount)
  const capacity =
    nextDeadline && headcount > 0
      ? teamCapacity(nextTeam, frame.startDate, nextDeadline).personDays
      : null
  const deferredNames = deferredIds.map(
    (id) => assessment.estimates.find((estimate) => estimate.capabilityId === id)?.name ?? id,
  )
  const parts = [
    deadline ? `截止日改为 ${deadline}` : null,
    team.length > 0 ? `团队改为 ${teamText(team)}` : null,
    deferredNames.length > 0 ? `第二期再做：${deferredNames.join('、')}` : null,
  ].filter(Boolean)
  // 审查页（已排好、带 plannedEndDate）上「不调整」就是保持现在的计划，不再是「照原计划生成」。
  const summary =
    kind === 'as_is'
      ? assessment.plannedEndDate
        ? '维持现在的计划，不调整'
        : '照原计划生成'
      : parts.join('；')
  const fit =
    capacity === null
      ? `预计 ${projected ?? '—'} 完成`
      : effort.expected <= capacity
        ? `工作量约 ${effort.expected} 人日，产能约 ${capacity} 人日，做得完（预计 ${projected} 完成）`
        : `工作量约 ${effort.expected} 人日，产能约 ${capacity} 人日，仍会超期（预计 ${projected} 完成）`
  return {
    id: 'proposal',
    kind,
    label: summary,
    detail: `程序核算：${fit}。`,
    decision: {
      kind,
      summary,
      ...(deadline ? { deadline } : {}),
      ...(team.length > 0 ? { team } : {}),
      ...(deferredIds.length > 0 ? { deferredCapabilityIds: deferredIds, deferredNames } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// 套用：生成开始前把用户确认的决定落到上下文
// ---------------------------------------------------------------------------

export function applyFeasibilityDecision(
  context: ConfirmedProjectContext,
): ConfirmedProjectContext {
  const decision: FeasibilityDecision | undefined = context.feasibilityDecision
  if (!decision || decision.kind === 'as_is') return context
  let next: ConfirmedProjectContext = context
  if (decision.deadline && /^\d{4}-\d{2}-\d{2}$/.test(decision.deadline)) {
    const previous = next.parsedIntent.timeline.deadline
    // 项目理解是在商量之前写的：其中提到旧截止日的文字（能力说明、成功画面等）一并换成新日期。
    // 实测 WBS 说明里留着「保障 2026-10-31 前上线」。用户亲口的回答（answeredQuestions）不改。
    if (previous && previous !== decision.deadline && next.planUnderstanding) {
      const { answeredQuestions, ...rest } = next.planUnderstanding
      next = {
        ...next,
        planUnderstanding: {
          ...replaceDateMentionsDeep(rest, previous, decision.deadline),
          ...(answeredQuestions ? { answeredQuestions } : {}),
        },
      }
    }
    const timeline = { ...next.parsedIntent.timeline, deadline: decision.deadline }
    if (timeline.startDate && /^\d{4}-\d{2}-\d{2}$/.test(timeline.startDate)) {
      timeline.durationDays =
        Math.round((parseIsoDate(decision.deadline) - parseIsoDate(timeline.startDate)) / DAY_MS) +
        1
    }
    next = { ...next, parsedIntent: { ...next.parsedIntent, timeline } }
  }
  const deferred = new Set(decision.deferredCapabilityIds ?? [])
  if (deferred.size > 0 && next.planUnderstanding) {
    const understanding = next.planUnderstanding
    const names = understanding.capabilities
      .filter((capability) => deferred.has(capability.id))
      .map((capability) => capability.name)
    next = {
      ...next,
      planUnderstanding: {
        ...understanding,
        capabilities: understanding.capabilities
          .filter((capability) => !deferred.has(capability.id))
          .map((capability) => ({
            ...capability,
            dependsOn: (capability.dependsOn ?? []).filter((id) => !deferred.has(id)),
          })),
        constraints: [
          ...understanding.constraints,
          `第二期再做（用户在生成前决定，本期不排）：${names.join('、')}`,
        ],
      },
    }
  }
  return next
}
