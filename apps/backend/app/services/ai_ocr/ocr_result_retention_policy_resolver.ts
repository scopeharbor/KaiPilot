/**
 * OcrResultRetentionPolicyResolver — OCR 保留策略解析器（v3-ocr-result-persistence-and-retention §4.1）
 *
 * 职责：
 * - 系统默认策略（硬编码，不可变边界）
 * - 组织级覆盖（organization_id, project_id=null）
 * - 项目级覆盖（organization_id, project_id=具体值）
 * - 策略哈希确定性计算
 * - 越界/无效覆盖拒绝
 *
 * 优先级：项目覆盖 > 组织覆盖 > 系统默认
 * 边界：1~3650 天，不可绕过
 */

import OcrRetentionPolicy from '#models/ocr_retention_policy'
import {
  type OcrRetentionPolicy as OcrRetentionPolicyDTO,
  type OcrRetentionPolicyUpdateRequest,
  type OcrRetentionSystemBounds,
  buildSystemDefaultCategoryPolicies,
  computeRetentionPolicyHash,
  findInvalidCategoryPolicies,
  mergeRetentionPolicyOverride,
  resolveSystemDefaultRetentionPolicy,
  OCR_RETENTION_SYSTEM_BOUNDS,
} from '@aiproj/types'

export class OcrResultRetentionPolicyResolver {
  readonly #bounds: OcrRetentionSystemBounds = OCR_RETENTION_SYSTEM_BOUNDS

  /** 解析策略：系统默认 → 组织覆盖 → 项目覆盖（层层叠加） */
  async resolve(organizationId: number, projectId: number | null): Promise<OcrRetentionPolicyDTO> {
    const systemDefault = resolveSystemDefaultRetentionPolicy({ organizationId, projectId })

    // 查组织级覆盖（project_id = null）
    const orgOverride = await OcrRetentionPolicy.query()
      .where('organization_id', organizationId)
      .whereNull('project_id')
      .first()

    // 查项目级覆盖（如果有 projectId）
    let projectOverride: OcrRetentionPolicy | null = null
    if (projectId !== null) {
      projectOverride = await OcrRetentionPolicy.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .first()
    }

    // 层层合并
    let categories = systemDefault.categories
    let source = systemDefault.source

    if (orgOverride) {
      categories = mergeRetentionPolicyOverride(categories, orgOverride.categoriesJson)
      source = 'organization'
    }
    if (projectOverride) {
      categories = mergeRetentionPolicyOverride(categories, projectOverride.categoriesJson)
      source = 'project'
    }

    return {
      source,
      organizationId,
      projectId,
      categories,
      bounds: this.#bounds,
      policyHash: computeRetentionPolicyHash({ organizationId, projectId, categories }),
    }
  }

  /** 解析系统默认策略（用于无覆盖时） */
  resolveSystemDefault(organizationId: number, projectId: number | null): OcrRetentionPolicyDTO {
    return resolveSystemDefaultRetentionPolicy({ organizationId, projectId })
  }

  /** 更新组织级或项目级策略覆盖 */
  async update(
    organizationId: number,
    projectId: number | null,
    update: OcrRetentionPolicyUpdateRequest,
    updatedBy: number | null,
  ): Promise<OcrRetentionPolicyDTO> {
    // 校验覆盖
    const invalid = findInvalidCategoryPolicies(
      update.categories.map((c) => ({
        ...c,
        retentionDays: c.retentionDays,
        actionAfterExpiry: c.actionAfterExpiry,
      })),
      this.#bounds,
    )
    if (invalid.length > 0) {
      const reasons = invalid.map((i) => `${i.category}: ${i.reason}`).join('; ')
      throw new Error(`无效的保留策略覆盖：${reasons}`)
    }

    // 合并系统默认以确保所有分类都有值
    const base = buildSystemDefaultCategoryPolicies()
    const merged = mergeRetentionPolicyOverride(base, update.categories)

    const policyHash = computeRetentionPolicyHash({ organizationId, projectId, categories: merged })

    // Upsert 逻辑
    let record = await OcrRetentionPolicy.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId ?? (null as any))
      .first()

    if (record) {
      record.categoriesJson = merged
      record.policyHash = policyHash
      record.source = projectId !== null ? 'project' : 'organization'
      record.updatedBy = updatedBy
      await record.save()
    } else {
      record = await OcrRetentionPolicy.create({
        organizationId,
        projectId: projectId ?? (null as any),
        categoriesJson: merged,
        policyHash,
        source: projectId !== null ? 'project' : 'organization',
        updatedBy,
      })
    }

    return this.toDTO(record)
  }

  /** 验证覆盖是否合法（不含副作用） */
  validateOverride(update: OcrRetentionPolicyUpdateRequest): string[] {
    const invalid = findInvalidCategoryPolicies(
      update.categories.map((c) => ({
        ...c,
        retentionDays: c.retentionDays,
        actionAfterExpiry: c.actionAfterExpiry,
      })),
      this.#bounds,
    )
    return invalid.map((i) => `${i.category}: ${i.reason}`)
  }

  /** Model → DTO */
  private toDTO(model: OcrRetentionPolicy): OcrRetentionPolicyDTO {
    return {
      source: model.source,
      organizationId: model.organizationId,
      projectId: model.projectId,
      categories: model.categoriesJson,
      bounds: this.#bounds,
      policyHash: model.policyHash,
    }
  }
}
