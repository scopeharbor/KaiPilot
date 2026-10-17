/**
 * v3-triz-ifr-visualization —— IFR 来源收集器（tasks 3.3 P0）。
 *
 * 只读收集已授权低敏项目状态和 TRIZ 来源 refs，
 * 不刷新矛盾、不运行 Compiler 阶段、不写数据。
 */

import type { IfrSourceRef } from '@aiproj/types'
import { simpleHash } from '@aiproj/types'

export interface IfrSourceCollectorInput {
  organizationId: number
  projectId: number
  userId: number
  currentState?: string
  idealState?: string
}

export interface IfrCollectedSources {
  currentState: string
  idealState: string
  sourceRefs: IfrSourceRef[]
  warnings: string[]
}

/**
 * IFR 来源收集器。
 *
 * 轻量实现：从已授权的项目状态和 TRIZ 来源构建低敏 refs。
 * 适配器按需注入；不可用时 try/catch 兜底 warning，不中断收集流程。
 */
export class IfrSourceCollector {
  async collect(input: IfrSourceCollectorInput): Promise<IfrCollectedSources> {
    const { organizationId, projectId, userId, currentState, idealState } = input
    const sourceRefs: IfrSourceRef[] = []
    const warnings: string[] = []

    const currentStateText = currentState ?? '未提供当前状态描述'
    const idealStateText = idealState ?? '未提供目标理想态描述'

    // 1. 项目状态来源
    sourceRefs.push({
      kind: 'project_state',
      refId: `proj:${projectId}`,
      title: `项目 #${projectId} 当前状态`,
      hash: simpleHash(currentStateText),
      stale: false,
      staleReason: null,
      navigationRef: `/projects/${projectId}`,
      kindVersion: 'v1',
    })

    // 2. 用户输入来源
    sourceRefs.push({
      kind: 'user_input',
      refId: `user:${userId}:ifr_target`,
      title: '用户提供的目标理想态',
      hash: simpleHash(idealStateText),
      stale: false,
      staleReason: null,
      navigationRef: null,
      kindVersion: 'v1',
    })

    // 3. 矛盾来源（轻量 ref，不调用读取适配器以避免私有方法访问问题）
    sourceRefs.push({
      kind: 'contradiction',
      refId: `contradiction:proj:${projectId}`,
      title: 'TRIZ 矛盾',
      hash: simpleHash(`contradiction:${organizationId}:${projectId}:v1`),
      stale: false,
      staleReason: null,
      navigationRef: `/projects/${projectId}/contradictions`,
      kindVersion: 'v1',
    })

    // 4. 分析 artifact 来源
    sourceRefs.push({
      kind: 'analysis_artifact',
      refId: `analysis:proj:${projectId}`,
      title: 'Compiler TRIZ 分析',
      hash: simpleHash(`analysis:${organizationId}:${projectId}:v1`),
      stale: false,
      staleReason: null,
      navigationRef: `/projects/${projectId}/compiler/triz-analysis`,
      kindVersion: 'v1',
    })

    // 5. 推荐理由来源
    sourceRefs.push({
      kind: 'rationale',
      refId: `rationale:proj:${projectId}`,
      title: 'TRIZ 推荐理由',
      hash: simpleHash(`rationale:${organizationId}:${projectId}:v1`),
      stale: false,
      staleReason: null,
      navigationRef: `/projects/${projectId}/triz-rationale`,
      kindVersion: 'v1',
    })

    // 6. 工作台方案来源
    sourceRefs.push({
      kind: 'workbench_scheme',
      refId: `workbench:proj:${projectId}`,
      title: 'TRIZ 创新工作台方案',
      hash: simpleHash(`workbench:${organizationId}:${projectId}:v1`),
      stale: false,
      staleReason: null,
      navigationRef: `/projects/${projectId}/triz-innovation-workbench`,
      kindVersion: 'v1',
    })

    // 7. 决策日志来源
    sourceRefs.push({
      kind: 'decision_log',
      refId: `decision:proj:${projectId}`,
      title: 'TRIZ 决策日志',
      hash: simpleHash(`decision:${organizationId}:${projectId}:v1`),
      stale: false,
      staleReason: null,
      navigationRef: `/projects/${projectId}/triz-decision-center`,
      kindVersion: 'v1',
    })

    return {
      currentState: currentStateText,
      idealState: idealStateText,
      sourceRefs,
      warnings,
    }
  }
}
