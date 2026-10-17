/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 模板目录服务（design D1/D4/D5）。
 *
 * 读取静态内置模板目录（BUILT_IN_WEBHOOK_TEMPLATES），提供脱敏投影、
 * 白名单兼容校验、未知模板拒绝、feature-off 行为。
 *
 * 本 service 不依赖数据库、不发起 HTTP、不读写 subscription/ledger——只读 catalog。
 */
import { findBuiltInTemplate, getStableTemplates } from '@aiproj/types'
import type {
  OutgoingWebhookTemplateDto,
  OutgoingWebhookTemplatePrefillDto,
  OutgoingWebhookTemplateHeaderPreset,
} from '@aiproj/types'
import type { OutgoingWebhookEventType } from '@aiproj/types'

export class OutgoingWebhookTemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`模板不存在或不可用: ${templateId}`)
    this.name = 'OutgoingWebhookTemplateNotFoundError'
  }
}

export class OutgoingWebhookTemplateFeatureDisabledError extends Error {
  constructor() {
    super('出站 webhook 模板功能当前未启用')
    this.name = 'OutgoingWebhookTemplateFeatureDisabledError'
  }
}

/** feature-off 门控（design D5）：默认关闭。运行时读 env 避免启动缓存。 */
export function webhookTemplateWritesEnabled(): boolean {
  const raw = process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED
  if (raw === undefined) return false
  return raw === 'true' || raw === '1'
}

export default class OutgoingWebhookTemplateCatalogService {
  /**
   * 列出可用模板（仅 stable，design D1）。
   */
  list(): OutgoingWebhookTemplateDto[] {
    return getStableTemplates().map((t) => this.toRedactedDto(t))
  }

  /**
   * 获取单个模板详情。
   */
  get(templateId: string): OutgoingWebhookTemplateDto {
    const template = findBuiltInTemplate(templateId)
    if (!template || template.stability === 'disabled') {
      throw new OutgoingWebhookTemplateNotFoundError(templateId)
    }
    return this.toRedactedDto(template)
  }

  /**
   * 预填模板信息：返回模板的 name 建议和 eventTypes，供创建表单预填。
   * 不校验 feature-off（预填是只读操作）。
   */
  prefill(templateId: string): OutgoingWebhookTemplatePrefillDto {
    const template = this.get(templateId)
    return {
      templateId: template.id,
      templateVersion: template.version,
      templateName: template.name,
      suggestedName: `[${template.name}]`,
      suggestedEventTypes: template.eventTypes,
      headerPresets: template.headerPresets,
    }
  }

  /**
   * 校验模板兼容性：给定的事件类型集合是否与模板兼容。
   */
  validateCompatibility(
    templateId: string,
    eventTypes: readonly OutgoingWebhookEventType[],
  ): { compatible: boolean; intersection: OutgoingWebhookEventType[] } {
    const template = this.get(templateId)
    const intersection = template.eventTypes.filter((et) =>
      eventTypes.includes(et),
    ) as OutgoingWebhookEventType[]
    return {
      compatible: intersection.length > 0,
      intersection,
    }
  }

  /**
   * 脱敏 DTO：确保不包含敏感字段（design D4）。
   * 内置模板已保证不含敏感字段，此处做防御性拷贝。
   */
  private toRedactedDto(template: OutgoingWebhookTemplateDto): OutgoingWebhookTemplateDto {
    return {
      id: template.id,
      version: template.version,
      stability: template.stability,
      name: template.name,
      description: template.description,
      eventTypes: template.eventTypes,
      headerPresets: template.headerPresets.map((hp: OutgoingWebhookTemplateHeaderPreset) => ({
        name: hp.name,
        value: hp.value,
      })),
      display: {
        icon: template.display.icon,
        category: template.display.category,
        recommendedUse: template.display.recommendedUse,
        limitations: template.display.limitations,
      },
    }
  }
}
