/**
 * 角色首页「AI 态势感知建议」卡的真实数据派生（纯函数层）。
 *
 * 取代 ROLE_HOME_CONFIGS 中写死的「待接入」占位：每个角色桶的 3 张卡保留原有
 * id/标题/描述（信息架构不变），metricLabel 改为从真实只读端点派生：
 * - 组织 Dashboard 摘要（fetchOrganizationDashboard：KPI/成员概览/风险提醒/待关注项目）；
 * - 审计统计（auditLogsApi.stats，近 7 日事件合计）；
 * - 我的任务跨项目聚合（tasksApi 按项目 fan-out，assigneeId=本人）。
 *
 * 诚实纪律（RL-07/RL-14）：加载中显示「…」、源不可用/错误显示「暂缺」、
 * 数值为 0 如实显示 0，绝不伪造占位文案。
 */
import type { OrganizationDashboardSummary } from '@aiproj/types'
import type { RoleBucket } from './role-bucket'
import { getRoleHomeConfig } from './role-bucket'

export interface RoleSuggestionCardModel {
  id: string
  category: 'risk' | 'resource' | 'schedule' | 'okr' | 'general'
  title: string
  desc: string
  metricLabel: string
}

export interface RoleSuggestionSourceData {
  /** 组织 Dashboard 摘要（admin/pm/observer 桶使用；未查为 undefined）。 */
  summary?: OrganizationDashboardSummary | null
  /** 审计近 7 日事件合计（admin 桶；未查为 undefined）。 */
  auditWeeklyTotal?: number | null
  /** 我的任务跨项目聚合（member 桶）。 */
  myTasks?: {
    dueToday: number
    inProgress: number
    blocked: number
  } | null
  /** 任一源加载中。 */
  loading: boolean
  /** 任一源失败。 */
  error: boolean
}

/** 指标文案：加载中「…」、错误「暂缺」、否则取数值（0 如实显示）。 */
export function metricText(
  value: number | null | undefined,
  unit: string,
  state: { loading: boolean; error: boolean },
): string {
  if (state.loading) return '…'
  if (state.error) return '暂缺'
  if (value === null || value === undefined) return '暂缺'
  return `${value} ${unit}`
}

function kpiValue(
  summary: OrganizationDashboardSummary | null | undefined,
  key: string,
): number | null {
  if (!summary) return null
  const metric = summary.kpis.find((item) => item.key === key)
  return metric?.value ?? null
}

/** 角色桶 → 3 张建议卡（id/标题/描述沿用 ROLE_HOME_CONFIGS，指标真实派生）。 */
export function buildRoleSuggestionCards(
  bucket: RoleBucket,
  data: RoleSuggestionSourceData,
): RoleSuggestionCardModel[] {
  const config = getRoleHomeConfig(bucket)
  const state = { loading: data.loading, error: data.error }
  const slots = config.suggestionSlots

  const metricFor = (
    slotId: string,
  ): { category: RoleSuggestionCardModel['category']; metric: string } => {
    const summary = data.summary
    switch (`${bucket}:${slotId}`) {
      // ── admin ──
      case 'admin:tenant-resources': {
        const projects = kpiValue(summary, 'org_total_projects')
        const members = summary?.memberOverview?.activeMembers ?? null
        return {
          category: 'resource',
          metric:
            state.loading || state.error
              ? metricText(null, '', state)
              : `${projects ?? '—'} 项目 · ${members ?? '—'} 活跃成员`,
        }
      }
      case 'admin:permission-matrix': {
        const roles = summary?.memberOverview?.roleDistribution?.length ?? null
        const active = summary?.memberOverview?.activeMembers ?? null
        return {
          category: 'general',
          metric:
            state.loading || state.error
              ? metricText(null, '', state)
              : roles === null
                ? '暂缺'
                : `${roles} 类角色 · ${active ?? '—'} 人在册`,
        }
      }
      case 'admin:audit-overview':
        return {
          category: 'general',
          metric: metricText(data.auditWeeklyTotal, '事件 / 7 日', state),
        }

      // ── pm ──
      case 'pm:health-inspection': {
        const attention = kpiValue(summary, 'org_attention_projects')
        const overdue = kpiValue(summary, 'org_overdue_projects')
        return {
          category: 'risk',
          metric:
            state.loading || state.error
              ? metricText(null, '', state)
              : `关注 ${attention ?? '—'} · 逾期 ${overdue ?? '—'}`,
        }
      }
      case 'pm:critical-path-risk': {
        const high = kpiValue(summary, 'org_high_risk_count')
        const open = kpiValue(summary, 'org_open_risk_count')
        return {
          category: 'risk',
          metric:
            state.loading || state.error
              ? metricText(null, '', state)
              : `高危 ${high ?? '—'} · 开放 ${open ?? '—'}`,
        }
      }
      case 'pm:schedule-drift': {
        const overdue = kpiValue(summary, 'org_overdue_projects')
        const dueSoon = kpiValue(summary, 'org_due_soon_projects')
        return {
          category: 'schedule',
          metric:
            state.loading || state.error
              ? metricText(null, '', state)
              : `逾期 ${overdue ?? '—'} · 将到期 ${dueSoon ?? '—'}`,
        }
      }

      // ── member ──
      case 'member:today-focus':
        return {
          category: 'schedule',
          metric: metricText(data.myTasks?.dueToday, '项今日到期', state),
        }
      case 'member:collaboration-focus':
        return {
          category: 'general',
          metric: metricText(data.myTasks?.inProgress, '项进行中', state),
        }
      case 'member:blocking-ahead':
        return {
          category: 'risk',
          metric: metricText(data.myTasks?.blocked, '项阻塞', state),
        }

      // ── observer ──
      case 'observer:report-overview':
        return {
          category: 'okr',
          metric: metricText(kpiValue(summary, 'org_recent_activity_count'), '条近期动态', state),
        }
      case 'observer:milestone-progress': {
        const avg = kpiValue(summary, 'org_overall_progress_avg')
        return { category: 'okr', metric: metricText(avg, '% 平均进度', state) }
      }
      case 'observer:health-trend': {
        const high = kpiValue(summary, 'org_high_risk_count')
        const overdue = kpiValue(summary, 'org_overdue_projects')
        return {
          category: 'risk',
          metric:
            state.loading || state.error
              ? metricText(null, '', state)
              : `高危 ${high ?? '—'} · 逾期 ${overdue ?? '—'}`,
        }
      }

      // ── unknown（导引卡，静态真实提示而非数据指标）──
      case 'unknown:space-guide':
        return { category: 'general', metric: '随时问 AI' }
      case 'unknown:coordinate-index':
        return { category: 'general', metric: 'Ctrl+M 呼出' }
      case 'unknown:immersion-guide':
        return { category: 'general', metric: '3 档可调' }

      default:
        return { category: 'general', metric: '—' }
    }
  }

  return slots.map((slot) => {
    const derived = metricFor(slot.id)
    return {
      id: slot.id,
      category: derived.category,
      title: slot.title,
      desc: slot.desc,
      metricLabel: derived.metric,
    }
  })
}
