import type { DiagramSpec, MermaidExportResult } from '@aiproj/types'
import { ValidationException } from '#exceptions/api_exception'
import { convertWbsTreeToMermaid } from '#services/mermaid_converters/wbs_tree_converter'
import { convertGanttToMermaid } from '#services/mermaid_converters/gantt_converter'
import { convertDependencyGraphToMermaid } from '#services/mermaid_converters/dependency_graph_converter'
import { convertCriticalPathToMermaid } from '#services/mermaid_converters/critical_path_converter'

export default class MermaidExportService {
  export(spec: DiagramSpec): MermaidExportResult {
    // 拒绝 Mermaid 反解析（V1 只支持 DiagramSpec → Mermaid 单向导出）
    if (spec.exports?.mermaid?.supported === false) {
      throw new ValidationException('该图表类型不支持 Mermaid 导出', {
        details: { type: spec.type, supported: false },
      })
    }

    switch (spec.type) {
      case 'wbs_tree':
        return convertWbsTreeToMermaid(spec.data as import('@aiproj/types').WbsTreeData)
      case 'gantt':
        return convertGanttToMermaid(spec.data as import('@aiproj/types').GanttData)
      case 'dependency_graph':
        return convertDependencyGraphToMermaid(
          spec.data as import('@aiproj/types').DependencyGraphData,
        )
      case 'critical_path':
        return convertCriticalPathToMermaid(spec.data as import('@aiproj/types').CriticalPathData)
      default:
        throw new ValidationException(`不支持的图表类型: "${spec.type}"`, {
          details: { type: spec.type },
        })
    }
  }
}
