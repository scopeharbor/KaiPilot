/**
 * 草案生成的记忆系统与上下文隔离（2026-09-27）。
 *
 * 背景（账本实测，deepseek-v4.1-flash，14 批任务的项目）：每个阶段都把前面所有阶段的完整产物
 * （含每个字段的 Marked 包装）原样塞进 user 消息——排期阶段单次输入 6.9 万 token、资源阶段
 * 7.9 万 token，项目再大一倍就会顶到上下文上限；而模型真正需要的只是其中一小部分。
 *
 * 设计：
 * - 每次模型调用都是一次全新的对话（只有 system + user 两条消息，不带历史，重试也从干净 prompt 重建）；
 * - 生成过程中的全部产物存在「记忆」里，按用途切成片段：
 *     spine        项目主干：今天、问题、成功画面、范围、起止、团队、约束、假设（每次调用都带，约 2–5 千字）
 *     charter      章程全文
 *     capabilities 能力地图（理解层产物）
 *     wbsOutline   WBS 大纲（id / 编码 / 名称）
 *     taskIndex    任务索引：一行一条「id|WBS|名称|工期|角色|产出」，不含 Marked 包装
 *     taskDetail   指定任务的完整内容（单点修复时才取）
 * - 每个调用点声明自己要哪些片段（memoryView），并记录实际注入的字符数（contextUsage），
 *   超出预算时逐级降级（先去掉任务产出摘要，再只保留与焦点分支相关的任务）。
 */

import type {
  ConfirmedProjectContext,
  ProjectDraftContextUsage,
  ProjectDraftDecision,
  ProjectPlanUnderstanding,
} from '@aiproj/types'
import { formatIsoDate } from '#services/gantt_working_calendar'
import { todayAnchor } from '#services/ai_intent/core_information_needs'
import { contextTeamRoster } from './resource_plan.ts'

type JsonObject = Record<string, unknown>

/** 单次调用注入记忆的字符上限（中文约 1.5 字符/token，约 4 万 token，远低于常见 128k 上下文）。 */
export const MEMORY_VIEW_CHAR_BUDGET = 60_000
const SPINE_RAW_INPUT_CHARS = 50_000

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function markedValue(value: unknown): unknown {
  return isObject(value) && 'value' in value ? value.value : value
}

function text(value: unknown): string {
  const raw = markedValue(value)
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number') return String(raw)
  if (Array.isArray(raw)) return raw.map((item) => String(item)).join('；')
  return ''
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

const MENTION = /@([\p{L}\p{N}_.-]+)/gu

/**
 * 发给模型前把 @成员 换成代号「成员#id」（姓名不出本系统）；匹配不到的 @ 也抹掉原文。
 * 界面展示时再由代号换回真实姓名。
 */
export function maskMemberNames(value: string, context: ConfirmedProjectContext): string {
  const byHandle = new Map(
    (context.mentionedMembers ?? []).map((member) => [member.handle, member.userId]),
  )
  return value.replace(MENTION, (_whole, handle: string) => {
    const id = byHandle.get(handle)
    return id === undefined ? '成员(未匹配)' : `成员#${id}`
  })
}

/** 已确认的澄清问答（问题 → 回答），只取已回答项。 */
function confirmedAnswers(context: ConfirmedProjectContext): Array<{ q: string; a: string }> {
  const entries = context.adaptiveLedger?.entries ?? []
  return entries
    .filter((entry) => entry.status === 'answered' && entry.answer !== undefined)
    .slice(0, 30)
    .map((entry) => ({
      q: clip(entry.questionSummary || entry.topic || entry.needId, 80),
      a: clip(
        maskMemberNames(
          Array.isArray(entry.answer) ? entry.answer.join('、') : String(entry.answer),
          context,
        ),
        200,
      ),
    }))
}

function fieldSummary(
  fields: ConfirmedProjectContext['resolvedFields'],
): Array<{ field: string; value: string; source: string }> {
  return Object.entries(fields ?? {})
    .filter(([, marked]) => marked !== undefined)
    .map(([field, marked]) => ({
      field,
      value: clip(text(marked), 160),
      source: String((marked as { marker?: { source?: unknown } }).marker?.source ?? ''),
    }))
}

/**
 * 项目主干（spine）：每一次模型调用都注入，保证分批、分阶段的调用对「项目是什么」理解一致。
 * 只放结论性信息，不放任何阶段的明细产物。
 */
export function buildSpine(args: {
  context: ConfirmedProjectContext
  aggregate: JsonObject
  now?: Date
  understanding?: ProjectPlanUnderstanding | null
  /**
   * 是否附带用户原话。只有理解层调用带（由它提炼成问题陈述与能力地图）；
   * 各阶段调用只用提炼后的理解、已确认事实与问答（数据最小化，阶段 prompt 不含原话）。
   */
  includeUserRequest?: boolean
}): JsonObject {
  const { context, aggregate } = args
  const now = args.now ?? new Date()
  const charter = isObject(aggregate.charter) ? aggregate.charter : null
  const understanding = args.understanding ?? context.planUnderstanding ?? null
  const timeline = context.parsedIntent.timeline
  const roster = contextTeamRoster(context)
  const spine: JsonObject = {
    today: formatIsoDate(todayAnchor(now)),
    projectType: context.parsedIntent.projectType,
    schedule: {
      startDate: text(charter?.startDate) || timeline.startDate || null,
      endDate: text(charter?.endDate) || timeline.deadline || null,
      durationDays: timeline.durationDays ?? null,
      rule: '开工日与截止日已由用户确认或系统按今天推定，不得改动；任务日期由系统按依赖与工作日历排定。',
    },
    confirmedFacts: fieldSummary(context.resolvedFields).map((item) => ({
      ...item,
      value: maskMemberNames(item.value, context),
    })),
    assumedFacts: fieldSummary(context.assumptions),
    confirmedAnswers: confirmedAnswers(context),
  }
  const agreed = context.feasibilityDecision
  if (agreed && agreed.kind !== 'as_is') {
    // 生成前协商确认的决定优先于原话与问答里更早的说法。实测：协商定了截止 11-16，原话「10 月底上线」
    // 仍被写成任务里的「锁定 10-31 为硬上线日，11-16 仅作备用」。
    spine.agreedDecision = {
      decision: agreed.summary,
      rule:
        '这是用户在生成前与系统商量后确认的决定，优先于 userRequest / confirmedAnswers 里更早的说法：' +
        '截止日一律以 schedule.endDate 为准，更早提到的上线日、截止日已作废，不得在章程、任务、里程碑、风险里' +
        '写成上线日、硬上线日或截止日，也不要写成「新截止日仅作备用 / 缓冲」；' +
        '放到第二期的内容本期不排任务，只可在范围说明里注明「第二期」。',
    }
  }
  if (args.includeUserRequest) {
    // 项目理解只调用一次：读完整原文（最多 5 万字）+ 长需求整理稿，细节不在这一步丢失。
    spine.userRequest = clip(maskMemberNames(context.rawInput, context), SPINE_RAW_INPUT_CHARS)
    if (context.requirementBrief) spine.requirementBrief = context.requirementBrief
  }
  if (roster.length > 0) spine.teamRoster = roster
  // 跨生成记忆：本组织过去的计划被怎样修改、执行偏差多大（服务端从已落库数据推出）。
  if (context.planningMemory?.facts.length) spine.organizationHistory = context.planningMemory.facts
  if (context.mentionedMembers?.length) {
    spine.namedMembers = context.mentionedMembers.map((member) => ({
      code: `成员#${member.userId}`,
      role: member.role ?? '未注明',
    }))
  }
  if (charter) {
    spine.charter = {
      title: text(charter.title),
      scope: clip(text(charter.scope), 600),
      objectives: markedValue(charter.objectives),
      successCriteria: markedValue(charter.successCriteria),
    }
  }
  const decisions = aggregate[DECISIONS_KEY]
  if (Array.isArray(decisions) && decisions.length > 0) {
    // 已定的决定：后续调用不得推翻（如开工日、任务日期由程序排定、已剪掉的伪依赖）。
    spine.decisions = (decisions as ProjectDraftDecision[])
      .slice(-15)
      .map((item) => `${item.decision}（${item.reason.slice(0, 80)}）`)
  }
  if (understanding) {
    spine.understanding = {
      confirmedByUser: understanding.confirmedByUser,
      problemStatement: understanding.problemStatement,
      successPicture: understanding.successPicture,
      currentState: understanding.currentState,
      constraints: understanding.constraints,
      assumptions: understanding.assumptions.map((item) => item.statement),
      capabilities: understanding.capabilities.map((item) => `${item.id} ${item.name}`),
      // 用户在就绪页亲自回答的问题：与确认过的问答同等，是事实不是假设。
      ...(understanding.answeredQuestions?.length
        ? {
            userAnswers: understanding.answeredQuestions.map(
              (item) => `${item.question} → ${item.answer}`,
            ),
          }
        : {}),
    }
  }
  return spine
}

/** WBS 大纲：id / 编码 / 名称 / 是否叶节点，不含描述与 Marked 包装。 */
export function wbsOutline(aggregate: JsonObject): Array<[string, string, string, boolean]> {
  const out: Array<[string, string, string, boolean]> = []
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!isObject(node)) continue
      out.push([
        String(node.id),
        String(node.outlineCode ?? ''),
        text(node.name),
        node.isLeaf === true && node.isNote !== true,
      ])
      walk(node.children)
    }
  }
  walk(aggregate.wbs)
  return out
}

function wbsCodeById(aggregate: JsonObject): Map<string, string> {
  return new Map(wbsOutline(aggregate).map(([id, code]) => [id, code]))
}

function taskRole(task: JsonObject): string {
  const roles = markedValue(task.assigneeRoleIds)
  if (Array.isArray(roles) && roles.length > 0) return roles.join('+')
  return text(task.assigneeHint)
}

function taskOutputs(task: JsonObject): string {
  const execution = isObject(task.execution) ? task.execution : null
  if (execution && Array.isArray(execution.outputs) && execution.outputs.length > 0) {
    return execution.outputs.map(String).join('、')
  }
  return text(task.description)
}

/**
 * 任务索引：一行一条，「id|WBS编码|名称|工期d|角色|产出」。
 * 比完整任务对象小一个数量级（实测每条约 60–120 字 vs 800+ 字），用于排期、资源、跨分支核对。
 */
export function taskIndex(
  aggregate: JsonObject,
  options: { outputs?: number; onlyIds?: ReadonlySet<string>; dates?: boolean } = {},
): string[] {
  const codes = wbsCodeById(aggregate)
  const tasks = (Array.isArray(aggregate.tasks) ? aggregate.tasks : []).filter(isObject)
  return tasks
    .filter((task) => !options.onlyIds || options.onlyIds.has(String(task.id)))
    .map((task) => {
      const parts = [
        String(task.id),
        codes.get(String(task.wbsNodeId)) ?? String(task.wbsNodeId),
        text(task.name),
        `${text(task.durationDays) || '?'}d`,
        taskRole(task) || '未定',
      ]
      if (options.dates) parts.push(`${text(task.startDate)}~${text(task.endDate)}`)
      if (options.outputs) parts.push(clip(taskOutputs(task), options.outputs))
      return parts.join('|')
    })
}

/** 已有依赖的紧凑表示：["前置","后继","类型",滞后]。 */
export function compactDependencies(
  aggregate: JsonObject,
): Array<[string, string, string, number]> {
  return (Array.isArray(aggregate.dependencies) ? aggregate.dependencies : [])
    .filter(isObject)
    .map((dep) => [
      String(dep.predecessorId),
      String(dep.successorId),
      String(dep.type ?? 'FS'),
      Number(markedValue(dep.lagDays)) || 0,
    ])
}

/** 记忆视图：按调用用途组装注入内容，并在超预算时逐级降级。 */
export interface MemoryView {
  payload: JsonObject
  usage: ProjectDraftContextUsage
}

export function memoryView(
  call: string,
  slices: Array<[name: string, build: (level: number) => unknown]>,
  budget = MEMORY_VIEW_CHAR_BUDGET,
): MemoryView {
  // level 0 = 完整；每升一级由各片段自行精简（如任务索引去掉产出摘要）。
  for (let level = 0; level <= 3; level++) {
    const payload: JsonObject = {}
    for (const [name, build] of slices) {
      const value = build(level)
      if (value !== undefined && value !== null) payload[name] = value
    }
    const size = JSON.stringify(payload).length
    if (size <= budget || level === 3) {
      return {
        payload,
        usage: {
          call: level > 0 ? `${call}@精简${level}` : call,
          inputChars: size,
          memorySlices: Object.keys(payload),
        },
      }
    }
  }
  throw new Error('MEMORY_VIEW_UNREACHABLE')
}

/** 决策库挂在 aggregate 上的键（结构校验会剥掉未知字段，不会进入最终草案）。 */
export const DECISIONS_KEY = '__decisions'

/**
 * 决策库（记忆系统的一部分）：生成过程中用户确认的与系统 / 模型做出的关键决定。
 * 注入每次调用的主干记忆，审查页也可见，保证后面的步骤不会悄悄推翻前面的决定。
 */
export class DecisionLog {
  readonly #entries: ProjectDraftDecision[] = []
  #target: JsonObject | null = null

  /** 挂到聚合产物上，buildSpine 读取同一份数组。 */
  attach(aggregate: JsonObject): void {
    this.#target = aggregate
    aggregate[DECISIONS_KEY] = this.#entries
  }

  add(
    decision: string,
    reason: string,
    source: ProjectDraftDecision['source'],
    stage: string,
  ): void {
    if (this.#entries.length >= 60) return
    this.#entries.push({ id: `dec-${this.#entries.length + 1}`, decision, reason, source, stage })
    if (this.#target) this.#target[DECISIONS_KEY] = this.#entries
  }

  list(): ProjectDraftDecision[] {
    return [...this.#entries]
  }
}

/** 记录每次调用的上下文用量（最多保留 200 条，供 meta.contextUsage 与排查）。 */
export class ContextUsageLog {
  readonly #entries: ProjectDraftContextUsage[] = []

  record(usage: ProjectDraftContextUsage, promptChars?: number): void {
    if (this.#entries.length >= 200) return
    this.#entries.push(
      promptChars === undefined
        ? usage
        : { ...usage, inputChars: Math.max(usage.inputChars, promptChars) },
    )
  }

  list(): ProjectDraftContextUsage[] {
    return [...this.#entries]
  }
}
