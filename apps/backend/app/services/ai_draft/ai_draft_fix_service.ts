// AI 同事全自动 —— 草案阻断项由模型修正。
//
// 用户在 AI 同事里明确选择「全自动（包括转为正式项目）」后，草案校验有阻断项时不再交还用户：
// 把阻断项（规则编号 / 说明 / 路径）与草案精简视图交给 AI 同事的模型，模型返回
// - 字段级修改（与审查页就地编辑同一形态 `{ path, value }`），只认白名单路径与合法值类型；
// - 结构性操作（新增 WBS 节点、新增 / 删除任务与依赖，删除里程碑与验收条目），只认草案里真有的 id，
//   删除任务时一并清理引用它的依赖、里程碑关联与验收关联。
// 只有字段修改时不落库（由调用方带着修改重新校验）；有结构性操作时由调用方落一个新的草案版本
// （仍只是草案，不写正式表）。最终都经 confirm 端点（服务端重算全部校验）才转正。
import type {
  AiMarker,
  DraftDependencyType,
  ProjectDraft,
  ProjectDraftModification,
  DraftValidationIssue,
} from '@aiproj/types'
import { extractJsonObject } from '#services/ai_colleague/action_planner_service'
import { resolveAdapter } from '#services/ai_m0/resolver'

/** 每轮最多采纳几条修改。 */
export const DRAFT_FIX_MAX_MODIFICATIONS = 60
/** 交给模型的任务上限（超出的按顺序截断，阻断项涉及的任务一定保留）。 */
const DRAFT_FIX_TASK_LIMIT = 300

/** 可修改的路径：章程字段，或集合里按 id 定位的条目字段（不能新增 / 删除条目）。 */
const MODIFIABLE_PATH =
  /^(?:charter\.[A-Za-z]\w*|(?:tasks|dependencies|wbs|milestoneHints|riskHints|acceptanceCriteria|resourceHints)\[[A-Za-z0-9_\-:.]+\]\.[A-Za-z]\w*)$/
/** 不允许改的字段（结构标识）。 */
const FROZEN_FIELDS = new Set(['id', 'children', 'outlineCode', 'isLeaf', 'isNote'])

/** 每轮最多采纳几条结构性操作。 */
export const DRAFT_FIX_MAX_OPERATIONS = 40

export type DraftFixOperation =
  | {
      op: 'add_wbs_node'
      /** 同一轮里给新节点起的临时引用名（add_task 的 wbsNodeId 可以用它）。 */
      ref?: string
      name: string
      /** 父节点 id（已有节点或同轮 ref）；null = 新的一级分支。 */
      parentId: string | null
      description?: string
    }
  | {
      op: 'add_task'
      /** 同一轮里给新任务起的临时引用名（add_dependency 可以用它指向新任务）。 */
      ref?: string
      name: string
      wbsNodeId: string
      startDate: string
      endDate: string
      durationDays?: number
      description?: string
      assigneeHint?: string
    }
  | { op: 'remove_task'; taskId: string }
  | {
      op: 'add_dependency'
      predecessorId: string
      successorId: string
      type?: DraftDependencyType
      lagDays?: number
    }
  | { op: 'remove_dependency'; dependencyId: string }
  | { op: 'remove_milestone'; milestoneId: string }
  | { op: 'remove_acceptance'; acceptanceId: string }

export interface DraftFixProposal {
  modifications: ProjectDraftModification[]
  operations: DraftFixOperation[]
  reasons: string[]
  model: string
}

type ModificationValue = ProjectDraftModification['value']

function isModificationValue(value: unknown): value is ModificationValue {
  if (typeof value === 'string') return value.length <= 2000
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every((item) => typeof item === 'string' && item.length <= 200)
  )
}

/** 模型返回 → 合法修改（防幻觉：白名单路径、结构字段冻结、值类型校验、去重取最后一条）。 */
export function normalizeDraftFixModifications(raw: unknown): ProjectDraftModification[] {
  const list = Array.isArray(raw) ? raw : []
  const byPath = new Map<string, ProjectDraftModification>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const { path, value } = item as { path?: unknown; value?: unknown }
    if (typeof path !== 'string' || !MODIFIABLE_PATH.test(path)) continue
    const field = path.slice(path.lastIndexOf('.') + 1)
    if (FROZEN_FIELDS.has(field)) continue
    if (!isModificationValue(value)) continue
    byPath.delete(path)
    byPath.set(path, { path, value })
  }
  return [...byPath.values()].slice(0, DRAFT_FIX_MAX_MODIFICATIONS)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DEPENDENCY_TYPES: readonly DraftDependencyType[] = ['FS', 'SS', 'FF', 'SF']

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''
const isoDate = (value: unknown): string | null => {
  const v = text(value, 10)
  return ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null
}

function collectWbsIds(nodes: ProjectDraft['wbs'], out = new Set<string>()): Set<string> {
  for (const node of nodes) {
    out.add(node.id)
    collectWbsIds(node.children ?? [], out)
  }
  return out
}

/**
 * 模型返回的结构性操作 → 合法操作（防幻觉：id 必须在草案里真有，或是同一轮 add_task 的 ref；
 * 新任务必须挂在已有 WBS 节点下、起止日合法；依赖两端不同且不重复）。
 */
export function normalizeDraftFixOperations(
  raw: unknown,
  draft: ProjectDraft,
): DraftFixOperation[] {
  const list = Array.isArray(raw) ? raw : []
  const taskIds = new Set(draft.tasks.map((task) => task.id))
  const dependencyIds = new Set((draft.dependencies ?? []).map((dep) => dep.id))
  const milestoneIds = new Set((draft.milestoneHints ?? []).map((item) => item.id))
  const acceptanceIds = new Set((draft.acceptanceCriteria ?? []).map((item) => item.id))
  const wbsIds = collectWbsIds(draft.wbs ?? [])
  const refs = new Set<string>()
  const wbsRefs = new Set<string>()
  const removedTasks = new Set<string>()
  const out: DraftFixOperation[] = []
  const known = (id: string) => (taskIds.has(id) && !removedTasks.has(id)) || refs.has(id)
  for (const item of list) {
    if (out.length >= DRAFT_FIX_MAX_OPERATIONS) break
    if (!item || typeof item !== 'object') continue
    const op = item as Record<string, unknown>
    switch (op.op) {
      case 'add_wbs_node': {
        const name = text(op.name, 200)
        const parentId =
          op.parentId === null || op.parentId === undefined ? null : text(op.parentId, 100)
        if (!name || (parentId !== null && !wbsIds.has(parentId) && !wbsRefs.has(parentId))) break
        const ref = text(op.ref, 50)
        if (ref && !wbsIds.has(ref)) wbsRefs.add(ref)
        out.push({
          op: 'add_wbs_node',
          ...(ref && !wbsIds.has(ref) ? { ref } : {}),
          name,
          parentId,
          ...(text(op.description, 1000) ? { description: text(op.description, 1000) } : {}),
        })
        break
      }
      case 'add_task': {
        const name = text(op.name, 200)
        const wbsNodeId = text(op.wbsNodeId, 100)
        const startDate = isoDate(op.startDate)
        const endDate = isoDate(op.endDate)
        if (
          !name ||
          (!wbsIds.has(wbsNodeId) && !wbsRefs.has(wbsNodeId)) ||
          !startDate ||
          !endDate ||
          endDate < startDate
        ) {
          break
        }
        const ref = text(op.ref, 50)
        if (ref && !taskIds.has(ref)) refs.add(ref)
        const durationDays =
          typeof op.durationDays === 'number' && op.durationDays > 0 && op.durationDays <= 3650
            ? Math.round(op.durationDays)
            : undefined
        out.push({
          op: 'add_task',
          ...(ref && !taskIds.has(ref) ? { ref } : {}),
          name,
          wbsNodeId,
          startDate,
          endDate,
          ...(durationDays ? { durationDays } : {}),
          ...(text(op.description, 1000) ? { description: text(op.description, 1000) } : {}),
          ...(text(op.assigneeHint, 100) ? { assigneeHint: text(op.assigneeHint, 100) } : {}),
        })
        break
      }
      case 'remove_task': {
        const taskId = text(op.taskId, 100)
        if (!taskIds.has(taskId) || removedTasks.has(taskId)) break
        removedTasks.add(taskId)
        out.push({ op: 'remove_task', taskId })
        break
      }
      case 'add_dependency': {
        const predecessorId = text(op.predecessorId, 100)
        const successorId = text(op.successorId, 100)
        if (!known(predecessorId) || !known(successorId) || predecessorId === successorId) break
        const type = DEPENDENCY_TYPES.includes(op.type as DraftDependencyType)
          ? (op.type as DraftDependencyType)
          : 'FS'
        const lagDays =
          typeof op.lagDays === 'number' && Number.isFinite(op.lagDays)
            ? Math.max(-365, Math.min(365, Math.round(op.lagDays)))
            : 0
        out.push({ op: 'add_dependency', predecessorId, successorId, type, lagDays })
        break
      }
      case 'remove_dependency': {
        const dependencyId = text(op.dependencyId, 100)
        if (dependencyIds.has(dependencyId)) out.push({ op: 'remove_dependency', dependencyId })
        break
      }
      case 'remove_milestone': {
        const milestoneId = text(op.milestoneId, 100)
        if (milestoneIds.has(milestoneId)) out.push({ op: 'remove_milestone', milestoneId })
        break
      }
      case 'remove_acceptance': {
        const acceptanceId = text(op.acceptanceId, 100)
        if (acceptanceIds.has(acceptanceId)) out.push({ op: 'remove_acceptance', acceptanceId })
        break
      }
      default:
        break
    }
  }
  return out
}

/** AI 同事全自动修正时新增的字段标记（推断来源，如实说明由谁补充）。 */
function autopilotMarker(): AiMarker {
  return {
    confidence: 0.7,
    source: 'inferred',
    reason: 'AI 同事全自动修正校验问题时补充',
    needsConfirmation: false,
  }
}

const daysBetween = (start: string, end: string) =>
  Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1)

function uniqueId(prefix: string, taken: Set<string>): string {
  let n = 1
  while (taken.has(`${prefix}${n}`)) n += 1
  const id = `${prefix}${n}`
  taken.add(id)
  return id
}

/** 应用结构性操作（深拷贝，不改入参）。删除任务时一并清理依赖、里程碑与验收里的引用。 */
export function applyDraftFixOperations(
  draft: ProjectDraft,
  operations: readonly DraftFixOperation[],
): ProjectDraft {
  if (operations.length === 0) return draft
  const next = structuredClone(draft)
  next.dependencies = next.dependencies ?? []
  next.milestoneHints = next.milestoneHints ?? []
  next.acceptanceCriteria = next.acceptanceCriteria ?? []
  const takenTaskIds = new Set(next.tasks.map((task) => task.id))
  const takenDepIds = new Set(next.dependencies.map((dep) => dep.id))
  const refToId = new Map<string, string>()
  const resolve = (id: string) => refToId.get(id) ?? id
  const wbsRefToId = new Map<string, string>()
  const takenWbsIds = collectWbsIds(next.wbs ?? [])
  const findWbs = (nodes: ProjectDraft['wbs'], id: string): ProjectDraft['wbs'][number] | null => {
    for (const node of nodes) {
      if (node.id === id) return node
      const hit = findWbs(node.children ?? [], id)
      if (hit) return hit
    }
    return null
  }
  const marked = <T>(value: T) => ({ value, marker: autopilotMarker() })
  for (const op of operations) {
    switch (op.op) {
      case 'add_wbs_node': {
        const parent = op.parentId
          ? findWbs(next.wbs, wbsRefToId.get(op.parentId) ?? op.parentId)
          : null
        if (op.parentId && !parent) break
        const siblings = parent ? (parent.children ??= []) : next.wbs
        const id = uniqueId('w-ai-', takenWbsIds)
        if (op.ref) wbsRefToId.set(op.ref, id)
        siblings.push({
          id,
          parentId: parent?.id ?? null,
          outlineCode: parent
            ? `${parent.outlineCode}.${siblings.length + 1}`
            : String(siblings.length + 1),
          isLeaf: true,
          isNote: false,
          children: [],
          name: marked(op.name),
          description: marked(op.description ?? ''),
        } as ProjectDraft['wbs'][number])
        if (parent) parent.isLeaf = false
        break
      }
      case 'add_task': {
        const id = uniqueId('t-ai-', takenTaskIds)
        if (op.ref) refToId.set(op.ref, id)
        next.tasks.push({
          id,
          wbsNodeId: wbsRefToId.get(op.wbsNodeId) ?? op.wbsNodeId,
          name: marked(op.name),
          description: marked(op.description ?? ''),
          status: 'not_started',
          durationDays: marked(op.durationDays ?? daysBetween(op.startDate, op.endDate)),
          startDate: marked(op.startDate),
          endDate: marked(op.endDate),
          assigneeHint: marked(op.assigneeHint ?? ''),
        })
        break
      }
      case 'remove_task': {
        next.tasks = next.tasks.filter((task) => task.id !== op.taskId)
        next.dependencies = next.dependencies.filter(
          (dep) => dep.predecessorId !== op.taskId && dep.successorId !== op.taskId,
        )
        for (const milestone of next.milestoneHints) {
          milestone.linkedTaskIds = (milestone.linkedTaskIds ?? []).filter((id) => id !== op.taskId)
        }
        for (const criterion of next.acceptanceCriteria) {
          if (criterion.linkedTaskId === op.taskId) criterion.linkedTaskId = null
        }
        if (next.ganttPreview?.criticalPathTaskIds) {
          next.ganttPreview.criticalPathTaskIds = next.ganttPreview.criticalPathTaskIds.filter(
            (id) => id !== op.taskId,
          )
        }
        break
      }
      case 'add_dependency': {
        const predecessorId = resolve(op.predecessorId)
        const successorId = resolve(op.successorId)
        const exists = (id: string) => next.tasks.some((task) => task.id === id)
        if (!exists(predecessorId) || !exists(successorId)) break
        if (
          next.dependencies.some(
            (dep) => dep.predecessorId === predecessorId && dep.successorId === successorId,
          )
        ) {
          break
        }
        next.dependencies.push({
          id: uniqueId('d-ai-', takenDepIds),
          predecessorId,
          successorId,
          type: op.type ?? 'FS',
          lagDays: { value: op.lagDays ?? 0, marker: autopilotMarker() },
        })
        break
      }
      case 'remove_dependency':
        next.dependencies = next.dependencies.filter((dep) => dep.id !== op.dependencyId)
        break
      case 'remove_milestone':
        next.milestoneHints = next.milestoneHints.filter((item) => item.id !== op.milestoneId)
        break
      case 'remove_acceptance':
        next.acceptanceCriteria = next.acceptanceCriteria.filter(
          (item) => item.id !== op.acceptanceId,
        )
        break
    }
  }
  return next
}

const plain = (field: unknown): unknown =>
  field && typeof field === 'object' && 'value' in (field as Record<string, unknown>)
    ? (field as { value: unknown }).value
    : field

function flattenWbs(nodes: ProjectDraft['wbs'], out: Array<Record<string, unknown>> = []) {
  for (const node of nodes) {
    out.push({ id: node.id, parentId: node.parentId, name: plain(node.name) })
    flattenWbs(node.children ?? [], out)
  }
  return out
}

/** 草案精简视图（只给模型判断与修改需要的字段，取 Marked 字段的值）。 */
export function compactDraftForFix(
  draft: ProjectDraft,
  issues: readonly DraftValidationIssue[],
): Record<string, unknown> {
  const mentioned = new Set(
    issues.flatMap((issue) => [...(issue.path ?? '').matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])),
  )
  const tasks = draft.tasks
    .filter((task, index) => index < DRAFT_FIX_TASK_LIMIT || mentioned.has(task.id))
    .map((task) => ({
      id: task.id,
      wbsNodeId: task.wbsNodeId,
      name: plain(task.name),
      startDate: plain(task.startDate),
      endDate: plain(task.endDate),
      durationDays: plain(task.durationDays),
      assigneeHint: plain(task.assigneeHint),
    }))
  return {
    charter: Object.fromEntries(
      Object.entries(draft.charter ?? {}).map(([key, field]) => [key, plain(field)]),
    ),
    wbs: flattenWbs(draft.wbs ?? []),
    tasks,
    dependencies: (draft.dependencies ?? []).map((dep) => ({
      id: dep.id,
      predecessorId: dep.predecessorId,
      successorId: dep.successorId,
      type: dep.type,
      lagDays: plain(dep.lagDays),
    })),
    milestoneHints: (draft.milestoneHints ?? []).map((item) => ({
      id: item.id,
      name: plain(item.name),
      targetDate: plain(item.targetDate),
      linkedTaskIds: item.linkedTaskIds,
    })),
    acceptanceCriteria: (draft.acceptanceCriteria ?? []).map((item) => ({
      id: item.id,
      statement: plain(item.statement),
      linkedTaskId: item.linkedTaskId,
    })),
  }
}

export const DRAFT_FIX_SYSTEM_PROMPT = [
  '你是项目管理平台「开项」的 AI 同事，当前处于【全自动模式】：用户已授权由你独立修正项目草案并转为正式项目，过程中不会再询问用户，你必须自己做出合理判断并把问题修好。',
  '输入里有草案未通过的校验阻断项（ruleId / message / path）和草案精简视图。请用最少的改动让这些阻断项消失，同时不引入新的问题（日期先后、依赖顺序、工期与起止日一致、里程碑日期落在关联任务范围内）。',
  '只输出一个 JSON 对象：{"modifications":[{"path":"…","value":…}],"operations":[…],"reasons":["一句话说明（简体中文）"]}。',
  'modifications 改已有字段：path 只能是 charter.<字段>，或 tasks[任务id].<字段> / dependencies[依赖id].<字段> / wbs[节点id].<字段> / milestoneHints[id].<字段> / acceptanceCriteria[id].<字段>（id 必须来自输入，不能改 id）。日期写 YYYY-MM-DD；durationDays、lagDays 写数字。',
  'operations 做结构调整（改字段解决不了时才用）：{"op":"add_wbs_node","ref":"phase1","name":"…","parentId":"已有WBS节点id、同轮ref 或 null"}、{"op":"add_task","ref":"new1","name":"…","wbsNodeId":"已有WBS节点id或同轮ref","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","durationDays":数字}、{"op":"remove_task","taskId":"…"}、{"op":"add_dependency","predecessorId":"任务id或ref","successorId":"任务id或ref","type":"FS","lagDays":0}、{"op":"remove_dependency","dependencyId":"…"}、{"op":"remove_milestone","milestoneId":"…"}、{"op":"remove_acceptance","acceptanceId":"…"}。删除任务会一并去掉引用它的依赖；依赖成环优先删除或改指向其中一条依赖。',
  '不要编造输入里没有的信息；不要解释，不要输出 JSON 以外的内容。',
].join('\n')

export interface ProposeDraftFixInput {
  organizationId: number
  userId: number
  draft: ProjectDraft
  blocking: readonly DraftValidationIssue[]
  /** 之前几轮已经尝试过的修改（让模型知道哪些没奏效）。 */
  previousModifications?: readonly ProjectDraftModification[]
  connectionId?: number | null
  modelId?: number | null
}

export default class AiDraftFixService {
  /** 测试可覆写。 */
  adapterResolver: typeof resolveAdapter = resolveAdapter

  /** 请模型针对阻断项提出字段修改与结构性操作；没有可用的真实模型时返回 null。 */
  async propose(input: ProposeDraftFixInput): Promise<DraftFixProposal | null> {
    const resolved = await this.adapterResolver({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? undefined,
      modelId: input.modelId ?? undefined,
      requiredCapabilities: ['chat'],
      recordContext: {
        organizationId: input.organizationId,
        userId: input.userId,
        capability: 'chat',
        surface: 'ai-colleague-draft-fix',
        workflowName: 'ai-colleague-draft-fix',
        source: 'user',
      },
    })
    if (resolved.source === 'mock' || resolved.unavailable) return null
    const generated = await resolved.gateway.generate({
      sentence: input.blocking[0]?.message ?? '修正草案',
      promptSet: {
        systemPrompt: DRAFT_FIX_SYSTEM_PROMPT,
        userPrompt: JSON.stringify({
          blocking: input.blocking.slice(0, 40).map((issue) => ({
            ruleId: issue.ruleId,
            message: issue.message,
            path: issue.path,
          })),
          previousModifications: (input.previousModifications ?? []).slice(-60),
          draft: compactDraftForFix(input.draft, input.blocking),
        }),
      },
      strategy: 'prompt',
      temperature: 0.1,
      promptName: 'ai_colleague.draft_fix',
      requestTimeoutMs: 180_000,
    })
    const parsed = extractJsonObject(generated.rawText)
    const reasons = (Array.isArray(parsed?.reasons) ? parsed.reasons : [])
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .map((item) => item.trim().slice(0, 200))
      .slice(0, 10)
    return {
      modifications: normalizeDraftFixModifications(parsed?.modifications),
      operations: normalizeDraftFixOperations(parsed?.operations, input.draft),
      reasons,
      model: `${resolved.provider}/${resolved.model}`,
    }
  }
}
