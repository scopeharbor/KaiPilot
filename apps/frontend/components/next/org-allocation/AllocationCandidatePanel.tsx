'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Search, UsersRound } from 'lucide-react'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import {
  crossProjectAllocationApi,
  crossProjectAllocationKeys,
} from '@/lib/api/cross-project-resource-allocation'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  candidateSourceLabel,
  filterCandidatesBySkillKeyword,
  groupCandidatesByProject,
  isAiSourcedCandidate,
  normalizeCandidatesPayload,
  type AllocationDateWindow,
} from '@/lib/next/org-allocation/org-allocation-adapter'

/**
 * 跨项目调配候选池只读面板（v3-ui-next-org-portfolio-domains W7 · tasks 7.2）。
 *
 * - 直连 `lib/api` 的 listCandidates（GET /organizations/:organizationId/
 *   cross-project-resource-allocations/candidates，窗口来自草案 queryShape 或默认
 *   90 天）并复用 query key 工厂——不复用既有 hooks 封装（其单对象端点二次解包
 *   存在 `.data` 运行时恒 undefined 的共享层缺陷，hooks 文件不动，域内收敛）；
 *   技能关键词过滤为客户端纯函数（filterCandidatesBySkillKeyword），
 *   零额外写请求（RL-01）；
 * - 按来源项目分组呈现（groupCandidatesByProject），每卡回显技能标签、日额定
 *   工时与可用容量、候选来源（规则/AI/人工/导入）与推荐理由（后端逐项授权下发）；
 * - AI 来源候选以 AI 语义色来源芯片呈现（来源标注，零自动写，RL-01/RL-10）；
 * - 候选仅是咨询池——不构成任何正式调配记录（咨询姿态，RL-06）；
 * - 加载骨架 / 空态 / 5xx 错误重试闭环；精确档关闭氛围。
 */

export interface AllocationCandidatePanelProps {
  /** 候选检索窗口；缺省（null）使用默认 90 天窗口。 */
  window?: AllocationDateWindow | null
  /** 面板初始展开态（详情区常驻可折叠）。 */
  defaultOpen?: boolean
}

export function AllocationCandidatePanel({
  window = null,
  defaultOpen = false,
}: AllocationCandidatePanelProps) {
  const tier = useImmersionTier()
  const organizationId = useCurrentOrganizationId()
  const [open, setOpen] = React.useState(defaultOpen)
  const [keyword, setKeyword] = React.useState('')

  const candidatesQueryParams = React.useMemo(
    () =>
      window
        ? { dateFrom: window.from, dateTo: window.to, topN: 20 }
        : { dateFrom: createFallbackFrom(), dateTo: createFallbackTo(), topN: 20 },
    [window],
  )
  const candidatesQuery = useQuery({
    queryKey: crossProjectAllocationKeys.candidates(organizationId ?? 0, candidatesQueryParams),
    queryFn: () =>
      crossProjectAllocationApi.listCandidates(organizationId as number, candidatesQueryParams),
    enabled: organizationId !== null,
    staleTime: 30_000,
  })

  const normalized = React.useMemo(
    () => normalizeCandidatesPayload(candidatesQuery.data),
    [candidatesQuery.data],
  )
  const candidates = React.useMemo(
    () => filterCandidatesBySkillKeyword(normalized.rows, keyword),
    [normalized.rows, keyword],
  )
  const projectGroups = React.useMemo(() => groupCandidatesByProject(candidates), [candidates])

  return (
    <section
      data-allocation-candidate-panel
      aria-label="候选资源池（只读）"
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] p-3',
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'bg-[var(--nx-workspace-surface)]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          data-allocation-candidate-toggle
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 text-left"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
            <UsersRound className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <span className="text-[13px] font-medium text-[var(--nx-text-primary)]">候选资源池</span>
          <span
            data-allocation-candidate-count
            className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-px font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {normalized.total ?? normalized.rows.length} 人 · 只读
          </span>
        </button>
        <p className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
          候选仅表达调配方向，不构成任何正式资源记录的写入授权（RL-06）
        </p>
      </header>

      {open ? (
        <div data-allocation-candidate-body className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]"
                aria-hidden
              />
              <input
                type="text"
                data-allocation-candidate-search
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="按技能过滤候选（如 React / Go）"
                className="h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-7 pr-2 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
            </div>
            {window ? (
              <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                {window.from} ~ {window.to}
              </span>
            ) : null}
          </div>

          {candidatesQuery.isPending ? (
            <div
              data-allocation-candidate-skeleton
              aria-busy="true"
              className="flex flex-col gap-2"
            >
              {[0, 1, 2].map((line) => (
                <div
                  key={line}
                  className="flex h-16 items-center gap-3 rounded-sm border border-[var(--nx-border-hairline)]/60 px-3"
                >
                  <div className="h-7 w-7 animate-pulse rounded bg-[var(--nx-bg-1)]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 animate-pulse rounded bg-[var(--nx-bg-1)]" />
                    <div className="h-2 w-48 animate-pulse rounded bg-[var(--nx-bg-1)]" />
                  </div>
                </div>
              ))}
            </div>
          ) : candidatesQuery.isError ? (
            <div
              data-allocation-candidate-error
              role="alert"
              className="flex items-center justify-between gap-3 rounded-sm border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-2"
            >
              <p className="text-xs text-[var(--nx-text-secondary)]">候选池加载失败，请重试</p>
              <button
                type="button"
                data-allocation-candidate-retry
                onClick={() => void candidatesQuery.refetch()}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                重试
              </button>
            </div>
          ) : projectGroups.length === 0 ? (
            <div
              data-allocation-candidate-empty
              className="flex flex-col items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] px-4 py-6 text-center"
            >
              <p className="text-xs text-[var(--nx-text-secondary)]">暂无匹配候选资源</p>
              <p className="text-[11px] text-[var(--nx-text-muted)]">
                换一个技能关键词，或确认组织内已登记活跃资源。
              </p>
            </div>
          ) : (
            <div
              data-allocation-candidate-list
              className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1"
            >
              {projectGroups.map((group) => (
                <div key={group.projectId} data-allocation-candidate-group={group.projectId}>
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    <span className="h-1 w-1 rounded-full bg-[var(--nx-accent)]" aria-hidden />
                    {group.projectName}
                    <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                      {group.items.length} 人
                    </span>
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {group.items.map((candidate) => (
                      <div
                        key={candidate.resourceId}
                        data-allocation-candidate={candidate.resourceId}
                        className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[var(--nx-text-primary)]">
                            {candidate.resourceName}
                          </span>
                          <span
                            data-allocation-candidate-source
                            className={cn(
                              'inline-flex items-center rounded-sm border px-1.5 py-px text-[10px]',
                              isAiSourcedCandidate(candidate.source)
                                ? 'border-[var(--nx-ai)]/40 bg-[rgba(0,240,255,0.08)] font-medium text-[var(--nx-ai)]'
                                : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
                            )}
                          >
                            {candidateSourceLabel(candidate.source)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--nx-text-muted)]">
                          <span>日额定 {candidate.dailyCapacityHours}h</span>
                          <span>剩余 ≈ {candidate.remainingCapacityHours}h</span>
                          {candidate.skillFitPercent > 0 ? (
                            <span>技能匹配 {candidate.skillFitPercent}%</span>
                          ) : null}
                        </div>
                        {candidate.skillTags.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {candidate.skillTags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-px text-[10px] text-[var(--nx-text-secondary)]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {candidate.rationale ? (
                          <p
                            data-allocation-candidate-rationale
                            className="mt-1.5 text-[10px] leading-relaxed text-[var(--nx-text-muted)]"
                          >
                            {candidate.rationale}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

export default AllocationCandidatePanel

/** 缺省窗口：今天 → +90 天（与新建草案默认窗口一致）。 */
function createFallbackFrom(): string {
  return new Date().toISOString().slice(0, 10)
}

function createFallbackTo(): string {
  const date = new Date()
  date.setDate(date.getDate() + 90)
  return date.toISOString().slice(0, 10)
}
