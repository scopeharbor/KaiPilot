/**
 * OcrPrivacyPolicyResolver — OCR 隐私策略解析器（v3-ocr-privacy-policy-controls §4.1）
 *
 * 职责：
 * - 系统默认策略（硬编码，不可变边界）
 * - 组织级覆盖（organization_id, project_id=null）
 * - 项目级覆盖（organization_id, project_id=具体值）
 * - 策略覆盖校验（不超越系统边界）
 * - 策略哈希确定性计算
 *
 * 优先级：项目覆盖 > 组织覆盖 > 系统默认
 */
import OcrPrivacyPolicyOverride from '#models/ocr_privacy_policy_override'
import {
  type OcrPrivacyPolicy,
  type OcrPrivacyPolicyOverrideRequest,
  resolveSystemDefaultCategoryRules,
  resolveSystemDefaultPrivacyPolicy,
  computePrivacyPolicyHash,
  validatePrivacyPolicyOverride,
  OCR_PRIVACY_SYSTEM_BOUNDS,
  type OcrPrivacySystemBounds,
} from '@aiproj/types'

export class OcrPrivacyPolicyResolver {
  readonly #bounds: OcrPrivacySystemBounds = OCR_PRIVACY_SYSTEM_BOUNDS

  /** 解析策略：系统默认 → 组织覆盖 → 项目覆盖（层层叠加） */
  async resolve(organizationId: number, projectId: number | null): Promise<OcrPrivacyPolicy> {
    const systemDefault = resolveSystemDefaultPrivacyPolicy({ organizationId, projectId })

    // 查组织级覆盖（projectId = null）
    const orgOverride = await OcrPrivacyPolicyOverride.query()
      .where('organization_id', organizationId)
      .whereNull('project_id')
      .where('status', 'active')
      .first()

    // 查项目级覆盖（如果有 projectId）
    let projectOverride: OcrPrivacyPolicyOverride | null = null
    if (projectId !== null) {
      projectOverride = await OcrPrivacyPolicyOverride.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('status', 'active')
        .first()
    }

    // 层层合并
    let categoryRules = systemDefault.categoryRules
    let allowedPurposes = systemDefault.allowedPurposes
    let globalOutputMode = systemDefault.globalOutputMode
    let source = systemDefault.source
    let version = systemDefault.version

    if (orgOverride) {
      const overrideReq = orgOverride.policyJson
      categoryRules = mergeCategoryRules(categoryRules, overrideReq)
      allowedPurposes = overrideReq.allowedPurposes
      globalOutputMode = overrideReq.globalOutputMode
      source = 'organization'
      version = orgOverride.version
    }

    if (projectOverride) {
      const overrideReq = projectOverride.policyJson
      categoryRules = mergeCategoryRules(categoryRules, overrideReq)
      allowedPurposes = overrideReq.allowedPurposes
      globalOutputMode = overrideReq.globalOutputMode
      source = 'project'
      version = projectOverride.version
    }

    return {
      source,
      organizationId,
      projectId,
      version,
      status: 'active',
      categoryRules,
      allowedPurposes,
      globalOutputMode,
      bounds: this.#bounds,
      policyHash: computePrivacyPolicyHash({
        organizationId,
        projectId,
        categoryRules,
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  /** 解析系统默认策略 */
  resolveSystemDefault(organizationId: number, projectId: number | null): OcrPrivacyPolicy {
    return resolveSystemDefaultPrivacyPolicy({ organizationId, projectId })
  }

  /** 更新组织级或项目级策略覆盖 */
  async update(
    organizationId: number,
    projectId: number | null,
    override: OcrPrivacyPolicyOverrideRequest,
    updatedBy: number | null,
  ): Promise<OcrPrivacyPolicy> {
    // 校验覆盖不超过系统边界
    const errors = validatePrivacyPolicyOverride(override, this.#bounds)
    if (errors.length > 0) {
      throw new Error(`无效的隐私策略覆盖：${errors.join('; ')}`)
    }

    // 合并系统默认以确保所有类别都有值
    const categoryRules = mergeCategoryRules(resolveSystemDefaultCategoryRules(), override)

    const policyHash = computePrivacyPolicyHash({
      organizationId,
      projectId,
      categoryRules,
    })

    // Upsert
    let record = await OcrPrivacyPolicyOverride.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId ?? (null as any))
      .where('status', 'active')
      .first()

    if (record) {
      record.policyJson = override
      record.policyHash = policyHash
      record.source = projectId !== null ? 'project' : 'organization'
      record.version = record.version + 1
      record.updatedBy = updatedBy
      await record.save()
    } else {
      record = await OcrPrivacyPolicyOverride.create({
        organizationId,
        projectId: projectId ?? (null as any),
        policyJson: override,
        version: 1,
        policyHash,
        source: projectId !== null ? 'project' : 'organization',
        status: 'active',
        updatedBy,
      })
    }

    return {
      source: projectId !== null ? 'project' : 'organization',
      organizationId,
      projectId,
      version: record.version,
      status: 'active' as const,
      categoryRules,
      allowedPurposes: override.allowedPurposes,
      globalOutputMode: override.globalOutputMode,
      bounds: this.#bounds,
      policyHash,
      createdAt: record.createdAt.toISO()!,
      updatedAt: record.updatedAt?.toISO() ?? new Date().toISOString(),
    }
  }

  /** 验证覆盖是否合法（不含副作用） */
  validateOverride(override: OcrPrivacyPolicyOverrideRequest): string[] {
    return validatePrivacyPolicyOverride(override, this.#bounds)
  }
}

/** 合并类别规则：用覆盖中的条目替换系统默认中的相同类别 */
function mergeCategoryRules(
  base: OcrPrivacyPolicy['categoryRules'],
  override: OcrPrivacyPolicyOverrideRequest,
): OcrPrivacyPolicy['categoryRules'] {
  const overrideMap = new Map(override.categoryRules.map((r) => [r.category, r]))

  return base.map((rule) => {
    const over = overrideMap.get(rule.category)
    if (!over) return rule
    return {
      category: rule.category,
      allowedPurposes: over.allowedPurposes,
      defaultOutputMode: over.defaultOutputMode,
      isHighSensitivity: rule.isHighSensitivity, // 不可从覆盖修改
    }
  })
}
