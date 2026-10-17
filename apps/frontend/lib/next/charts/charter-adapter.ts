/**
 * 项目章程数据适配器纯函数（v3-chart-gallery-tier2-org-contract-plans W1 · task 1.3）。
 *
 * 职责：
 * 1. 纯函数下沉解析后端 `ProjectCharterData | null`；
 * 2. 装配项目愿景、业务范围、目标列表、验收准则列表与商业论证等结构化卡组模型；
 * 3. 审批状态机（draft / pending_approval / approved / rejected）中性徽章映射；
 * 4. 缺口字段中性容错（「未填写」中性标签）；
 * 5. 项目未创建章程（data: null）安全空态降级（hasCharter: false / isEmpty: true）。
 */
import type { ProjectCharterData, ProjectCharterApprovalStatus } from '@/lib/api/charter'

export const CHARTER_NOT_SET_LABEL = '未填写'

export type CharterBadgeTone = 'neutral' | 'accent' | 'success' | 'subtle'

export interface CharterStatusBadge {
  status: ProjectCharterApprovalStatus
  label: string
  tone: CharterBadgeTone
  className: string
}

export const CHARTER_STATUS_MAP: Record<ProjectCharterApprovalStatus, CharterStatusBadge> = {
  draft: {
    status: 'draft',
    label: '草案',
    tone: 'neutral',
    className: 'bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)] border-[var(--nx-border-hairline)]',
  },
  pending_approval: {
    status: 'pending_approval',
    label: '待审批',
    tone: 'accent',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  approved: {
    status: 'approved',
    label: '已通过',
    tone: 'success',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  rejected: {
    status: 'rejected',
    label: '已驳回',
    tone: 'subtle',
    className: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  },
}

export interface CharterViewModel {
  hasCharter: boolean
  isEmpty: boolean
  id?: number
  title: string
  vision: string
  scope: string
  businessCase: string
  hasBusinessCase: boolean
  objectives: string[]
  hasObjectives: boolean
  successCriteria: string[]
  hasSuccessCriteria: boolean
  versionText: string
  dateSpan: string
  startDate: string
  endDate: string
  statusBadge: CharterStatusBadge
  approvedAtText: string | null
}

function normalizeStringList(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) {
    return val.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean)
      }
    } catch {
      return [val.trim()].filter(Boolean)
    }
  }
  return []
}

export function formatDateSpan(start?: string | null, end?: string | null): string {
  if (!start && !end) return '未设定工期'
  const s = start ? start.slice(0, 10) : '未设定'
  const e = end ? end.slice(0, 10) : '未设定'
  return `${s} ~ ${e}`
}

export function formatApprovedAt(approvedAt?: string | null): string | null {
  if (!approvedAt) return null
  return approvedAt.slice(0, 10)
}

export function buildCharterViewModel(
  data: ProjectCharterData | null | undefined,
): CharterViewModel {
  if (!data) {
    return {
      hasCharter: false,
      isEmpty: true,
      title: '',
      vision: '',
      scope: '',
      businessCase: '',
      hasBusinessCase: false,
      objectives: [],
      hasObjectives: false,
      successCriteria: [],
      hasSuccessCriteria: false,
      versionText: '',
      dateSpan: '未设定工期',
      startDate: '',
      endDate: '',
      statusBadge: CHARTER_STATUS_MAP.draft,
      approvedAtText: null,
    }
  }

  const objectives = normalizeStringList(data.objectives)
  const successCriteria = normalizeStringList(data.successCriteria)
  const businessCase = data.businessCase?.trim() || ''
  const vision = data.vision?.trim() || ''
  const scope = data.scope?.trim() || ''
  const status = data.approvalStatus || 'draft'
  const statusBadge = CHARTER_STATUS_MAP[status] ?? CHARTER_STATUS_MAP.draft

  return {
    hasCharter: true,
    isEmpty: false,
    id: data.id,
    title: data.title?.trim() || '未命名章程',
    vision: vision || CHARTER_NOT_SET_LABEL,
    scope: scope || CHARTER_NOT_SET_LABEL,
    businessCase: businessCase || CHARTER_NOT_SET_LABEL,
    hasBusinessCase: Boolean(businessCase),
    objectives,
    hasObjectives: objectives.length > 0,
    successCriteria,
    hasSuccessCriteria: successCriteria.length > 0,
    versionText: `v${data.version ?? 1}`,
    dateSpan: formatDateSpan(data.startDate, data.endDate),
    startDate: data.startDate ? data.startDate.slice(0, 10) : '',
    endDate: data.endDate ? data.endDate.slice(0, 10) : '',
    statusBadge,
    approvedAtText: formatApprovedAt(data.approvedAt),
  }
}
