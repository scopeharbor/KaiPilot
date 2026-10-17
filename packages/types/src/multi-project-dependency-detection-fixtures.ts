// 多项目依赖检测大组织 fixture — v3-multi-project-dependency-detection §8.1
// 覆盖 1000 项目、2000 跨项目依赖边、项目内 task_dependencies 局部上下文。
// 纯数据数组，零运行时依赖，可在后端测试中直接引入。

export interface LargeOrgProject {
  id: number
  organizationId: number
  name: string
  status: string
  startDate: string | null
  endDate: string | null
}

export interface LargeOrgDepEdge {
  id: number
  providerProjectId: number
  providerEndpointType: string
  consumerProjectId: number
  consumerEndpointType: string
  type: string
  category: string
  status: string
  lagDays: number
  bufferDays: number
  riskLevel: string
  freshnessStatus: string
}

export interface LargeOrgTaskDep {
  predecessorTaskId: number
  successorTaskId: number
  projectId: number
  type: string
}

/**
 * Generate a large organization fixture programmatically.
 * Returns 1000 projects + 2000 cross-project dep edges + 5000 local task deps.
 */
export function generateLargeOrgFixture(organizationId: number): {
  projects: LargeOrgProject[]
  depEdges: LargeOrgDepEdge[]
  localTaskDeps: LargeOrgTaskDep[]
} {
  const projects: LargeOrgProject[] = []
  const depEdges: LargeOrgDepEdge[] = []
  const localTaskDeps: LargeOrgTaskDep[] = []

  const statuses = ['active', 'planning', 'completed', 'on_hold', 'archived']
  const endpointTypes = ['project', 'milestone', 'task']

  // 1000 projects
  for (let i = 1; i <= 1000; i++) {
    const startMonth = (i % 12) + 1
    projects.push({
      id: i,
      organizationId,
      name: `项目 ${String(i).padStart(4, '0')}`,
      status: statuses[i % statuses.length]!,
      startDate: `2026-${String(startMonth).padStart(2, '0')}-01`,
      endDate: `2026-${String((startMonth + 3) % 12 || 12).padStart(2, '0')}-28`,
    })
  }

  // 2000 cross-project dep edges
  for (let i = 1; i <= 2000; i++) {
    const providerId = ((i * 7) % 1000) + 1
    const consumerId = ((i * 13) % 1000) + 1
    depEdges.push({
      id: i,
      providerProjectId: providerId,
      providerEndpointType: endpointTypes[i % 3]!,
      consumerProjectId: consumerId !== providerId ? consumerId : (consumerId % 1000) + 1,
      consumerEndpointType: endpointTypes[(i + 1) % 3]!,
      type: ['fs', 'ss', 'ff', 'sf'][i % 4]!,
      category: ['deliverable', 'milestone', 'technical', 'resource', 'external'][i % 5]!,
      status: ['draft', 'active', 'at_risk', 'resolved'][i % 4]!,
      lagDays: i % 30,
      bufferDays: i % 14,
      riskLevel: ['critical', 'high', 'medium', 'low', 'none'][i % 5]!,
      freshnessStatus: ['fresh', 'stale'][i % 2]!,
    })
  }

  // 5000 local task deps (5 per project)
  for (let pId = 1; pId <= 1000; pId++) {
    for (let d = 0; d < 5; d++) {
      localTaskDeps.push({
        predecessorTaskId: pId * 10 + d,
        successorTaskId: pId * 10 + d + 1,
        projectId: pId,
        type: 'fs',
      })
    }
  }

  return { projects, depEdges, localTaskDeps }
}
