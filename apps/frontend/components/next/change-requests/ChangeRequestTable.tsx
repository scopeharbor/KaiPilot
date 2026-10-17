'use client'

import { ChevronRight } from 'lucide-react'
import type { ChangeRequest, ChangeRequestType } from '@/lib/api/change-requests'
import { CR_TYPE_LABELS } from './cr-meta'
import { ChangeRequestPriorityMark, ChangeRequestStatusMark } from './ChangeRequestMarks'

/**
 * 变更请求高密度暗黑仪器表格（v3-ui-next-risk-change-domains W2 · tasks 2.1）。
 *
 * - 服务端分页直出，零客户端二次过滤（多维组合筛选在 ChangeRequestsWorkspacePage）；
 * - 列契约（spec「高密度表格渲染规范」）：CR 编码 / 标题 / 类型标签 / 双通道状态
 *   徽标 / 优先级指示符 / 申请人 / 提交时间 / 行操作；
 * - 整行可点击（onKeyDown Enter/Space 无障碍等价），平滑导航至详情主页；
 * - 纯展示组件：零网络请求，申请人名由容器经成员映射传入（查不到回退 '#id'）。
 */

export interface ChangeRequestTableProps {
  rows: ChangeRequest[]
  /** userId → fullName 映射（容器从项目成员接口构建；可缺省）。 */
  memberNameMap?: Map<number, string>
  onOpenRow: (cr: ChangeRequest) => void
}

export function ChangeRequestTable({ rows, memberNameMap, onOpenRow }: ChangeRequestTableProps) {
  const requesterName = (cr: ChangeRequest): string => {
    const userId = cr.requestedBy ?? cr.requesterId
    if (userId === null || userId === undefined) return '-'
    return memberNameMap?.get(userId) ?? `#${userId}`
  }

  return (
    <div
      data-cr-table
      className="overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <table className="w-full min-w-[860px] border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
            {['编号', '标题', '类型', '状态', '优先级', '申请人', '提交时间'].map((header) => (
              <th
                key={header}
                scope="col"
                className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]"
              >
                {header}
              </th>
            ))}
            <th scope="col" className="w-10 px-2 py-2" aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {rows.map((cr) => (
            <tr
              key={cr.id}
              data-cr-row
              data-cr-row-id={cr.id}
              data-cr-row-status={cr.status}
              tabIndex={0}
              onClick={() => onOpenRow(cr)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpenRow(cr)
                }
              }}
              className="group cursor-pointer border-b border-[var(--nx-border-hairline)] text-left transition-colors last:border-b-0 hover:bg-[var(--nx-bg-0)] focus-visible:bg-[var(--nx-bg-0)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--nx-border-focus)]"
            >
              <td className="whitespace-nowrap px-3 py-2 align-middle font-mono text-[11px] text-[var(--nx-text-muted)]">
                {cr.crCode ?? `CR-${cr.id}`}
              </td>
              <td className="max-w-72 px-3 py-2 align-middle">
                <p className="truncate text-[13px] font-medium text-[var(--nx-text-primary)]">
                  {cr.title}
                </p>
                {cr.description ? (
                  <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
                    {cr.description}
                  </p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-middle">
                <span
                  data-cr-type={cr.changeType}
                  className="inline-block rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                >
                  {CR_TYPE_LABELS[cr.changeType as ChangeRequestType] ?? cr.changeType}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-middle">
                <ChangeRequestStatusMark status={cr.status} compact />
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-middle">
                <ChangeRequestPriorityMark priority={cr.priority} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-middle text-xs text-[var(--nx-text-secondary)]">
                {requesterName(cr)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-middle text-[11px] text-[var(--nx-text-muted)]">
                {cr.submittedAt
                  ? new Date(cr.submittedAt).toLocaleDateString('zh-CN')
                  : new Date(cr.createdAt).toLocaleDateString('zh-CN')}
              </td>
              <td className="px-2 py-2 align-middle">
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center text-[var(--nx-text-muted)] transition-colors group-hover:text-[var(--nx-accent)]"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ChangeRequestTable
