/**
 * v2-triz-decision-log-traceability —— 矛盾确认/驳回 ↔ 决策日志桥接（tasks 10.1–10.4）。
 *
 * 当用户 confirm 或 dismiss 一个矛盾时，自动创建对应的决策日志条目。
 * 桥接层确保矛盾的人工决策与决策日志数据一致。
 */
import type ProjectContradiction from '#models/project_contradiction'
import type TrizDecisionLogService from '#services/triz_decision/triz_decision_log_service'
import {
  type TrizDecisionSubjectRef,
  type TrizDecisionSourceRef,
  type TrizDecisionArtifactHash,
} from '@aiproj/types'

/**
 * ContradictionDecisionBridge —— 矛盾确认/驳回流程与决策日志的桥接。
 *
 * 在 contradiction controller 的 confirm/dismiss 流程中，
 * 调用本桥接层创建对应的决策日志。
 */
export class ContradictionDecisionBridge {
  constructor(private decisionLogService: TrizDecisionLogService) {}

  /**
   * 矛盾确认时创建采纳决策日志。
   */
  async createOnConfirm(
    contradiction: ProjectContradiction,
    userId: number,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    const subjectRefs: TrizDecisionSubjectRef[] = [
      {
        kind: 'contradiction',
        id: contradiction.key,
        version: contradiction.outputHash ?? contradiction.inputSignature,
        summaryLevel: 'high',
        visibility: 'public',
        title: contradiction.title,
      },
    ]

    const sourceRefs: TrizDecisionSourceRef[] = [
      {
        kind: 'contradiction',
        id: contradiction.key,
        hash: contradiction.inputSignature,
        summary: `矛盾快照: ${contradiction.title}`,
      },
    ]

    // 如果有 relatedChangeRequestId，额外添加为来源 ref
    if (contradiction.relatedChangeRequestId) {
      sourceRefs.push({
        kind: 'change_request',
        id: String(contradiction.relatedChangeRequestId),
        hash: String(contradiction.updatedAt?.toMillis() ?? Date.now()),
        summary: '关联变更请求',
      })
    }

    const artifactHashes: TrizDecisionArtifactHash[] = [
      {
        label: 'input',
        hash: contradiction.inputSignature,
        algorithm: 'sha256',
      },
    ]

    if (contradiction.outputHash) {
      artifactHashes.push({
        label: 'output',
        hash: contradiction.outputHash,
        algorithm: 'sha256',
      })
    }

    // 创建采纳决策日志
    await this.decisionLogService.create(organizationId, projectId, userId, {
      decisionType: 'adopt',
      subjectRefs,
      sourceRefs,
      artifactHashes,
      reasonSummary: `确认矛盾「${contradiction.title}」为有效项目矛盾`,
    })
  }

  /**
   * 矛盾驳回时创建驳回决策日志。
   */
  async createOnDismiss(
    contradiction: ProjectContradiction,
    reason: string,
    userId: number,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    const subjectRefs: TrizDecisionSubjectRef[] = [
      {
        kind: 'contradiction',
        id: contradiction.key,
        version: contradiction.outputHash ?? contradiction.inputSignature,
        summaryLevel: 'high',
        visibility: 'public',
        title: contradiction.title,
      },
    ]

    const artifactHashes: TrizDecisionArtifactHash[] = [
      {
        label: 'input',
        hash: contradiction.inputSignature,
        algorithm: 'sha256',
      },
    ]

    // 创建驳回决策日志
    await this.decisionLogService.create(organizationId, projectId, userId, {
      decisionType: 'reject',
      subjectRefs,
      sourceRefs: [],
      artifactHashes,
      reasonSummary: reason || `驳回矛盾「${contradiction.title}」`,
    })
  }
}
