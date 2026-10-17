import ResourceLoadService from '#services/resource_load_service'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

export interface AiLoadSuggestion {
  type: 'overloaded' | 'idle' | 'rebalance'
  resourceId: number
  resourceName: string
  currentLoad: number
  suggestion: string
  targetResourceId?: number
  targetResourceName?: string
}

export interface AiLoadAnalysisResult {
  suggestions: AiLoadSuggestion[]
  generatedAt: string
  aiAvailable: boolean
}

@inject()
export default class ResourceAiAnalysisService {
  constructor(private loadService: ResourceLoadService) {}

  async analyze(organizationId: number, projectId: number): Promise<AiLoadAnalysisResult> {
    const today = DateTime.now().toISODate()!
    const weekLater = DateTime.now().plus({ days: 7 }).toISODate()!

    const loadResult = await this.loadService.load(
      organizationId,
      projectId,
      today,
      weekLater,
      'team',
    )

    if (!('resources' in loadResult)) {
      return { suggestions: [], generatedAt: new Date().toISOString(), aiAvailable: false }
    }

    const suggestions: AiLoadSuggestion[] = []

    for (const resource of loadResult.resources) {
      if (resource.overallUtilizationPercent > 100) {
        suggestions.push({
          type: 'overloaded',
          resourceId: resource.resourceId,
          resourceName: resource.resourceName,
          currentLoad: resource.overallUtilizationPercent,
          suggestion: `${resource.resourceName} 当前负载 ${resource.overallUtilizationPercent}%，建议将部分任务重新分配给其他资源`,
        })
      } else if (resource.overallUtilizationPercent === 0) {
        suggestions.push({
          type: 'idle',
          resourceId: resource.resourceId,
          resourceName: resource.resourceName,
          currentLoad: 0,
          suggestion: `${resource.resourceName} 当前无分配任务，可以承接新任务`,
        })
      }
    }

    if (loadResult.teamAverageUtilizationPercent > 90) {
      suggestions.unshift({
        type: 'rebalance',
        resourceId: 0,
        resourceName: '团队',
        currentLoad: loadResult.teamAverageUtilizationPercent,
        suggestion: `团队平均负载 ${loadResult.teamAverageUtilizationPercent}% 较高，建议检查是否有任务可以延后或重新分配`,
      })
    }

    return {
      suggestions,
      generatedAt: new Date().toISOString(),
      aiAvailable: true,
    }
  }
}
