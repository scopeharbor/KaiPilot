import { DIAGRAM_SPEC_VERSION, DIAGRAM_TYPES, isDiagramType } from '@aiproj/types'
import type { DiagramSpec } from '@aiproj/types'
import { ValidationException } from '#exceptions/api_exception'

const REQUIRED_FIELDS = ['version', 'type', 'title', 'data', 'metadata'] as const

function reject(message: string, details?: unknown): never {
  throw new ValidationException(message, { details })
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    reject(`${label} 必须是非空对象`)
  }
  return value as Record<string, unknown>
}

function validateRequiredFields(obj: Record<string, unknown>): void {
  for (const field of REQUIRED_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) {
      reject(`缺少必填字段: ${field}`)
    }
  }
}

function validateVersion(version: unknown): void {
  if (version !== DIAGRAM_SPEC_VERSION) {
    reject(`版本必须为 "${DIAGRAM_SPEC_VERSION}"，收到 "${version}"`)
  }
}

function validateType(type: unknown): void {
  if (typeof type !== 'string' || !isDiagramType(type)) {
    reject(`未知图表类型: "${type}"，V1 白名单: ${DIAGRAM_TYPES.join(', ')}`)
  }
}

function validateTitle(title: unknown): void {
  if (typeof title !== 'string' || title.trim().length === 0) {
    reject('title 必须是非空字符串')
  }
}

function validateMetadata(metadata: unknown): void {
  const meta = assertObject(metadata, 'metadata')
  if (typeof meta.generatedBy !== 'string') {
    reject('metadata.generatedBy 必须是字符串')
  }
  if (typeof meta.generatedAt !== 'string') {
    reject('metadata.generatedAt 必须是字符串')
  }
  if (typeof meta.sourceProjectId !== 'number') {
    reject('metadata.sourceProjectId 必须是数字')
  }

  if (meta.generatedBy === 'ai') {
    if (typeof meta.confidence !== 'number') {
      reject('AI 生成的 DiagramSpec 必须包含 metadata.confidence（数字 0..1）')
    }
    if (meta.confidence < 0 || meta.confidence > 1) {
      reject('metadata.confidence 必须在 0..1 范围内')
    }
    if (!Array.isArray(meta.assumptions)) {
      reject('AI 生成的 DiagramSpec 必须包含 metadata.assumptions（字符串数组）')
    }
    if (!Array.isArray(meta.missingInputs)) {
      reject('AI 生成的 DiagramSpec 必须包含 metadata.missingInputs（字符串数组）')
    }
  }
}

function validateWbsTreeData(data: Record<string, unknown>): void {
  if (!Array.isArray(data.nodes)) {
    reject('wbs_tree.data.nodes 必须是数组')
  }
  for (const [i, node] of (data.nodes as unknown[]).entries()) {
    const n = assertObject(node, `data.nodes[${i}]`)
    if (typeof n.id !== 'number') reject(`data.nodes[${i}].id 必须是数字`)
    if (typeof n.code !== 'string') reject(`data.nodes[${i}].code 必须是字符串`)
    if (typeof n.name !== 'string') reject(`data.nodes[${i}].name 必须是字符串`)
    if (n.parentId !== null && typeof n.parentId !== 'number') {
      reject(`data.nodes[${i}].parentId 必须是数字或 null`)
    }
    if (typeof n.isLeaf !== 'boolean') reject(`data.nodes[${i}].isLeaf 必须是布尔值`)
    if (typeof n.depth !== 'number') reject(`data.nodes[${i}].depth 必须是数字`)
  }
}

function validateGanttData(data: Record<string, unknown>): void {
  if (!Array.isArray(data.bars)) reject('gantt.data.bars 必须是数组')
  if (!Array.isArray(data.milestones)) reject('gantt.data.milestones 必须是数组')
  if (typeof data.timelineStart !== 'string') reject('gantt.data.timelineStart 必须是字符串')
  if (typeof data.timelineEnd !== 'string') reject('gantt.data.timelineEnd 必须是字符串')

  for (const [i, bar] of (data.bars as unknown[]).entries()) {
    const b = assertObject(bar, `data.bars[${i}]`)
    if (typeof b.taskId !== 'number') reject(`data.bars[${i}].taskId 必须是数字`)
    if (typeof b.name !== 'string') reject(`data.bars[${i}].name 必须是字符串`)
    if (typeof b.progress !== 'number') reject(`data.bars[${i}].progress 必须是数字`)
    if (typeof b.isCriticalPath !== 'boolean') reject(`data.bars[${i}].isCriticalPath 必须是布尔值`)
    if (!Array.isArray(b.dependencies)) reject(`data.bars[${i}].dependencies 必须是数组`)
  }
}

function validateDependencyGraphData(data: Record<string, unknown>): void {
  if (!Array.isArray(data.nodes)) reject('dependency_graph.data.nodes 必须是数组')
  if (!Array.isArray(data.edges)) reject('dependency_graph.data.edges 必须是数组')

  for (const [i, node] of (data.nodes as unknown[]).entries()) {
    const n = assertObject(node, `data.nodes[${i}]`)
    if (typeof n.taskId !== 'number') reject(`data.nodes[${i}].taskId 必须是数字`)
    if (typeof n.name !== 'string') reject(`data.nodes[${i}].name 必须是字符串`)
  }
  for (const [i, edge] of (data.edges as unknown[]).entries()) {
    const e = assertObject(edge, `data.edges[${i}]`)
    if (typeof e.fromTaskId !== 'number') reject(`data.edges[${i}].fromTaskId 必须是数字`)
    if (typeof e.toTaskId !== 'number') reject(`data.edges[${i}].toTaskId 必须是数字`)
  }
}

function validateCriticalPathData(data: Record<string, unknown>): void {
  if (!Array.isArray(data.nodes)) reject('critical_path.data.nodes 必须是数组')
  if (!Array.isArray(data.path)) reject('critical_path.data.path 必须是数组')

  for (const [i, node] of (data.nodes as unknown[]).entries()) {
    const n = assertObject(node, `data.nodes[${i}]`)
    if (typeof n.taskId !== 'number') reject(`data.nodes[${i}].taskId 必须是数字`)
    if (typeof n.name !== 'string') reject(`data.nodes[${i}].name 必须是字符串`)
    if (typeof n.totalFloat !== 'number') reject(`data.nodes[${i}].totalFloat 必须是数字`)
  }
  for (const [i, id] of (data.path as unknown[]).entries()) {
    if (typeof id !== 'number') reject(`data.path[${i}] 必须是数字`)
  }
}

function validateFishboneCauseNode(node: Record<string, unknown>, path: string): void {
  if (typeof node.id !== 'string' || node.id.trim().length === 0) {
    reject(`${path}.id 必须是非空字符串`)
  }
  if (typeof node.label !== 'string' || node.label.trim().length === 0) {
    reject(`${path}.label 必须是非空字符串`)
  }
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) reject(`${path}.children 必须是数组`)
    for (const [j, child] of (node.children as unknown[]).entries()) {
      assertObject(child, `${path}.children[${j}]`)
      validateFishboneCauseNode(child as Record<string, unknown>, `${path}.children[${j}]`)
    }
  }
}

function validateFishboneData(data: Record<string, unknown>): void {
  if (typeof data.effect !== 'string' || data.effect.trim().length === 0) {
    reject('fishbone.data.effect 必须是非空字符串')
  }
  if (!Array.isArray(data.categories)) reject('fishbone.data.categories 必须是数组')
  for (const [i, category] of (data.categories as unknown[]).entries()) {
    const c = assertObject(category, `data.categories[${i}]`)
    if (typeof c.key !== 'string' || c.key.trim().length === 0) {
      reject(`data.categories[${i}].key 必须是非空字符串`)
    }
    if (typeof c.label !== 'string' || c.label.trim().length === 0) {
      reject(`data.categories[${i}].label 必须是非空字符串`)
    }
    if (!Array.isArray(c.causes)) reject(`data.categories[${i}].causes 必须是数组`)
    for (const [j, cause] of (c.causes as unknown[]).entries()) {
      assertObject(cause, `data.categories[${i}].causes[${j}]`)
      validateFishboneCauseNode(
        cause as Record<string, unknown>,
        `data.categories[${i}].causes[${j}]`,
      )
    }
  }
}

function validateDataByType(type: string, data: unknown): void {
  const dataObj = assertObject(data, 'data')

  switch (type) {
    case 'wbs_tree':
      validateWbsTreeData(dataObj)
      break
    case 'gantt':
      validateGanttData(dataObj)
      break
    case 'dependency_graph':
      validateDependencyGraphData(dataObj)
      break
    case 'critical_path':
      validateCriticalPathData(dataObj)
      break
    case 'fishbone':
      validateFishboneData(dataObj)
      break
  }
}

/**
 * 校验未知输入是否为合法的 V1 DiagramSpec。
 * 通过则返回类型安全的 DiagramSpec；失败则抛出 ValidationException。
 */
export function validateDiagramSpec(input: unknown): DiagramSpec {
  const obj = assertObject(input, 'DiagramSpec')

  validateRequiredFields(obj)
  validateVersion(obj.version)
  validateType(obj.type)
  validateTitle(obj.title)
  validateMetadata(obj.metadata)
  validateDataByType(obj.type as string, obj.data)

  return input as DiagramSpec
}
