/**
 * 计划体检：从草案确定性推导银行 / PMO 评审计划时关注的指标。
 *
 * - 工作日历：法定节假日、调休、封网窗口，以及落在封网期的投产类任务；
 * - 产能：全部任务人天 vs 团队可用人天（按角色）；
 * - 进度置信区间：三点估算（PERT）+ 蒙特卡洛模拟，给出 P50 / P80 / P90 完工日与按期概率；
 * - 行业阶段门：必备阶段是否齐全（金融系统重构模板含 SIT、UAT、等保定级→整改→测评、投产演练、切换、稳定期）；
 * - 追溯链：交付物 → WBS → 任务 → 验收标准 → 里程碑。
 *
 * 全部是确定性计算（蒙特卡洛使用固定种子），同一草案得到同一结果，可写入 meta 并参与哈希。
 */

import type { ProjectDraftGroundingManifest, ProjectDraftPlanInsights } from '@aiproj/types'
import { formatIsoDate, isWorkingDay, parseIsoDate } from '#services/gantt_working_calendar'
import { buildDraftCalendar, isProductionChangeTask, type DraftCalendar } from './cn_calendar.ts'

type JsonObject = Record<string, unknown>

const DAY_MS = 86_400_000
const MONTE_CARLO_SAMPLES = 2000
const MONTE_CARLO_SEED = 20_260_924

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function markedValue(value: unknown): unknown {
  return isObject(value) ? value.value : undefined
}

function markedString(value: unknown): string {
  const inner = markedValue(value)
  return typeof inner === 'string' ? inner : ''
}

function parseDay(value: unknown): number | null {
  if (typeof value !== 'string') return null
  try {
    return parseIsoDate(value)
  } catch {
    return null
  }
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

function bigrams(value: string): Set<string> {
  const text = normalizeText(value).replace(/[^\p{Script=Han}a-z0-9]/gu, '')
  const out = new Set<string>()
  for (let index = 0; index < text.length - 1; index++) out.add(text.slice(index, index + 2))
  return out
}

/** 短语 a 的二元词在 b 中的覆盖率（a 为交付物 / 阶段名，b 为候选文本）。 */
function coverage(a: string, b: string): number {
  const left = bigrams(a)
  if (left.size === 0) return 0
  const right = bigrams(b)
  let hit = 0
  for (const gram of left) if (right.has(gram)) hit++
  return hit / left.size
}

// ---------------------------------------------------------------------------
// 工作日索引（按草案日历）
// ---------------------------------------------------------------------------

function workingDaysBetween(draftCalendar: DraftCalendar, from: number, to: number): number[] {
  const days: number[] = []
  for (let time = from; time <= to; time += DAY_MS) {
    if (isWorkingDay(draftCalendar.calendar, time)) days.push(time)
  }
  return days
}

interface WorkdayAxis {
  days: number[]
  indexOf(time: number): number
}

function workdayAxis(draftCalendar: DraftCalendar, from: number, horizonDays = 1500): WorkdayAxis {
  const days = workingDaysBetween(draftCalendar, from, from + horizonDays * DAY_MS)
  const lookup = new Map(days.map((day, index) => [day, index]))
  return {
    days,
    indexOf(time: number) {
      for (let probe = time; probe <= time + 30 * DAY_MS; probe += DAY_MS) {
        const found = lookup.get(probe)
        if (found !== undefined) return found
      }
      return 0
    },
  }
}

interface TaskSpan {
  id: string
  name: string
  roles: string[]
  start: number
  end: number
  /** 工作日工期（最可能值）。 */
  duration: number
  /** 同时投入人数（缺省 1）：人天 = duration × headcount。 */
  headcount: number
  optimistic: number
  pessimistic: number
  explicitEstimate: boolean
}

// 任务类别的默认不确定性（乐观系数、悲观系数），仅在模型未给三点估算时使用。
const UNCERTAINTY_RULES: Array<{ pattern: RegExp; optimistic: number; pessimistic: number }> = [
  {
    pattern: /联调|集成|迁移|割接|切换|切流|测评|等保|整改|性能|压测|信创|适配|对账|灰度|投产/u,
    optimistic: 0.85,
    pessimistic: 2.0,
  },
  { pattern: /开发|实现|编码|改造|重构|接口/u, optimistic: 0.8, pessimistic: 1.5 },
  { pattern: /文档|评审|培训|方案|设计|计划|会议|汇报|手册/u, optimistic: 0.9, pessimistic: 1.3 },
]

function taskSpans(draft: JsonObject, draftCalendar: DraftCalendar): TaskSpan[] {
  const tasks = (Array.isArray(draft.tasks) ? draft.tasks : []).filter(isObject)
  const spans: TaskSpan[] = []
  for (const task of tasks) {
    const start = parseDay(markedValue(task.startDate))
    const end = parseDay(markedValue(task.endDate))
    if (start === null || end === null || end < start) continue
    const name = markedString(task.name)
    const workdays = Math.max(1, workingDaysBetween(draftCalendar, start, end).length)
    const roleIds = markedValue(task.assigneeRoleIds)
    const roles = Array.isArray(roleIds)
      ? roleIds.filter((role): role is string => typeof role === 'string' && role.length > 0)
      : markedString(task.assigneeHint)
          .split(/[、,，/;；]+/u)
          .map((role) => role.trim())
          .filter(Boolean)
    const estimate = isObject(task.estimate) ? task.estimate : null
    const optimisticRaw = Number(estimate?.optimisticDays)
    const pessimisticRaw = Number(estimate?.pessimisticDays)
    const explicit =
      Number.isFinite(optimisticRaw) &&
      Number.isFinite(pessimisticRaw) &&
      optimisticRaw > 0 &&
      optimisticRaw <= workdays &&
      pessimisticRaw >= workdays
    const rule = UNCERTAINTY_RULES.find((item) => item.pattern.test(name))
    const headcountRaw = isObject(task.headcount) ? task.headcount.value : task.headcount
    const headcountNumber = Number(headcountRaw)
    spans.push({
      id: String(task.id),
      name,
      roles,
      start,
      end,
      duration: workdays,
      headcount:
        Number.isFinite(headcountNumber) && headcountNumber >= 1
          ? Math.min(50, Math.round(headcountNumber))
          : 1,
      optimistic: explicit ? optimisticRaw : Math.max(1, workdays * (rule?.optimistic ?? 0.85)),
      pessimistic: explicit ? pessimisticRaw : workdays * (rule?.pessimistic ?? 1.5),
      explicitEstimate: explicit,
    })
  }
  return spans
}

// ---------------------------------------------------------------------------
// 产能
// ---------------------------------------------------------------------------

function capacityInsights(
  draft: JsonObject,
  draftCalendar: DraftCalendar,
  spans: TaskSpan[],
): ProjectDraftPlanInsights['capacity'] {
  const charter = isObject(draft.charter) ? draft.charter : {}
  const startDate = markedString(charter.startDate) || null
  const endDate = markedString(charter.endDate) || null
  const start = parseDay(startDate)
  const end = parseDay(endDate)
  const workingDays =
    start !== null && end !== null && end >= start
      ? workingDaysBetween(draftCalendar, start, end).length
      : 0
  const hints = (Array.isArray(draft.resourceHints) ? draft.resourceHints : []).filter(isObject)
  const headcounts = new Map<string, number>()
  for (const hint of hints) {
    const role = markedString(hint.role)
    const headcount = Number(markedValue(hint.headcount))
    if (role && Number.isFinite(headcount) && headcount > 0) {
      headcounts.set(role, (headcounts.get(role) ?? 0) + headcount)
    }
  }
  const required = new Map<string, number>()
  for (const span of spans) {
    // 人天 = 工期 × 同时投入人数：多人协作任务不再按 1 人计，利用率才不会失真。
    for (const role of span.roles)
      required.set(role, (required.get(role) ?? 0) + span.duration * span.headcount)
  }
  const roles = [...new Set([...headcounts.keys(), ...required.keys()])]
  const byRole = roles
    .map((role) => {
      const headcount = headcounts.get(role) ?? 0
      const availablePersonDays = headcount * workingDays
      const requiredPersonDays = required.get(role) ?? 0
      return {
        role,
        headcount,
        availablePersonDays,
        requiredPersonDays,
        utilization:
          availablePersonDays > 0
            ? round(requiredPersonDays / availablePersonDays)
            : requiredPersonDays > 0
              ? 99
              : 0,
      }
    })
    .sort((a, b) => b.utilization - a.utilization)
  const availablePersonDays = byRole.reduce((sum, item) => sum + item.availablePersonDays, 0)
  const requiredPersonDays = byRole.reduce((sum, item) => sum + item.requiredPersonDays, 0)
  return {
    startDate,
    endDate,
    workingDays,
    availablePersonDays,
    requiredPersonDays,
    utilization: availablePersonDays > 0 ? round(requiredPersonDays / availablePersonDays) : 0,
    byRole,
  }
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// ---------------------------------------------------------------------------
// PERT 蒙特卡洛
// ---------------------------------------------------------------------------

/** mulberry32：固定种子的可复现伪随机数。 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12)
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Marsaglia–Tsang gamma 采样（shape ≥ 1；PERT 的 α、β 恒 ≥ 1）。 */
function gamma(shape: number, random: () => number): number {
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = gaussian(random)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = random()
    if (u < 1 - 0.0331 * x ** 4) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** PERT-Beta 分布采样：a=乐观、m=最可能、b=悲观。 */
function samplePert(a: number, m: number, b: number, random: () => number): number {
  if (b - a < 1e-9) return m
  const alpha = 1 + (4 * (m - a)) / (b - a)
  const beta = 1 + (4 * (b - m)) / (b - a)
  const x = gamma(alpha, random)
  const y = gamma(beta, random)
  return a + (x / (x + y)) * (b - a)
}

function scheduleConfidence(
  draft: JsonObject,
  draftCalendar: DraftCalendar,
  spans: TaskSpan[],
): ProjectDraftPlanInsights['scheduleConfidence'] {
  const charter = isObject(draft.charter) ? draft.charter : {}
  const deadline = markedString(charter.endDate) || null
  const empty = {
    method: 'pert_monte_carlo' as const,
    samples: 0,
    deterministicEndDate: null,
    p50EndDate: null,
    p80EndDate: null,
    p90EndDate: null,
    deadline,
    onTimeProbability: null,
    explicitEstimateRatio: 0,
  }
  if (spans.length === 0) return empty
  const axis = workdayAxis(draftCalendar, Math.min(...spans.map((span) => span.start)))
  const byId = new Map(spans.map((span) => [span.id, span]))
  const incoming = new Map<string, Array<{ from: string; type: string; lag: number }>>(
    spans.map((span) => [span.id, []]),
  )
  const successors = new Map<string, string[]>(spans.map((span) => [span.id, []]))
  const indegree = new Map<string, number>(spans.map((span) => [span.id, 0]))
  for (const dependency of (Array.isArray(draft.dependencies) ? draft.dependencies : []).filter(
    isObject,
  )) {
    const from = String(dependency.predecessorId)
    const to = String(dependency.successorId)
    if (!byId.has(from) || !byId.has(to) || from === to) continue
    incoming.get(to)!.push({
      from,
      type: String(dependency.type ?? 'FS'),
      lag: Math.round(Number(markedValue(dependency.lagDays)) || 0),
    })
    successors.get(from)!.push(to)
    indegree.set(to, indegree.get(to)! + 1)
  }
  const order: string[] = []
  const queue = spans.filter((span) => indegree.get(span.id) === 0).map((span) => span.id)
  const pending = new Map(indegree)
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of successors.get(id)!) {
      pending.set(next, pending.get(next)! - 1)
      if (pending.get(next) === 0) queue.push(next)
    }
  }
  if (order.length !== spans.length) return { ...empty, deadline }

  const release = new Map(spans.map((span) => [span.id, axis.indexOf(span.start)]))
  const random = seededRandom(MONTE_CARLO_SEED)
  const ends: number[] = []
  const start = new Map<string, number>()
  const finish = new Map<string, number>()
  for (let sample = 0; sample < MONTE_CARLO_SAMPLES; sample++) {
    let projectEnd = 0
    for (const id of order) {
      const span = byId.get(id)!
      const duration = Math.max(
        1,
        Math.ceil(samplePert(span.optimistic, span.duration, span.pessimistic, random) - 1e-9),
      )
      // 已平衡排期的开始日作为下限（近似保留资源约束），再叠加依赖推迟。
      let earliest = release.get(id)!
      for (const edge of incoming.get(id)!) {
        const predStart = start.get(edge.from)!
        const predEnd = finish.get(edge.from)!
        if (edge.type === 'SS') earliest = Math.max(earliest, predStart + edge.lag)
        else if (edge.type === 'FF')
          earliest = Math.max(earliest, predEnd + edge.lag - duration + 1)
        else if (edge.type === 'SF') {
          earliest = Math.max(earliest, predStart + edge.lag - duration + 1)
        } else earliest = Math.max(earliest, predEnd + 1 + edge.lag)
      }
      start.set(id, earliest)
      finish.set(id, earliest + duration - 1)
      projectEnd = Math.max(projectEnd, earliest + duration - 1)
    }
    ends.push(projectEnd)
  }
  ends.sort((a, b) => a - b)
  const percentile = (p: number) => {
    const index = Math.min(ends.length - 1, Math.ceil(p * ends.length) - 1)
    const day = axis.days[Math.min(ends[index], axis.days.length - 1)]
    return day === undefined ? null : formatIsoDate(day)
  }
  const deadlineDay = parseDay(deadline)
  const onTime =
    deadlineDay === null
      ? null
      : round(
          ends.filter((end) => (axis.days[end] ?? Number.POSITIVE_INFINITY) <= deadlineDay).length /
            ends.length,
        )
  return {
    method: 'pert_monte_carlo',
    samples: MONTE_CARLO_SAMPLES,
    deterministicEndDate: formatIsoDate(Math.max(...spans.map((span) => span.end))),
    p50EndDate: percentile(0.5),
    p80EndDate: percentile(0.8),
    p90EndDate: percentile(0.9),
    deadline,
    onTimeProbability: onTime,
    explicitEstimateRatio: round(
      spans.filter((span) => span.explicitEstimate).length / spans.length,
    ),
  }
}

// ---------------------------------------------------------------------------
// 行业阶段门
// ---------------------------------------------------------------------------

interface StageGateDefinition {
  key: string
  name: string
  pattern: RegExp
  /** 仅当原始描述 / 事实命中该条件时要求（如等保、信创、迁移）。 */
  when?: RegExp
}

const FINANCE_DOMAIN = /银行|支付|清算|金融|证券|保险|信贷|基金|核心系统|人行/u

const SOFTWARE_GATES: StageGateDefinition[] = [
  { key: 'initiation', name: '立项与启动', pattern: /立项|启动|章程|开工|kick/iu },
  { key: 'requirements', name: '需求分析与评审', pattern: /需求/u },
  {
    key: 'design',
    name: '架构与详细设计评审',
    pattern: /架构设计|概要设计|详细设计|设计评审|技术方案/u,
  },
  { key: 'build', name: '开发与单元测试', pattern: /开发|编码|实现|单元测试/u },
  { key: 'sit', name: 'SIT 系统集成测试', pattern: /sit|系统集成测试|集成测试|联调测试/iu },
  { key: 'uat', name: 'UAT 用户验收测试', pattern: /uat|用户验收|业务验收/iu },
  { key: 'cutover', name: '上线切换', pattern: /上线|投产|切换|割接|切流|发布/u },
  {
    key: 'hypercare',
    name: '上线后稳定期与运维移交',
    pattern: /稳定期|保障期|试运行|运维移交|移交运维|hypercare|平稳运行/iu,
  },
]

const FINANCE_GATES: StageGateDefinition[] = [
  ...SOFTWARE_GATES.slice(0, 6),
  {
    key: 'perf_security',
    name: '性能与安全测试',
    pattern: /性能测试|压测|压力测试|安全测试|渗透/u,
  },
  {
    key: 'mlps_grading',
    name: '等保定级与备案',
    pattern: /定级|备案/u,
    when: /等保|等级保护/u,
  },
  {
    key: 'mlps_rectify',
    name: '等保差距分析与整改',
    pattern: /差距分析|整改/u,
    when: /等保|等级保护/u,
  },
  {
    key: 'mlps_assessment',
    name: '等保测评',
    pattern: /等保测评|等级测评|测评/u,
    when: /等保|等级保护/u,
  },
  { key: 'xinchuang', name: '信创适配验证', pattern: /信创|国产化|适配/u, when: /信创|国产化/u },
  {
    key: 'migration',
    name: '数据迁移与核对',
    pattern: /数据迁移|迁移.*核对|数据核对|迁移验证|迁移演练/u,
    when: /迁移/u,
  },
  { key: 'rehearsal', name: '投产演练', pattern: /演练|预演|彩排/u },
  ...SOFTWARE_GATES.slice(6),
]

export function stageGateTemplate(signal: string): { name: string; gates: StageGateDefinition[] } {
  const finance = FINANCE_DOMAIN.test(signal)
  const gates = (finance ? FINANCE_GATES : SOFTWARE_GATES).filter(
    (gate) => !gate.when || gate.when.test(signal),
  )
  return { name: finance ? '金融系统重构' : '软件交付', gates }
}

function nodeTexts(draft: JsonObject): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = []
  const walk = (nodes: unknown) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!isObject(node)) continue
      out.push({ id: String(node.id), text: markedString(node.name) })
      walk(node.children)
    }
  }
  walk(draft.wbs)
  for (const task of (Array.isArray(draft.tasks) ? draft.tasks : []).filter(isObject)) {
    out.push({ id: String(task.id), text: markedString(task.name) })
  }
  return out
}

export function evaluateStageGates(
  draft: JsonObject,
  signal: string,
): ProjectDraftPlanInsights['stageGates'] {
  const template = stageGateTemplate(signal)
  const texts = nodeTexts(draft)
  const gates = template.gates.map((gate) => {
    const matched = texts.filter((item) => gate.pattern.test(item.text)).map((item) => item.id)
    return {
      key: gate.key,
      name: gate.name,
      present: matched.length > 0,
      matchedNodeIds: matched.slice(0, 10),
    }
  })
  return {
    template: template.name,
    gates,
    missing: gates.filter((gate) => !gate.present).map((gate) => gate.name),
  }
}

// ---------------------------------------------------------------------------
// 追溯链
// ---------------------------------------------------------------------------

const GOVERNANCE_TASK =
  /项目管理|周报|月报|例会|风险|质量保证|qa|沟通|汇报|启动会|pmo|监控|配置管理|计划|评审会|复盘/iu

interface WbsIndex {
  nodes: Map<string, { id: string; parentId: string | null; text: string }>
  leafTasks: Map<string, string[]>
}

function wbsIndex(draft: JsonObject): WbsIndex {
  const nodes = new Map<string, { id: string; parentId: string | null; text: string }>()
  const walk = (list: unknown, parentId: string | null) => {
    for (const node of Array.isArray(list) ? list : []) {
      if (!isObject(node)) continue
      const id = String(node.id)
      nodes.set(id, {
        id,
        parentId: typeof node.parentId === 'string' ? node.parentId : parentId,
        text: `${markedString(node.name)} ${markedString(node.description)}`,
      })
      walk(node.children, id)
    }
  }
  walk(draft.wbs, null)
  const leafTasks = new Map<string, string[]>()
  for (const task of (Array.isArray(draft.tasks) ? draft.tasks : []).filter(isObject)) {
    const key = String(task.wbsNodeId)
    leafTasks.set(key, [...(leafTasks.get(key) ?? []), String(task.id)])
  }
  return { nodes, leafTasks }
}

function descendantsOf(index: WbsIndex, rootId: string): Set<string> {
  const out = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const node of index.nodes.values()) {
      if (node.parentId && out.has(node.parentId) && !out.has(node.id)) {
        out.add(node.id)
        grew = true
      }
    }
  }
  return out
}

function deliverableFacts(manifest: ProjectDraftGroundingManifest | null | undefined): string[] {
  return (manifest?.facts ?? [])
    .filter((fact) => fact.category === 'deliverable')
    .map((fact) => fact.normalizedValue.trim())
    .filter((value) => value.length >= 2 && value.length <= 40)
}

interface WorkPackageRef {
  id: string
  deliverable: string
  wbsNodeId: string
}

/**
 * 拆解层（能力 → 工作包）声明的可验收交付物。任务经 task.trace.workPackageId 确定性溯源到
 * 工作包，再经工作包的 deliverable 追溯到交付物——不依赖 WBS / 任务文本与交付物同名。
 */
function workPackageRefs(draft: JsonObject): WorkPackageRef[] {
  const decomposition = isObject(draft.decomposition) ? draft.decomposition : {}
  return (Array.isArray(decomposition.workPackages) ? decomposition.workPackages : [])
    .filter(isObject)
    .map((pkg) => ({
      id: String(pkg.id ?? ''),
      deliverable: typeof pkg.deliverable === 'string' ? pkg.deliverable.trim() : '',
      wbsNodeId: typeof pkg.wbsNodeId === 'string' ? pkg.wbsNodeId : '',
    }))
    .filter((pkg) => pkg.id.length > 0)
}

function taskWorkPackageId(task: JsonObject): string | null {
  const trace = isObject(task.trace) ? task.trace : null
  const id = trace?.workPackageId
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** 交付物事实与候选文本的双向匹配（命名不完全一致时按二元词覆盖兜底）。 */
function deliverableMatches(fact: string, candidate: string): boolean {
  if (!candidate) return false
  const a = normalizeText(fact)
  const b = normalizeText(candidate)
  return (
    a.includes(b) ||
    b.includes(a) ||
    coverage(fact, candidate) >= 0.6 ||
    coverage(candidate, fact) >= 0.6
  )
}

export function evaluateTraceability(
  draft: JsonObject,
  manifest: ProjectDraftGroundingManifest | null | undefined,
): ProjectDraftPlanInsights['traceability'] {
  const index = wbsIndex(draft)
  const tasks = (Array.isArray(draft.tasks) ? draft.tasks : []).filter(isObject)
  const criteria = (Array.isArray(draft.acceptanceCriteria) ? draft.acceptanceCriteria : []).filter(
    isObject,
  )
  const milestones = (Array.isArray(draft.milestoneHints) ? draft.milestoneHints : []).filter(
    isObject,
  )
  const traced = new Set<string>()
  const packages = workPackageRefs(draft)
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]))
  const deliverables = deliverableFacts(manifest).map((deliverable) => {
    // 拆解层溯源：工作包声明的交付物与事实匹配时，其 WBS 节点与溯源任务都计入链条。
    const matchedPackages = packages.filter((pkg) =>
      deliverableMatches(deliverable, pkg.deliverable),
    )
    const matchedPackageIds = new Set(matchedPackages.map((pkg) => pkg.id))
    const wbsNodeIds = [
      ...new Set([
        ...[...index.nodes.values()]
          .filter(
            (node) =>
              normalizeText(node.text).includes(normalizeText(deliverable)) ||
              coverage(deliverable, node.text) >= 0.6,
          )
          .map((node) => node.id),
        ...matchedPackages.map((pkg) => pkg.wbsNodeId).filter(Boolean),
      ]),
    ]
    const taskIds = new Set<string>()
    for (const nodeId of wbsNodeIds) {
      for (const descendant of descendantsOf(index, nodeId)) {
        for (const taskId of index.leafTasks.get(descendant) ?? []) taskIds.add(taskId)
      }
    }
    for (const task of tasks) {
      const text = `${markedString(task.name)} ${markedString(task.description)}`
      if (
        normalizeText(text).includes(normalizeText(deliverable)) ||
        coverage(deliverable, markedString(task.name)) >= 0.7
      ) {
        taskIds.add(String(task.id))
        continue
      }
      const packageId = taskWorkPackageId(task)
      if (packageId && matchedPackageIds.has(packageId)) taskIds.add(String(task.id))
    }
    for (const id of taskIds) traced.add(id)
    const acceptanceIds = criteria
      .filter(
        (criterion) =>
          (typeof criterion.linkedTaskId === 'string' && taskIds.has(criterion.linkedTaskId)) ||
          coverage(deliverable, markedString(criterion.statement)) >= 0.6,
      )
      .map((criterion) => String(criterion.id))
    const milestoneIds = milestones
      .filter(
        (milestone) =>
          (Array.isArray(milestone.linkedTaskIds) &&
            milestone.linkedTaskIds.some((id) => taskIds.has(String(id)))) ||
          coverage(deliverable, markedString(milestone.name)) >= 0.6,
      )
      .map((milestone) => String(milestone.id))
    return {
      deliverable,
      wbsNodeIds,
      taskIds: [...taskIds],
      acceptanceIds,
      milestoneIds,
      complete:
        wbsNodeIds.length > 0 &&
        taskIds.size > 0 &&
        acceptanceIds.length > 0 &&
        milestoneIds.length > 0,
    }
  })
  // 交付物清单之外的任务：属于实现某个交付物的 WBS 一级分支即视为可追溯（分支本身是范围的一部分）。
  const rootOf = (nodeId: string): string => {
    let current = index.nodes.get(nodeId)
    while (current?.parentId && index.nodes.has(current.parentId)) {
      current = index.nodes.get(current.parentId)
    }
    return current?.id ?? nodeId
  }
  const tracedRoots = new Set(
    deliverables.flatMap((item) => item.wbsNodeIds.map((id) => rootOf(id))),
  )
  const untracedTaskIds = tasks
    .filter((task) => {
      const id = String(task.id)
      if (traced.has(id)) return false
      if (GOVERNANCE_TASK.test(markedString(task.name))) return false
      if (tracedRoots.has(rootOf(String(task.wbsNodeId)))) return false
      // 拆解层已声明该任务所属工作包的交付物：链是确定的，只是交付物不在用户显式清单里。
      const packageId = taskWorkPackageId(task)
      if (packageId && packageById.get(packageId)?.deliverable) return false
      return true
    })
    .map((task) => String(task.id))
  return {
    deliverables,
    untracedTaskIds,
    coverage:
      deliverables.length > 0
        ? round(deliverables.filter((item) => item.complete).length / deliverables.length)
        : 1,
  }
}

/**
 * 追溯链确定性补链：未关联任务的验收标准按文本相似度挂到最相关任务；
 * 未关联任务的里程碑挂到名称最相关的 WBS 分支中最晚完成的任务。只补空，不改模型已给的关联。
 */
export function autoLinkTraceability(draft: JsonObject): {
  changed: boolean
  acceptanceCriteria: unknown[]
  milestoneHints: unknown[]
} {
  const tasks = (Array.isArray(draft.tasks) ? draft.tasks : []).filter(isObject)
  const index = wbsIndex(draft)
  let changed = false
  const bestTask = (text: string, threshold: number): JsonObject | null => {
    let best: JsonObject | null = null
    let bestScore = threshold
    for (const task of tasks) {
      // 双向平均：长验收语句 vs 短任务名时，单向覆盖率会系统性偏低。
      const score =
        (coverage(text, `${markedString(task.name)} ${markedString(task.description)}`) +
          coverage(markedString(task.name), text)) /
        2
      if (score > bestScore) {
        best = task
        bestScore = score
      }
    }
    return best
  }
  const acceptanceCriteria = (
    Array.isArray(draft.acceptanceCriteria) ? draft.acceptanceCriteria : []
  ).map((criterion) => {
    if (!isObject(criterion) || typeof criterion.linkedTaskId === 'string') return criterion
    const match = bestTask(markedString(criterion.statement), 0.35)
    if (!match) return criterion
    changed = true
    return { ...criterion, linkedTaskId: String(match.id) }
  })
  const milestoneHints = (Array.isArray(draft.milestoneHints) ? draft.milestoneHints : []).map(
    (milestone) => {
      if (!isObject(milestone)) return milestone
      if (Array.isArray(milestone.linkedTaskIds) && milestone.linkedTaskIds.length > 0)
        return milestone
      const name = markedString(milestone.name)
      let bestNode: string | null = null
      let bestScore = 0.4
      for (const node of index.nodes.values()) {
        const score = coverage(name, node.text)
        if (score > bestScore) {
          bestNode = node.id
          bestScore = score
        }
      }
      let candidates: JsonObject[] = []
      if (bestNode) {
        const scope = descendantsOf(index, bestNode)
        candidates = tasks.filter((task) => scope.has(String(task.wbsNodeId)))
      } else {
        const direct = bestTask(name, 0.5)
        candidates = direct ? [direct] : []
      }
      if (candidates.length === 0) return milestone
      const last = candidates.reduce((latest, task) =>
        markedString(task.endDate) > markedString(latest.endDate) ? task : latest,
      )
      changed = true
      return { ...milestone, linkedTaskIds: [String(last.id)] }
    },
  )
  return { changed, acceptanceCriteria, milestoneHints }
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

export function computePlanInsights(args: {
  draft: JsonObject
  rawInput: string
  manifest?: ProjectDraftGroundingManifest | null
}): ProjectDraftPlanInsights {
  const { draft } = args
  const charter = isObject(draft.charter) ? draft.charter : {}
  const startDate = markedString(charter.startDate) || null
  const endDate = markedString(charter.endDate) || null
  const draftCalendar = buildDraftCalendar({ startDate, endDate, rawInput: args.rawInput })
  const spans = taskSpans(draft, draftCalendar)
  const start = parseDay(startDate)
  const end = parseDay(endDate)
  const inWindow = (date: string) => {
    const time = parseDay(date)
    return time !== null && (start === null || time >= start) && (end === null || time <= end)
  }
  const productionTasksInFreeze = spans
    .filter((span) => isProductionChangeTask(span.name))
    .filter((span) =>
      draftCalendar.freezeWindows.some((window) => {
        const from = parseDay(window.start)
        const to = parseDay(window.end)
        return from !== null && to !== null && span.start <= to && span.end >= from
      }),
    )
    .map((span) => span.id)
  const overlapsFreeze = (from: number | null, to: number | null) =>
    from !== null &&
    to !== null &&
    draftCalendar.freezeWindows.some((window) => {
      const windowStart = parseDay(window.start)
      const windowEnd = parseDay(window.end)
      return windowStart !== null && windowEnd !== null && from <= windowEnd && to >= windowStart
    })
  const governance = isObject(draft.governance) ? draft.governance : {}
  const releaseWindowsInFreeze = (
    Array.isArray(governance.releaseWindows) ? governance.releaseWindows : []
  )
    .filter(isObject)
    .filter((window) => overlapsFreeze(parseDay(window.startDate), parseDay(window.endDate)))
    .map((window) => String(window.name))
  const signal = [
    args.rawInput,
    markedString(charter.title),
    markedString(charter.scope),
    ...(args.manifest?.facts ?? []).map((fact) => fact.normalizedValue),
  ].join(' ')
  return {
    version: '1.0',
    workCalendar: {
      officialYears: draftCalendar.officialYears,
      estimatedYears: draftCalendar.estimatedYears,
      days: draftCalendar.entries
        .filter((entry) => inWindow(entry.date))
        .sort((a, b) => a.date.localeCompare(b.date)),
      changeFreezeWindows: draftCalendar.freezeWindows,
      productionTasksInFreeze,
      releaseWindowsInFreeze,
    },
    capacity: capacityInsights(draft, draftCalendar, spans),
    scheduleConfidence: scheduleConfidence(draft, draftCalendar, spans),
    stageGates: evaluateStageGates(draft, signal),
    traceability: evaluateTraceability(draft, args.manifest),
  }
}
