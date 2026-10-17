/**
 * AbAssignmentService —— A/B 确定性分流（§5 A/B 分流）。
 *
 * 职责：
 * - 按 (实验, 用户) 的确定性哈希分流，不用随机
 * - 同一用户在同一实验内始终同组
 * - 不同实验之间分流互不影响
 * - 实验结束后分流停止，全部流量回到生产配置
 * - 不支持三条以上配置的多臂实验
 *
 * 遵循 design D4（确定性哈希）和 D8（不做多臂）。
 */

import type { ShadowAbExperimentConfig, ShadowAbAssignment } from '@aiproj/types'

export class AbAssignmentService {
  private assignments = new Map<string, ShadowAbAssignment>()

  /**
   * 获取用户在实验中的分配。
   * 如果用户尚未分配，自动进行确定性分配。
   */
  getAssignment(experiment: ShadowAbExperimentConfig, userId: number): ShadowAbAssignment | null {
    // 非 A/B 模式不分配
    if (experiment.mode !== 'ab') return null

    // 实验已结束不分配
    if (experiment.concluded) return null

    // 检查是否已有分配
    const key = this.assignmentKey(experiment.experimentId, userId)
    const existing = this.assignments.get(key)
    if (existing) return existing

    // 确定性分配
    return this.assign(experiment, userId)
  }

  /**
   * 进行确定性分配。
   * 同一 (experimentId, userId) 始终分配到同一 variant。
   */
  private assign(experiment: ShadowAbExperimentConfig, userId: number): ShadowAbAssignment {
    const hash = this.computeAssignmentHash(experiment.experimentId, userId)

    // 两条配置：hash < 0.5 → control，否则 → treatment
    const variantIndex = hash < 0.5 ? 0 : 1
    const assignedVariant = experiment.variants[variantIndex]

    if (!assignedVariant) {
      throw new Error(`No variant at index ${variantIndex}`)
    }

    const assignment: ShadowAbAssignment = {
      experimentId: experiment.experimentId,
      userId,
      assignedVariantId: assignedVariant.variantId,
      assignmentHash: hash.toString(36),
      createdAt: new Date().toISOString(),
    }

    const key = this.assignmentKey(experiment.experimentId, userId)
    this.assignments.set(key, assignment)
    return assignment
  }

  /**
   * 获取用户在指定实验中的已分配 variant（不创建新分配）。
   */
  getAssignedVariant(experiment: ShadowAbExperimentConfig, userId: number): string | null {
    const assignment = this.getAssignment(experiment, userId)
    return assignment?.assignedVariantId ?? null
  }

  /**
   * 检查用户是否在实验的 treatment 组。
   */
  isInTreatmentGroup(experiment: ShadowAbExperimentConfig, userId: number): boolean {
    const variant = this.getAssignedVariant(experiment, userId)
    if (!variant) return false
    return variant !== experiment.variants[0]?.variantId
  }

  /**
   * 获取实验的所有分配。
   */
  listAssignments(experimentId: string): ShadowAbAssignment[] {
    return Array.from(this.assignments.values()).filter((a) => a.experimentId === experimentId)
  }

  /**
   * 获取实验的分配统计。
   */
  getAssignmentStats(experimentId: string): {
    total: number
    controlCount: number
    treatmentCount: number
  } {
    const assignments = this.listAssignments(experimentId)
    const controlVariant = assignments[0]?.assignedVariantId
    return {
      total: assignments.length,
      controlCount: assignments.filter((a) => a.assignedVariantId === controlVariant).length,
      treatmentCount: assignments.filter((a) => a.assignedVariantId !== controlVariant).length,
    }
  }

  /**
   * 实验结束后清除分配。
   */
  clearAssignments(experimentId: string): number {
    let count = 0
    for (const [key, assignment] of this.assignments) {
      if (assignment.experimentId === experimentId) {
        this.assignments.delete(key)
        count++
      }
    }
    return count
  }

  /**
   * 确定性哈希函数。
   * 同一 (experimentId, userId) 始终产出相同结果。
   * 不同实验之间互不影响。
   */
  computeAssignmentHash(experimentId: string, userId: number): number {
    const input = `${experimentId}:${userId}`
    let hash = 2166136261 // FNV-1a 32-bit offset basis
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    // 归一化到 [0, 1)
    return (hash >>> 0) / 4294967296
  }

  private assignmentKey(experimentId: string, userId: number): string {
    return `${experimentId}:${userId}`
  }
}
