import type { WbsTreeData, MermaidExportResult } from '@aiproj/types'

function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/[[\]{}]/g, (c) => `#${c.charCodeAt(0)};`)
}

export function convertWbsTreeToMermaid(data: WbsTreeData): MermaidExportResult {
  const warnings: string[] = []
  const lines = ['graph TD']

  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]))

  for (const node of data.nodes) {
    const nodeId = `n${node.id}`
    const label = `${escapeMermaidLabel(node.code)} ${escapeMermaidLabel(node.name)}`
    lines.push(`  ${nodeId}["${label}"]`)
  }

  for (const node of data.nodes) {
    if (node.parentId !== null && nodeMap.has(node.parentId)) {
      lines.push(`  n${node.parentId} --> n${node.id}`)
    }
  }

  if (data.nodes.length > 200) {
    warnings.push('节点数较多（>200），Mermaid 渲染可能较慢')
  }

  return { mermaid: lines.join('\n'), warnings }
}
