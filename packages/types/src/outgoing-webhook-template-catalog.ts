/**
 * v2-5-webhook-templates-and-stats -- 内置出站 webhook 模板目录（design D1）。
 *
 * 前后端共用来源：后端 catalog service 读取此列表，前端也用此列表做模板预览。
 * 模板 id 稳定不可变（追加新版本不改变已有 id）。
 * 模板 version 按 semver 升序。
 *
 * 每项模板只包含白名单事件和低敏 header 预设，不含 payload transform、
 * 可执行代码、secret 明文/密文、token、API key、auth header、prompt、模型输出。
 */
import type { OutgoingWebhookTemplateDto } from './outgoing-webhook-template.js'

export const BUILT_IN_WEBHOOK_TEMPLATES: readonly OutgoingWebhookTemplateDto[] = [
  {
    id: 'task-status-changed',
    version: '1.0.0',
    stability: 'stable',
    name: '任务状态变更通知',
    description:
      '当项目中的任务被创建、更新或完成时，向目标系统发送低敏通知。适合连接项目管理工具或群机器人。',
    eventTypes: ['task.created', 'task.updated', 'task.completed'],
    headerPresets: [{ name: 'X-Event-Source', value: 'aiproj-task' }],
    display: {
      icon: 'check-circle',
      category: 'task',
      recommendedUse: '与飞书/钉钉/Slack 群机器人对接，实时同步任务状态变更。',
      limitations: '仅发送低敏任务标题和项目名称，不包含任务描述、评论或附件。',
    },
  },
  {
    id: 'task-assigned',
    version: '1.0.0',
    stability: 'stable',
    name: '任务分配通知',
    description:
      '当有新任务分配给特定成员时（task.created/updated），发送低敏通知。适合与即时通讯工具对接实现任务分配提醒。',
    eventTypes: ['task.created', 'task.updated'],
    headerPresets: [{ name: 'X-Event-Source', value: 'aiproj-assignment' }],
    display: {
      icon: 'user-plus',
      category: 'task',
      recommendedUse: '连接 IM 机器人，实现任务分配即通知。',
      limitations: '无法定向到具体用户，只能发送到 webhook 目标地址。',
    },
  },
  {
    id: 'task-due-soon',
    version: '1.0.0',
    stability: 'stable',
    name: '任务到期提醒',
    description: '当任务接近截止日期时发送提醒通知。使用 task.updated 事件携带截止日期信息。',
    eventTypes: ['task.updated'],
    headerPresets: [{ name: 'X-Event-Source', value: 'aiproj-due' }],
    display: {
      icon: 'clock',
      category: 'task',
      recommendedUse: '与日历或提醒工具对接，自动发送即将到期的任务提醒。',
      limitations: '到期提醒逻辑由订阅系统的事件触发器控制，本模板仅选择事件类型。',
    },
  },
  {
    id: 'project-milestone',
    version: '1.0.0',
    stability: 'stable',
    name: '项目里程碑通知',
    description:
      '当项目更新时（project.updated）发送低敏通知。适合用于里程碑达成或项目关键状态变更的对外广播。',
    eventTypes: ['project.updated'],
    headerPresets: [{ name: 'X-Event-Source', value: 'aiproj-project' }],
    display: {
      icon: 'flag',
      category: 'project',
      recommendedUse: '连接管理面板或广播机器人，实时同步项目里程碑状态。',
      limitations: 'project.updated 事件触发频率取决于项目更新操作。',
    },
  },
  {
    id: 'risk-registered',
    version: '1.0.0',
    stability: 'stable',
    name: '风险登记通知',
    description: '当新的风险被登记时发送低敏通知。适合与风险管理看板或群机器人对接。',
    eventTypes: ['risk.created'],
    headerPresets: [{ name: 'X-Event-Source', value: 'aiproj-risk' }],
    display: {
      icon: 'alert-triangle',
      category: 'risk',
      recommendedUse: '连接风险监控面板，实时同步新登记的风险信息。',
      limitations: '仅发送风险标题和所属项目，不包含风险详情、影响分析或应对措施。',
    },
  },
  {
    id: 'full-event-feed',
    version: '1.0.0',
    stability: 'stable',
    name: '全事件推送',
    description:
      '订阅所有白名单事件类型，将全部低敏事件推送到目标系统。适合用于数据集成或镜像归档场景。',
    eventTypes: [
      'project.updated',
      'task.created',
      'task.updated',
      'task.completed',
      'risk.created',
    ],
    headerPresets: [{ name: 'X-Event-Source', value: 'aiproj-feed' }],
    display: {
      icon: 'radio',
      category: 'integration',
      recommendedUse: '连接数据管道或日志归档系统，实现完整的低敏事件流推送。',
      limitations: '推送频率取决于项目活动量，请确保目标系统具备相应的接收能力。',
    },
  },
  {
    id: 'delivery-test-fixture',
    version: '1.0.0',
    stability: 'internal',
    name: '投递测试夹具',
    description: '仅内部使用，用于验证 webhook 投递链路的连通性。不对外展示。',
    eventTypes: ['task.created'],
    headerPresets: [],
    display: {
      icon: 'flask',
      category: 'internal',
      recommendedUse: '仅用于开发测试和运维诊断。',
      limitations: 'internal 模板不对最终用户展示。',
    },
  },
] as const

/** 按 id 查找模板（大小写敏感）。 */
export function findBuiltInTemplate(templateId: string): OutgoingWebhookTemplateDto | undefined {
  return BUILT_IN_WEBHOOK_TEMPLATES.find((t) => t.id === templateId)
}

/** 按 id 和 version 查找模板。 */
export function findBuiltInTemplateByIdAndVersion(
  templateId: string,
  version: string,
): OutgoingWebhookTemplateDto | undefined {
  return BUILT_IN_WEBHOOK_TEMPLATES.find((t) => t.id === templateId && t.version === version)
}

/** 获取仅稳定（非 disabled/internal）模板列表。 */
export function getStableTemplates(): OutgoingWebhookTemplateDto[] {
  return BUILT_IN_WEBHOOK_TEMPLATES.filter((t) => t.stability === 'stable')
}

/** 获取兼容某组事件类型的模板（取交集非空）。 */
export function getCompatibleTemplates(
  eventTypes: readonly string[],
): OutgoingWebhookTemplateDto[] {
  return BUILT_IN_WEBHOOK_TEMPLATES.filter((t) => {
    if (t.stability === 'disabled') return false
    return t.eventTypes.some((et) => eventTypes.includes(et))
  })
}
