import type { GanttData, MermaidExportResult } from '@aiproj/types'

function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/[[\]{}]/g, (c) => `#${c.charCodeAt(0)};`)
}

export function convertGanttToMermaid(data: GanttData): MermaidExportResult {
  const warnings: string[] = []
  const lines = ['gantt', '  title 项目甘特图', '  dateFormat YYYY-MM-DD', '']

  lines.push('  section 任务')
  for (const bar of data.bars) {
    const id = `t${bar.taskId}`
    const start = bar.startDate ?? '2026-01-01'
    const duration = bar.endDate
      ? `${Math.max(1, Math.round((new Date(bar.endDate).getTime() - new Date(start).getTime()) / 86400000))}d`
      : '1d'
    lines.push(`  ${escapeMermaidLabel(bar.name)} :${id}, ${start}, ${duration}`)
  }

  if (data.milestones.length > 0) {
    lines.push('')
    lines.push('  section 里程碑')
    for (const ms of data.milestones) {
      lines.push(`  ${escapeMermaidLabel(ms.name)} :milestone, m${ms.milestoneId}, ${ms.date}, 0d`)
    }
  }

  // Warnings for unsupported features
  const hasDependencies = data.bars.some((b) => b.dependencies.length > 0)
  if (hasDependencies) {
    warnings.push('Mermaid gantt 不支持任务间依赖线，依赖关系未在导出中体现')
  }

  const hasCriticalPath = data.bars.some((b) => b.isCriticalPath)
  if (hasCriticalPath) {
    warnings.push('Mermaid gantt 不支持关键路径样式标记')
  }

  const hasProgress = data.bars.some((b) => b.progress > 0 && b.progress < 100)
  if (hasProgress) {
    warnings.push('Mermaid gantt 对进度百分比的支持有限')
  }

  return { mermaid: lines.join('\n'), warnings }
}
