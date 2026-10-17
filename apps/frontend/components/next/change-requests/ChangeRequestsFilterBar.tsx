'use client'

import { CalendarDays, FilterX, ListFilter } from 'lucide-react'
import type {
  ChangeRequestPriority,
  ChangeRequestStatus,
  ChangeRequestType,
} from '@/lib/api/change-requests'
import { CR_PRIORITY_OPTIONS, CR_STATUS_OPTIONS, CR_TYPE_OPTIONS } from './cr-meta'

/**
 * 变更请求多维组合筛选工具栏（v3-ui-next-risk-change-domains W2 · tasks 2.1）。
 *
 * - 状态 9 种 / 类型 7 种 / 优先级 4 种 + 申请人下拉（项目成员）+ 创建日期起止范围，
 *   组合过滤全部走服务端查询（filters 变化由容器重建 queryKey）；
 * - 任一筛选变更必须同步重置页码为 1（spec「多维组合过滤能力」）；
 * - 「清除筛选条件」一键恢复全量（容器 onReset）；
 * - 受控纯展示组件：本地零网络请求。
 */

const selectClass =
  'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
const dateClass =
  'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 font-mono text-[11px] text-[var(--nx-text-primary)] [color-scheme:dark] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]'

export interface ChangeRequestsFilterState {
  status: ChangeRequestStatus | ''
  changeType: ChangeRequestType | ''
  priority: ChangeRequestPriority | ''
  requesterId: number | ''
  startDate: string
  endDate: string
}

export const EMPTY_CR_FILTERS: ChangeRequestsFilterState = {
  status: '',
  changeType: '',
  priority: '',
  requesterId: '',
  startDate: '',
  endDate: '',
}

export function hasActiveCrFilters(filters: ChangeRequestsFilterState): boolean {
  return Object.values(filters).some((value) => value !== '')
}

export interface ChangeRequestsFilterBarProps {
  filters: ChangeRequestsFilterState
  /** 申请人候选（项目成员）；加载失败或为空时隐藏申请人下拉。 */
  memberOptions: Array<{ userId: number; label: string }>
  membersAvailable: boolean
  onChange: (patch: Partial<ChangeRequestsFilterState>) => void
  onReset: () => void
}

export function ChangeRequestsFilterBar({
  filters,
  memberOptions,
  membersAvailable,
  onChange,
  onReset,
}: ChangeRequestsFilterBarProps) {
  const active = hasActiveCrFilters(filters)
  return (
    <div
      data-cr-filter-bar
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5"
    >
      <ListFilter className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
      <label className="sr-only" htmlFor="cr-filter-status">
        状态筛选
      </label>
      <select
        id="cr-filter-status"
        data-cr-filter-status
        aria-label="按状态筛选"
        value={filters.status}
        onChange={(event) => onChange({ status: event.target.value as ChangeRequestStatus | '' })}
        className={selectClass}
      >
        <option value="">全部状态</option>
        {CR_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="cr-filter-type">
        类型筛选
      </label>
      <select
        id="cr-filter-type"
        data-cr-filter-type
        aria-label="按变更类型筛选"
        value={filters.changeType}
        onChange={(event) => onChange({ changeType: event.target.value as ChangeRequestType | '' })}
        className={selectClass}
      >
        <option value="">全部类型</option>
        {CR_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="cr-filter-priority">
        优先级筛选
      </label>
      <select
        id="cr-filter-priority"
        data-cr-filter-priority
        aria-label="按优先级筛选"
        value={filters.priority}
        onChange={(event) =>
          onChange({ priority: event.target.value as ChangeRequestPriority | '' })
        }
        className={selectClass}
      >
        <option value="">全部优先级</option>
        {CR_PRIORITY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {membersAvailable ? (
        <>
          <label className="sr-only" htmlFor="cr-filter-requester">
            申请人筛选
          </label>
          <select
            id="cr-filter-requester"
            data-cr-filter-requester
            aria-label="按申请人筛选"
            value={filters.requesterId}
            onChange={(event) =>
              onChange({
                requesterId: event.target.value === '' ? '' : Number(event.target.value),
              })
            }
            className={selectClass}
          >
            <option value="">全部申请人</option>
            {memberOptions.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <span
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]"
        aria-hidden
      >
        <CalendarDays className="h-3 w-3" />
        创建日期
      </span>
      <label className="sr-only" htmlFor="cr-filter-start-date">
        开始日期
      </label>
      <input
        id="cr-filter-start-date"
        data-cr-filter-start-date
        aria-label="开始日期"
        type="date"
        value={filters.startDate}
        max={filters.endDate || undefined}
        onChange={(event) => onChange({ startDate: event.target.value })}
        className={dateClass}
      />
      <span className="text-[10px] text-[var(--nx-text-muted)]" aria-hidden>
        至
      </span>
      <label className="sr-only" htmlFor="cr-filter-end-date">
        结束日期
      </label>
      <input
        id="cr-filter-end-date"
        data-cr-filter-end-date
        aria-label="结束日期"
        type="date"
        value={filters.endDate}
        min={filters.startDate || undefined}
        onChange={(event) => onChange({ endDate: event.target.value })}
        className={dateClass}
      />

      {active ? (
        <button
          type="button"
          data-cr-filter-reset
          onClick={onReset}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <FilterX className="h-3.5 w-3.5" aria-hidden />
          清除筛选条件
        </button>
      ) : null}
    </div>
  )
}

export default ChangeRequestsFilterBar
