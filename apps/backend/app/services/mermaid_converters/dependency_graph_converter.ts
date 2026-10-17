import type { DependencyGraphData, MermaidExportResult } from '@aiproj/types'

function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/[[\]{}]/g, (c) => `#${c.charCodeAt(0)};`)
}

export function convertDependencyGraphToMermaid(data: DependencyGraphData): MermaidExportResult {
  const warnings: string[] = []
  const lines = ['graph LR']

  for (const node of data.nodes) {
    lines.push(`  t${node.taskId}["${escapeMermaidLabel(node.name)}"]`)
  }

  for (const edge of data.edges) {
    const label = edge.type !== 'FS' ? ` ${edge.type}` : ''
    lines.push(`  t${edge.fromTaskId} -->|"${label.trim()}"| t${edge.toTaskId}`)
  }

  if (data.edges.length > 100) {
    warnings.push('边数较多（>100），Mermaid 渲染可能较慢')
  }

  return { mermaid: lines.join('\n'), warnings }
}
