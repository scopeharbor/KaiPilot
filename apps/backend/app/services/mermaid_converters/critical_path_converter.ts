import type { CriticalPathData, MermaidExportResult } from '@aiproj/types'

function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/[[\]{}]/g, (c) => `#${c.charCodeAt(0)};`)
}

export function convertCriticalPathToMermaid(data: CriticalPathData): MermaidExportResult {
  const warnings: string[] = []
  const lines = ['graph LR']
  const pathSet = new Set(data.path)

  for (const node of data.nodes) {
    const isCritical = pathSet.has(node.taskId)
    const floatInfo = node.totalFloat > 0 ? ` (浮动${node.totalFloat}d)` : ''
    const label = `${escapeMermaidLabel(node.name)}${floatInfo}`
    if (isCritical) {
      lines.push(`  t${node.taskId}["${label}"]:::critical`)
    } else {
      lines.push(`  t${node.taskId}["${label}"]`)
    }
  }

  lines.push('')
  lines.push('  classDef critical fill:#f96,stroke:#333,stroke-width:2px')

  if (data.nodes.length > 50) {
    warnings.push('节点数较多（>50），Mermaid 渲染可能较慢')
  }

  return { mermaid: lines.join('\n'), warnings }
}
