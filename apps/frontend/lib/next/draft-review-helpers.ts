import type {
  AiMarker,
  AiMarkerSource,
  Marked,
  ProjectDraft,
  ProjectDraftTask,
  ProjectDraftWbsNode,
} from '@aiproj/types'
import { PROJECT_DRAFT_HIGH_IMPACT_FIELDS } from '@aiproj/types'

/**
 * 草案审查空间纯函数投影（v3-ui-next-draft-review-panel W1 / tasks 1.1）。
 *
 * 本模块只做确定性纯函数变换，零 DOM、零状态、零网络：
 * - WBS 树形结构重构（parentId 建树 + outlineCode 数值化递归排序）；
 * - 任务按 WBS 节点归属快速索引（Map 查询，供任务表与甘特区复用）；
 * - Marked<T> 包装字段的纯值/置信度提取与格式化；
 * - 工期与起止日期跨度格式化辅助。
 * 消费方（组件）必须只读使用这些投影，绝不反向写回草案（RL-01、RL-06）。
 */

// ---------------------------------------------------------------------------
// Marked<T> 提取
// ---------------------------------------------------------------------------

/** 提取 Marked<T> 包装的纯值（解包后为只读消费，禁止回写）。 */
export function extractMarkedValue<T>(marked: Marked<T>): T {
  return marked.value
}

/** 提取 Marked<T> 的置信度元数据（0..1）。 */
export function extractMarkedConfidence<T>(marked: Marked<T>): number {
  return marked.marker.confidence
}

/** 置信度百分比格式化（0.82 → '82%'；0.845 → '85%'）。 */
export function formatConfidence(confidence: number): string {
  const percent = Math.round(confidence * 100)
  return `${percent}%`
}

/** 判断任意值是否为 Marked<T> 包装（供遍历提取类纯函数复用）。 */
export function isMarkedValue(value: unknown): value is { value: unknown; marker: unknown } {
  return typeof value === 'object' && value !== null && 'value' in value && 'marker' in value
}

// ---------------------------------------------------------------------------
// 工期与日期格式化
// ---------------------------------------------------------------------------

/**
 * 工期天数格式化：整数原样（如 `10 天`），小数保留 1 位（如 `0.5 天`）。
 * 负数（超前滞后）原样呈现，供依赖滞后天数展示复用。
 */
export function formatDurationDays(days: number): string {
  const text = Number.isInteger(days) ? String(days) : days.toFixed(1)
  return `${text} 天`
}

/** ISO 日期串 → `YYYY-MM-DD` 展示形态；非法/空串返回占位 '—'（中性，不抛错）。 */
export function formatISODate(iso: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(iso)
  return match !== null ? (match[0] as string) : '—'
}

/** 起止日跨度格式化（同日起止显示单日，否则 `A 至 B`）；两端均为占位时返回 '—'。 */
export function formatDateSpan(startIso: string, endIso: string): string {
  const start = formatISODate(startIso)
  const end = formatISODate(endIso)
  if (start === '—' && end === '—') return '—'
  if (start === end) return start
  return `${start} 至 ${end}`
}

// ---------------------------------------------------------------------------
// WBS 树形结构重构
// ---------------------------------------------------------------------------

/**
 * 大纲编码数值化比较：按 `.` 分段逐段数值比较，保证 `1.10` 排在 `1.2` 之后；
 * 段文本非纯数字时回退字符串比较（稳定兜底）。
 */
export function compareOutlineCodes(a: string, b: string): number {
  const segA = a.split('.')
  const segB = b.split('.')
  const len = Math.min(segA.length, segB.length)
  for (let i = 0; i < len; i++) {
    const x = segA[i] ?? ''
    const y = segB[i] ?? ''
    const numX = Number(x)
    const numY = Number(y)
    if (x !== '' && y !== '' && Number.isInteger(numX) && Number.isInteger(numY) && numX !== numY) {
      return numX - numY
    }
    if (x !== y) return x < y ? -1 : 1
  }
  return segA.length - segB.length
}

/**
 * WBS 树形结构重构：
 * - 以 `parentId` 为权威关系重建嵌套树（忽略输入可能携带的 `children`，防止重复嵌套）；
 * - `parentId` 指向不存在的节点时按根节点兜底展示（悬空引用不丢数据）；
 * - 同级按 `outlineCode` 数值化递归排序；
 * - 纯函数，输入不被修改（浅拷贝节点后挂载 children）。
 */
export function buildWbsTree(nodes: ProjectDraftWbsNode[]): ProjectDraftWbsNode[] {
  if (nodes.length === 0) return []

  const byId = new Map<string, ProjectDraftWbsNode>()
  for (const node of nodes) {
    byId.set(node.id, node)
  }

  const attach = (node: ProjectDraftWbsNode): ProjectDraftWbsNode => {
    const children = nodes
      .filter((candidate) => candidate.parentId === node.id)
      .map((child) => attach({ ...child, children: [] }))
    children.sort((a, b) => compareOutlineCodes(a.outlineCode, b.outlineCode))
    return { ...node, children }
  }

  const roots: ProjectDraftWbsNode[] = []
  for (const node of nodes) {
    const parent = node.parentId !== null ? byId.get(node.parentId) : undefined
    if (parent === undefined) {
      roots.push(attach(node))
    }
  }

  roots.sort((a, b) => compareOutlineCodes(a.outlineCode, b.outlineCode))
  return roots
}

/** 中序展平 WBS 树（含全部后代），供编码反查与默认展开集计算使用。 */
export function flattenWbsNodes(roots: ProjectDraftWbsNode[]): ProjectDraftWbsNode[] {
  const flat: ProjectDraftWbsNode[] = []
  const walk = (nodes: ProjectDraftWbsNode[]): void => {
    for (const node of nodes) {
      flat.push(node)
      walk(node.children)
    }
  }
  walk(roots)
  return flat
}

/** WBS 节点 ID → 大纲编码反查表（任务表展示所属 WBS 编码用）。 */
export function buildWbsNodeCodeMap(roots: ProjectDraftWbsNode[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of flattenWbsNodes(roots)) {
    map.set(node.id, node.outlineCode)
  }
  return map
}

/**
 * 默认展开集：展开前 `levels` 层节点（根为第 1 层，`levels=2` 即根与其直接子节点展开，
 * 第三层起默认收起）。返回节点 ID 集合，供 WBS 区初始展开状态使用。
 */
export function getDefaultExpandedNodeIds(roots: ProjectDraftWbsNode[], levels = 2): Set<string> {
  const expanded = new Set<string>()
  const walk = (nodes: ProjectDraftWbsNode[], depth: number): void => {
    for (const node of nodes) {
      if (depth < levels) {
        expanded.add(node.id)
      }
      walk(node.children, depth + 1)
    }
  }
  walk(roots, 0)
  return expanded
}

// ---------------------------------------------------------------------------
// 任务归属索引
// ---------------------------------------------------------------------------

/** 任务按所属 WBS 节点（`wbsNodeId`）的快速索引；未命中节点返回空组。 */
export function indexTasksByWbsNode(tasks: ProjectDraftTask[]): Map<string, ProjectDraftTask[]> {
  const index = new Map<string, ProjectDraftTask[]>()
  for (const task of tasks) {
    const bucket = index.get(task.wbsNodeId)
    if (bucket === undefined) {
      index.set(task.wbsNodeId, [task])
    } else {
      bucket.push(task)
    }
  }
  return index
}

/** 任务 ID → 任务反查表（甘特依赖关系解析前置/后置任务名用）。 */
export function buildTaskLookup(tasks: ProjectDraftTask[]): Map<string, ProjectDraftTask> {
  const lookup = new Map<string, ProjectDraftTask>()
  for (const task of tasks) {
    lookup.set(task.id, task)
  }
  return lookup
}

// ---------------------------------------------------------------------------
// AIMarker 待确认假设遍历提取（W2 / tasks 2.1）
// ---------------------------------------------------------------------------

/** 结构化可读的待确认假设条目（design D4 / DraftAssumptionItem）。 */
export interface DraftAssumptionItem {
  /** 稳定唯一键：即字段路径（如 `tasks[2].durationDays`）。 */
  id: string
  /** 字段点分/括号路径，与后端 schema 校验错误路径语义一致。 */
  path: string
  /** 人类可读业务名称（如「任务: 需求分析 - 预估工期」）。 */
  label: string
  /** 所属模块中文名（如「任务清单」）。 */
  moduleName: string
  /** 推断取值（已解包，不含 marker）。 */
  value: unknown
  /** 推断来源分类（inferred / explicit / default）。 */
  source: AiMarkerSource
  /** 推断置信度（0..1）。 */
  confidence: number
  /** AI 简体中文推断理由。 */
  reason: string
  /** 是否命中 PROJECT_DRAFT_HIGH_IMPACT_FIELDS 高影响字段清单。 */
  isHighImpact: boolean
}

/** 路径首段模块键 → 中文模块名（假设条目 moduleName 展示用）。 */
const ASSUMPTION_MODULE_LABELS: Readonly<Record<string, string>> = {
  charter: '项目章程',
  wbs: 'WBS 分解树',
  tasks: '任务清单',
  dependencies: '依赖关系',
  acceptanceCriteria: '验收标准',
  resourceHints: '资源建议',
  riskHints: '风险提示',
  milestoneHints: '里程碑计划',
  ganttPreview: '甘特预览',
}

/** 字段键 → 中文业务名（假设条目 label 组装用）。 */
const ASSUMPTION_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: '项目标题',
  vision: '愿景说明',
  scope: '业务范围',
  objectives: '阶段目标',
  successCriteria: '成功标准',
  startDate: '计划起始日',
  endDate: '计划结束日',
  name: '名称',
  description: '描述',
  durationDays: '预估工期',
  assigneeHint: '负责人建议',
  assigneeRoleIds: '建议角色',
  lagDays: '滞后天数',
  statement: '验收描述',
  role: '角色建议',
  headcount: '建议人数',
  allocationNote: '分配说明',
  level: '风险等级',
  mitigation: '缓解措施',
  targetDate: '目标日期',
  totalDurationDays: '总工期天数',
}

/** 高影响模板集合：路径索引归一化（`[2]` → `[]`）后与 PROJECT_DRAFT_HIGH_IMPACT_FIELDS 比对。 */
const HIGH_IMPACT_TEMPLATES: ReadonlySet<string> = new Set(PROJECT_DRAFT_HIGH_IMPACT_FIELDS)

/** 点分/括号路径 → 段数组（`tasks[2].durationDays` → ['tasks', '2', 'durationDays']）。 */
function parsePathSegments(path: string): string[] {
  return path.split(/[.[\]]+/).filter((segment) => segment.length > 0)
}

/** 解析数组下标段（非纯数字返回 -1）。 */
function parseArrayIndex(segment: string | undefined): number {
  if (segment === undefined) return -1
  return /^\d+$/.test(segment) ? Number(segment) : -1
}

/** 沿 `wbs[i].children[j]...` 索引链取最深层节点的 name 纯值（用于 label 上下文）。 */
function resolveWbsNodeName(draft: ProjectDraft, segments: string[]): string | null {
  let nodes = draft.wbs
  let name: string | null = null
  let cursor = 1
  while (cursor < segments.length - 1) {
    const node = nodes[parseArrayIndex(segments[cursor])]
    if (node === undefined) break
    if (node.name.value.length > 0) name = node.name.value
    cursor += 1
    if (segments[cursor] === 'children') cursor += 1
    nodes = node.children
  }
  return name
}

/** 路径 → 人类可读业务 label + 模块中文名（spec §AIMarker 待确认假设清单 第 1 条）。 */
function buildAssumptionLabel(
  draft: ProjectDraft,
  path: string,
): { label: string; moduleName: string } {
  const segments = parsePathSegments(path)
  const moduleKey = segments[0] ?? ''
  const moduleName = ASSUMPTION_MODULE_LABELS[moduleKey] ?? moduleKey
  const fieldKey = segments[segments.length - 1] ?? ''
  const fieldLabel = ASSUMPTION_FIELD_LABELS[fieldKey] ?? fieldKey

  if (moduleKey === 'tasks' && segments.length >= 3) {
    const index = parseArrayIndex(segments[1])
    const taskName = index >= 0 ? draft.tasks[index]?.name.value : undefined
    const entity =
      taskName !== undefined && taskName.length > 0 ? `任务: ${taskName}` : `任务 #${index + 1}`
    return { label: `${entity} - ${fieldLabel}`, moduleName }
  }

  if (moduleKey === 'wbs') {
    const nodeName = resolveWbsNodeName(draft, segments)
    return {
      label:
        nodeName !== null ? `WBS 节点: ${nodeName} - ${fieldLabel}` : `WBS 节点 - ${fieldLabel}`,
      moduleName,
    }
  }

  return { label: `${moduleName} - ${fieldLabel}`, moduleName }
}

function buildAssumptionItem(
  draft: ProjectDraft,
  path: string,
  marked: { value: unknown; marker: unknown },
): DraftAssumptionItem {
  const marker = marked.marker as AiMarker
  const { label, moduleName } = buildAssumptionLabel(draft, path)
  return {
    id: path,
    path,
    label,
    moduleName,
    value: marked.value,
    source: marker.source,
    confidence: marker.confidence,
    reason: marker.reason,
    isHighImpact: HIGH_IMPACT_TEMPLATES.has(path.replace(/\[\d+\]/g, '[]')),
  }
}

/**
 * 递归遍历 `ProjectDraft` 对象树，提取所有包装为 `Marked<T>` 且
 * `marker.needsConfirmation === true` 的推断字段（design D4 / tasks 2.1）。
 *
 * - 遍历顺序：对象键序（charter → wbs → tasks → …）、数组索引序，结果确定可复现；
 * - `Marked` 包装视为终端节点，不透传进其内部（value/marker 不再嵌套 Marked）；
 * - 高影响判定：路径索引归一化后比对 PROJECT_DRAFT_HIGH_IMPACT_FIELDS（工期/起止日/负责人/滞后天数/风险等级/里程碑日期）。
 */
export function extractDraftAssumptions(draft: ProjectDraft): DraftAssumptionItem[] {
  const items: DraftAssumptionItem[] = []

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return

    if (isMarkedValue(node)) {
      const marker = node.marker
      if (
        marker !== null &&
        typeof marker === 'object' &&
        (marker as AiMarker).needsConfirmation === true
      ) {
        items.push(buildAssumptionItem(draft, path, node))
      }
      return
    }

    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        walk(child, `${path}[${index}]`)
      })
      return
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, path.length > 0 ? `${path}.${key}` : key)
    }
  }

  walk(draft, '')
  return items
}
