/**
 * CopilotSessionRetentionPolicyResolver — 会话保留策略解析器（v3-copilot-session-retention §4.1）
 *
 * 职责：
 * - 组织级默认策略（organization_id, project_id=null）
 * - 项目级覆盖（organization_id, project_id=具体值）
 * - 策略哈希确定性计算
 * - 越界/无效覆盖拒绝
 *
 * 优先级：项目覆盖 > 组织覆盖
 * 边界：1~3650 天，不可绕过
 *
 * 与 OcrResultRetentionPolicyResolver 的关键差异：
 * - D4: 无系统默认——未配置时返回 configured=false, retentionDays=null
 * - 仅两层：组织级默认 + 项目级覆盖
 */

import CopilotSessionRetentionPolicyModel from '#models/copilot_session_retention_policy'
import {
  type CopilotSessionRetentionPolicy as CopilotSessionRetentionPolicyDTO,
  type CopilotSessionRetentionPolicyUpdateRequest,
  COPILOT_SESSION_RETENTION_SYSTEM_BOUNDS,
  computeCopilotSessionRetentionPolicyHash,
  isValidCopilotSessionRetentionDays,
} from '@aiproj/types'

/** 解析结果——通过 `configured` 区分已配置与未配置 */
export type ResolvedCopilotSessionRetentionPolicy =
  | {
      configured: false
      organizationId: number
      projectId: number | null
      retentionDays: null
    }
  | (CopilotSessionRetentionPolicyDTO & { configured: true })

export class CopilotSessionRetentionPolicyResolver {
  readonly #bounds = COPILOT_SESSION_RETENTION_SYSTEM_BOUNDS

  /**
   * 解析策略：项目覆盖 > 组织覆盖 > 未配置
   *
   * 未配置时不使用静默默认值（D4），返回 configured=false。
   */
  async resolve(
    organizationId: number,
    projectId: number | null,
  ): Promise<ResolvedCopilotSessionRetentionPolicy> {
    // 1. 项目级覆盖（最高优先级）
    if (projectId !== null) {
      const projectPolicy = await CopilotSessionRetentionPolicyModel.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .first()

      if (projectPolicy) {
        return { ...this.toDTO(projectPolicy), configured: true }
      }
    }

    // 2. 组织级默认
    const orgPolicy = await CopilotSessionRetentionPolicyModel.query()
      .where('organization_id', organizationId)
      .whereNull('project_id')
      .first()

    if (orgPolicy) {
      return { ...this.toDTO(orgPolicy), configured: true }
    }

    // 3. 未配置——D4: 无静默默认值
    return {
      configured: false,
      organizationId,
      projectId,
      retentionDays: null,
    }
  }

  /** 更新组织级或项目级策略覆盖 */
  async update(
    organizationId: number,
    projectId: number | null,
    update: CopilotSessionRetentionPolicyUpdateRequest,
    updatedBy: number | null,
  ): Promise<CopilotSessionRetentionPolicyDTO> {
    // 校验覆盖
    const validationErrors = this.validateOverride(update)
    if (validationErrors.length > 0) {
      throw new Error(`无效的保留策略覆盖：${validationErrors.join('; ')}`)
    }

    const source = projectId !== null ? 'project' : 'organization'
    const policyHash = computeCopilotSessionRetentionPolicyHash({
      scope: source,
      organizationId,
      projectId,
      retentionDays: update.retentionDays,
      enabled: update.enabled,
    })

    // Upsert 逻辑
    let record = await CopilotSessionRetentionPolicyModel.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId ?? (null as any))
      .first()

    if (record) {
      record.retentionDays = update.retentionDays
      record.enabled = update.enabled
      record.policyHash = policyHash
      record.source = source
      record.updatedBy = updatedBy
      await record.save()
    } else {
      record = await CopilotSessionRetentionPolicyModel.create({
        organizationId,
        projectId: projectId ?? (null as any),
        source,
        retentionDays: update.retentionDays,
        enabled: update.enabled,
        policyHash,
        updatedBy,
      })
    }

    return this.toDTO(record)
  }

  /** 验证覆盖是否合法（不含副作用） */
  validateOverride(update: CopilotSessionRetentionPolicyUpdateRequest): string[] {
    const errors: string[] = []

    if (!isValidCopilotSessionRetentionDays(update.retentionDays, this.#bounds)) {
      errors.push(`retentionDays: 必须在 ${this.#bounds.minDays}~${this.#bounds.maxDays} 天之间`)
    }

    return errors
  }

  /** Model → DTO */
  private toDTO(model: CopilotSessionRetentionPolicyModel): CopilotSessionRetentionPolicyDTO {
    return {
      scope: model.source,
      organizationId: model.organizationId,
      projectId: model.projectId,
      retentionDays: model.retentionDays,
      enabled: model.enabled,
      policyHash: model.policyHash,
      createdAt: model.createdAt?.toISO() ?? null,
      updatedAt: model.updatedAt?.toISO() ?? null,
    }
  }
}
