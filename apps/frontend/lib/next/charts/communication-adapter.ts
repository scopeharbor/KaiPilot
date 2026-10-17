/**
 * 沟通管理计划数据适配器纯函数（v3-chart-gallery-tier2-org-contract-plans W1 · task 1.4）。
 *
 * 职责：
 * 1. 纯函数下沉解析后端 `PaginatedCommunicationPlans` 信封；
 * 2. 建立沟通类型、频次、渠道规范中文映射字典；
 * 3. 装配沟通矩阵多维表格视图模型（受众 × 渠道 × 频次 × 负责人）；
 * 4. 提取顶部汇总度量指标卡（总项数、生效中项数、类型分布统计）；
 * 5. 处理无沟通计划记录时的安全空态回退（isEmpty: true）。
 */
import type {
  CommunicationChannel,
  CommunicationFrequency,
  CommunicationPlanItem,
  CommunicationType,
  PaginatedCommunicationPlans,
} from '@/lib/api/communication-plans'

export const COMMUNICATION_TYPE_LABELS: Record<CommunicationType, string> = {
  meeting: '会议',
  report: '周期报告',
  email: '电子邮件',
  instant_message: '即时通讯',
}

export const COMMUNICATION_FREQUENCY_LABELS: Record<CommunicationFrequency, string> = {
  daily: '每日',
  weekly: '每周',
  biweekly: '隔周',
  monthly: '每月',
  milestone_driven: '里程碑驱动',
  ad_hoc: '按需临时',
}

export const COMMUNICATION_CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  in_person: '现场面对面',
  video_conference: '视频会议',
  email: '电子邮件',
  wechat_work: '企业微信',
  feishu: '飞书',
  pdf_export: 'PDF汇出',
}

export interface CommunicationPlanRowViewModel {
  id: number
  name: string
  communicationType: CommunicationType
  typeLabel: string
  purpose: string
  frequency: CommunicationFrequency
  frequencyLabel: string
  channel: CommunicationChannel
  channelLabel: string
  audience: string
  deliverable: string
  reportTemplateKey: string | null
  hasReportTemplate: boolean
  isActive: boolean
  statusLabel: string
  ownerId: number
}

export interface CommunicationSummaryMetrics {
  totalCount: number
  activeCount: number
  inactiveCount: number
  meetingCount: number
  reportCount: number
  emailCount: number
  imCount: number
}

export interface CommunicationPlanViewModel {
  rows: CommunicationPlanRowViewModel[]
  metrics: CommunicationSummaryMetrics
  isEmpty: boolean
}

export function buildCommunicationPlanViewModel(
  envelope: PaginatedCommunicationPlans | null | undefined,
): CommunicationPlanViewModel {
  const items: CommunicationPlanItem[] = envelope?.data ?? []

  if (!items || items.length === 0) {
    return {
      rows: [],
      metrics: {
        totalCount: 0,
        activeCount: 0,
        inactiveCount: 0,
        meetingCount: 0,
        reportCount: 0,
        emailCount: 0,
        imCount: 0,
      },
      isEmpty: true,
    }
  }

  let activeCount = 0
  let meetingCount = 0
  let reportCount = 0
  let emailCount = 0
  let imCount = 0

  const rows: CommunicationPlanRowViewModel[] = items.map((item) => {
    if (item.isActive) {
      activeCount += 1
    }
    if (item.communicationType === 'meeting') meetingCount += 1
    else if (item.communicationType === 'report') reportCount += 1
    else if (item.communicationType === 'email') emailCount += 1
    else if (item.communicationType === 'instant_message') imCount += 1

    return {
      id: item.id,
      name: item.name || '未命名事项',
      communicationType: item.communicationType,
      typeLabel: COMMUNICATION_TYPE_LABELS[item.communicationType] ?? item.communicationType,
      purpose: item.purpose || '未填写目的',
      frequency: item.frequency,
      frequencyLabel: COMMUNICATION_FREQUENCY_LABELS[item.frequency] ?? item.frequency,
      channel: item.channel,
      channelLabel: COMMUNICATION_CHANNEL_LABELS[item.channel] ?? item.channel,
      audience: item.audience || '未指定受众',
      deliverable: item.deliverable?.trim() || '无',
      reportTemplateKey: item.reportTemplateKey,
      hasReportTemplate: Boolean(item.reportTemplateKey),
      isActive: Boolean(item.isActive),
      statusLabel: item.isActive ? '生效中' : '已停用',
      ownerId: item.ownerId,
    }
  })

  return {
    rows,
    metrics: {
      totalCount: rows.length,
      activeCount,
      inactiveCount: rows.length - activeCount,
      meetingCount,
      reportCount,
      emailCount,
      imCount,
    },
    isEmpty: rows.length === 0,
  }
}

export function filterCommunicationPlanRows(
  rows: CommunicationPlanRowViewModel[],
  typeFilter: string,
): CommunicationPlanRowViewModel[] {
  if (!typeFilter || typeFilter === 'all') {
    return rows
  }
  return rows.filter((r) => r.communicationType === typeFilter)
}
