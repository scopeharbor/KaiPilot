/**
 * ai-draft-generation / T037 —— 部分接受的服务端过滤与字段修改（design D6，tasks 6.3/6.4/6.5）。
 *
 * 纯函数、无副作用、不碰数据库：供 `ProjectDraftImportService` 在事务前重算，
 * 也便于单测直接断言。红线：服务端**必须**重新执行过滤/修改/校验，绝不信任前端过滤结果。
 *
 * 关键不变量：
 *   - WBS 选择保留父节点链（选中节点的所有祖先自动保留）；
 *   - 选中任务的 WBS 节点自动保留；
 *   - 指向未选中任务的悬空依赖被移除；
 *   - 过滤后无映射任务的可执行叶节点转为说明节点（isNote=true），以满足「叶节点必映射任务」完整性规则；
 *   - 字段修改把目标 Marked 字段来源改为 explicit（用户显式事实，needsConfirmation=false），从而降低 warning。
 */

import type {
  AiMarker,
  ProjectDraft,
  ProjectDraftModification,
  ProjectDraftSelection,
  ProjectDraftWbsNode,
} from '@aiproj/types'
import { flattenWbs } from './schema.ts'

/** 部分过滤的移除计数（进确认审计的选择摘要，仅计数不含正文）。 */
export interface DraftSelectionDropCounts {
  wbsNodes: number
  tasks: number
  dependencies: number
  acceptanceCriteria: number
  milestones: number
  riskHints: number
  /** 因无映射任务而被降级为说明节点的叶数。 */
  notedLeaves: number
}

export interface FilteredDraftResult {
  draft: ProjectDraft
  dropped: DraftSelectionDropCounts
}

function deepClone<T>(value: T): T {
  return structuredClone(value)
}

function isMarked(value: unknown): value is { value: unknown; marker: AiMarker } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in (value as Record<string, unknown>) &&
    'marker' in (value as Record<string, unknown>)
  )
}

function explicitMarker(): AiMarker {
  return { source: 'explicit', reason: '用户修改', confidence: 1, needsConfirmation: false }
}

/** 深度查找 WBS 节点（按临时 id）。 */
function findWbsNode(nodes: ProjectDraftWbsNode[], id: string): ProjectDraftWbsNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const hit = findWbsNode(node.children, id)
    if (hit) return hit
  }
  return null
}

function parseSegment(segment: string): { key: string; index: string | null } {
  const match = segment.match(/^([A-Za-z_]\w*)\[([^\]]+)\]$/)
  if (match) return { key: match[1], index: match[2] }
  return { key: segment, index: null }
}

function resolveCollectionItem(draft: ProjectDraft, collection: string, index: string): unknown {
  if (collection === 'wbs') return findWbsNode(draft.wbs, index)
  const arr = (draft as unknown as Record<string, unknown>)[collection]
  if (!Array.isArray(arr)) return undefined
  const byId = arr.find((el) => (el as { id?: string })?.id === index)
  if (byId) return byId
  if (/^\d+$/.test(index)) return arr[Number(index)]
  return undefined
}

/** 应用单条字段修改（Marked 字段改 value + explicit marker；普通字段直接赋值）。 */
function applyOne(draft: ProjectDraft, mod: ProjectDraftModification): boolean {
  const segments = mod.path.split('.')
  let holder: unknown = draft
  for (let i = 0; i < segments.length; i++) {
    const { key, index } = parseSegment(segments[i])
    const isLast = i === segments.length - 1
    if (index !== null) {
      // 集合定位：仅可能出现在非末段（如 tasks[t3].durationDays）。
      holder = resolveCollectionItem(i === 0 ? draft : (holder as ProjectDraft), key, index)
      if (holder === undefined || holder === null) return false
      continue
    }
    if (isLast) {
      const container = holder as Record<string, unknown>
      if (!(key in container)) return false
      const cur = container[key]
      if (isMarked(cur)) {
        container[key] = { value: mod.value, marker: explicitMarker() }
      } else {
        container[key] = mod.value
      }
      return true
    }
    holder = (holder as Record<string, unknown>)[key]
    if (holder === undefined || holder === null) return false
  }
  return false
}

/**
 * 应用字段级修改，返回新草案（深拷贝，不改动入参）。
 * 无法定位的路径静默跳过——服务端会在其后重新校验，非法结构会被 blocking 拦下。
 */
export function applyModifications(
  draft: ProjectDraft,
  modifications: ProjectDraftModification[] | undefined,
): ProjectDraft {
  if (!modifications || modifications.length === 0) return draft
  const next = deepClone(draft)
  for (const mod of modifications) {
    applyOne(next, mod)
  }
  return next
}

/** 从扁平集合重建 WBS 树（保序，parentId 指向被过滤掉的父则视为根）。 */
function rebuildTree(flat: ProjectDraftWbsNode[]): ProjectDraftWbsNode[] {
  const clones = flat.map((n) => ({ ...n, children: [] as ProjectDraftWbsNode[] }))
  const byId = new Map(clones.map((n) => [n.id, n]))
  const roots: ProjectDraftWbsNode[] = []
  for (const node of clones) {
    const parent = node.parentId ? byId.get(node.parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  // 重算 isLeaf（子集裁剪后可能变化）。
  for (const node of clones) node.isLeaf = node.children.length === 0
  return roots
}

/**
 * 按选择集过滤草案（mode='partial'）。保留父链、移除悬空依赖、降级无任务叶节点。
 */
export function filterDraftBySelection(
  draft: ProjectDraft,
  selection: ProjectDraftSelection,
): FilteredDraftResult {
  const source = deepClone(draft)
  const flat = flattenWbs(source.wbs)
  const byId = new Map(flat.map((n) => [n.id, n]))

  const keptTaskIds = new Set(selection.taskIds)
  const keptWbs = new Set<string>(selection.wbsNodeIds)
  // 选中任务的 WBS 节点必须保留。
  for (const t of source.tasks) {
    if (keptTaskIds.has(t.id)) keptWbs.add(t.wbsNodeId)
  }
  // 保留父链。
  for (const id of [...keptWbs]) {
    let cur = byId.get(id)
    while (cur && cur.parentId) {
      keptWbs.add(cur.parentId)
      cur = byId.get(cur.parentId)
    }
  }

  const keptFlat = flat.filter((n) => keptWbs.has(n.id))
  const tree = rebuildTree(keptFlat)

  // 任务：选中且其 WBS 节点保留。
  const tasks = source.tasks.filter((t) => keptTaskIds.has(t.id) && keptWbs.has(t.wbsNodeId))
  const finalTaskIds = new Set(tasks.map((t) => t.id))

  // 无映射任务的可执行叶节点降级为说明节点，保证完整性。
  const taskWbs = new Set(tasks.map((t) => t.wbsNodeId))
  let notedLeaves = 0
  const noteWalk = (nodes: ProjectDraftWbsNode[]) => {
    for (const node of nodes) {
      if (node.children.length) {
        noteWalk(node.children)
      } else if (!node.isNote && !taskWbs.has(node.id)) {
        node.isNote = true
        notedLeaves += 1
      }
    }
  }
  noteWalk(tree)

  // 依赖：两端任务都保留才留下。
  const dependencies = source.dependencies.filter(
    (d) => finalTaskIds.has(d.predecessorId) && finalTaskIds.has(d.successorId),
  )

  // 验收标准：选中且（无关联任务或关联任务保留）。
  const acceptanceCriteria = source.acceptanceCriteria.filter(
    (a) =>
      selection.acceptanceIds.includes(a.id) &&
      (a.linkedTaskId === null || finalTaskIds.has(a.linkedTaskId)),
  )

  // 里程碑：选中；关联任务过滤到保留集。
  const milestoneHints = source.milestoneHints
    .filter((m) => selection.milestoneIds.includes(m.id))
    .map((m) => ({ ...m, linkedTaskIds: m.linkedTaskIds.filter((id) => finalTaskIds.has(id)) }))

  const riskHints = source.riskHints.filter((h) => selection.riskHintIds.includes(h.id))

  const filtered: ProjectDraft = {
    ...source,
    wbs: tree,
    tasks,
    dependencies,
    acceptanceCriteria,
    milestoneHints,
    riskHints,
  }

  return {
    draft: filtered,
    dropped: {
      wbsNodes: flat.length - keptFlat.length,
      tasks: source.tasks.length - tasks.length,
      dependencies: source.dependencies.length - dependencies.length,
      acceptanceCriteria: source.acceptanceCriteria.length - acceptanceCriteria.length,
      milestones: source.milestoneHints.length - milestoneHints.length,
      riskHints: source.riskHints.length - riskHints.length,
      notedLeaves,
    },
  }
}
