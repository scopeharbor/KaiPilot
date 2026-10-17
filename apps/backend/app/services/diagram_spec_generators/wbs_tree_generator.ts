import type WbsNode from '#models/wbs_node'
import type { DiagramSpec, WbsTreeData, WbsTreeNode } from '@aiproj/types'
import { createHash } from 'node:crypto'

/**
 * 从 WBS 节点列表生成 wbs_tree DiagramSpec。
 * 保留 WBS 编码、父子边和实体引用。
 */
export function generateWbsTreeDiagramSpec(
  projectId: number,
  nodes: WbsNode[],
  title?: string,
): DiagramSpec {
  const treeNodes: WbsTreeNode[] = nodes.map((node) => ({
    id: node.id,
    code: node.code ?? '',
    name: node.name,
    parentId: node.parentId !== null ? Number(node.parentId) : null,
    isLeaf: node.isLeaf,
    depth: node.depth,
    entityRef: node.taskId
      ? { entityType: 'task' as const, entityId: Number(node.taskId) }
      : undefined,
  }))

  const data: WbsTreeData = { nodes: treeNodes }
  const sourceHash = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 128)

  return {
    version: '1.0',
    type: 'wbs_tree',
    title: title ?? 'WBS 树',
    data,
    metadata: {
      generatedBy: 'system',
      generatedAt: new Date().toISOString(),
      sourceProjectId: projectId,
      sourceDataHash: sourceHash,
      sourceDataTimestamp: new Date().toISOString(),
    },
    exports: {
      mermaid: { supported: true },
    },
  }
}
