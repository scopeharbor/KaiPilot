import RiskMatrixConfig from '#models/risk_matrix_config'
import AuditService, { AuditEvent } from '#services/audit_service'
import { ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DEFAULT_MATRIX_ZONES } from '@aiproj/types'

export interface CreateMatrixConfigInput {
  probabilityLevels?: number
  impactLevels?: number
  zones?: Record<string, unknown>[]
  defaultBasis?: 'inherent' | 'residual'
  cellLimit?: number
}

/**
 * RiskMatrixConfigService — 默认矩阵配置、项目级更新、配置校验。
 *
 * 未配置项目使用 V1 5x5 默认配置回退（D6）。
 */
@inject()
export default class RiskMatrixConfigService {
  constructor(private audit: AuditService) {}

  /**
   * 获取项目矩阵配置，不存在时返回默认配置。
   */
  async get(organizationId: number, projectId: number): Promise<RiskMatrixConfig | null> {
    return RiskMatrixConfig.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
  }

  /**
   * 获取默认矩阵配置（V1 5x5 兼容）。
   */
  getDefaultConfig(): {
    probabilityLevels: number
    impactLevels: number
    zones: Record<string, unknown>[]
    defaultBasis: string
    cellLimit: number
  } {
    return {
      probabilityLevels: 5,
      impactLevels: 5,
      zones: DEFAULT_MATRIX_ZONES as unknown as Record<string, unknown>[],
      defaultBasis: 'inherent',
      cellLimit: 5,
    }
  }

  /**
   * 创建或更新项目矩阵配置。
   */
  async upsert(
    organizationId: number,
    projectId: number,
    input: CreateMatrixConfigInput,
    actorUserId: number,
  ): Promise<RiskMatrixConfig> {
    this.validateInput(input)

    const existing = await RiskMatrixConfig.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (existing) {
      existing.merge({
        ...(input.probabilityLevels !== undefined && {
          probabilityLevels: input.probabilityLevels,
        }),
        ...(input.impactLevels !== undefined && { impactLevels: input.impactLevels }),
        ...(input.zones !== undefined && { zones: input.zones }),
        ...(input.defaultBasis !== undefined && { defaultBasis: input.defaultBasis }),
        ...(input.cellLimit !== undefined && { cellLimit: input.cellLimit }),
        updatedBy: actorUserId,
      })
      await existing.save()
    } else {
      const config = await RiskMatrixConfig.create({
        organizationId,
        projectId,
        probabilityLevels: input.probabilityLevels ?? 5,
        impactLevels: input.impactLevels ?? 5,
        zones: (input.zones ?? DEFAULT_MATRIX_ZONES) as Record<string, unknown>[],
        defaultBasis: input.defaultBasis ?? 'inherent',
        cellLimit: input.cellLimit ?? 5,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        isActive: true,
      })
      await this.audit.log({
        event: AuditEvent.CONFIG_CHANGED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'risk_matrix_config',
        entityId: config.id,
        metadata: {
          action: 'created',
          config: {
            probabilityLevels: config.probabilityLevels,
            impactLevels: config.impactLevels,
          },
        },
      })
      return config
    }

    await this.audit.log({
      event: AuditEvent.CONFIG_CHANGED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk_matrix_config',
      entityId: existing.id,
      metadata: { action: 'updated' },
    })

    return existing
  }

  /**
   * 校验矩阵配置输入合法性。
   */
  private validateInput(input: CreateMatrixConfigInput): void {
    if (
      input.probabilityLevels !== undefined &&
      (input.probabilityLevels < 2 || input.probabilityLevels > 10)
    ) {
      throw new ValidationException('概率等级数必须在 2-10 之间')
    }
    if (input.impactLevels !== undefined && (input.impactLevels < 2 || input.impactLevels > 10)) {
      throw new ValidationException('影响等级数必须在 2-10 之间')
    }
    if (input.zones !== undefined) {
      if (!Array.isArray(input.zones) || input.zones.length === 0) {
        throw new ValidationException('分区定义不能为空')
      }
    }
    if (input.cellLimit !== undefined && input.cellLimit < 1) {
      throw new ValidationException('每格展示上限必须 >= 1')
    }
  }
}
