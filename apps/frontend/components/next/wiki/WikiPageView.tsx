'use client'

import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, Lock, PencilLine, ShieldOff, Share2, Undo2 } from 'lucide-react'
import {
  WIKI_MASKED_PLACEHOLDER,
  WIKI_PAGE_TYPE_LABELS,
  WIKI_RETROSPECTIVE_LESSONS_HEADING,
  WIKI_RETROSPECTIVE_SLUG,
  parseWikiMarkdown,
  wikiProcessKindOfSlug,
  wikiSectionOfLine,
  type WikiClaimDto,
  type WikiMaskedClaimDto,
  type WikiPageViewDto,
  type WikiScopeKind,
} from '@aiproj/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'
import { WikiProcessInterpret } from './WikiProcessInterpret'
import { WikiLessonsDraft, WikiPromoteLesson } from './WikiRetrospective'
import { WikiButton, WikiNotice } from './wiki-ui'

const CLAIM_KIND_LABELS: Record<string, string> = {
  derived: '统计',
  inference: '推断',
  preference: '偏好',
  rule: '规则',
  decision: '决策',
}

const isClaim = (c: WikiClaimDto | WikiMaskedClaimDto): c is WikiClaimDto => !('masked' in c)

/** 正文预处理：主张标记 → 角标链接，内部链接 → 页内导航链接，去掉脚注定义行。 */
export function prepareWikiMarkdown(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*\[\^c:[^\]]+\]:/.test(line))
    .join('\n')
    .replace(
      /\[\^c:([A-Za-z0-9][A-Za-z0-9._-]{0,63})\](?!:)/g,
      (_m, key: string) => `[※](#wiki-claim-${key})`,
    )
    .replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g, (_m, slug: string, text?: string) => {
      const label = (text ?? slug).trim().replace(/[[\]]/g, '')
      return `[${label}](#wiki-page-${encodeURIComponent(slug.trim())})`
    })
}

/** 撤回结果说明：同一说法在其他页面也一并撤回时注明页数（v3-llm-wiki-lint-consolidation）。 */
export function wikiRetractResultText(result: {
  cascadedClaims?: number
  cascadedPages?: number
}): string {
  const pages = result.cascadedPages ?? 0
  const others = (result.cascadedClaims ?? 1) - 1
  if (others > 0)
    return `已撤回该主张；其他页面里同样的说法（${others} 处）也一并撤回，共生成 ${pages} 条删除修订提议，请在审阅队列中确认。`
  return '已撤回该主张，并生成了删除它的修订提议，请在审阅队列中确认。'
}

export function WikiPageView({
  view,
  onOpenSlug,
  onEdit,
  spaceId,
  spaceScope,
}: {
  view: WikiPageViewDto
  onOpenSlug: (slug: string) => void
  onEdit: () => void
  spaceId: number
  /** 所在空间类型（项目复盘页的提炼与晋升只在项目空间出现）。 */
  spaceScope?: WikiScopeKind
}) {
  const queryClient = useQueryClient()
  const [retracting, setRetracting] = React.useState<WikiClaimDto | null>(null)
  const [retractReason, setRetractReason] = React.useState('')
  const [showHistory, setShowHistory] = React.useState(false)
  const [sharing, setSharing] = React.useState(false)
  const [shareInput, setShareInput] = React.useState((view.sharedWithProjectIds ?? []).join(', '))
  const [message, setMessage] = React.useState<{ tone: 'info' | 'error'; text: string } | null>(
    null,
  )

  const claimsByKey = React.useMemo(
    () => new Map(view.claims.map((c) => [c.claimKey, c])),
    [view.claims],
  )
  const invalidate = () => queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })

  const retract = useMutation({
    mutationFn: () => wikiApi.retract(retracting!.id, retractReason),
    onSuccess: async (result) => {
      setRetracting(null)
      setRetractReason('')
      setMessage({ tone: 'info', text: wikiRetractResultText(result) })
      await invalidate()
    },
    onError: (e) => setMessage({ tone: 'error', text: wikiErrorMessage(e) }),
  })

  const share = useMutation({
    mutationFn: () =>
      wikiApi.updateSharing(
        view.page.id,
        shareInput
          .split(/[,，\s]+/)
          .map((s) => Number(s))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    onSuccess: async (r) => {
      setSharing(false)
      setMessage({
        tone: 'info',
        text: r.projectIds.length
          ? `已授权给 ${r.projectIds.length} 个项目的项目经理只读。`
          : '已取消全部授权，仅本人可见。',
      })
      await invalidate()
    },
    onError: (e) => setMessage({ tone: 'error', text: wikiErrorMessage(e) }),
  })

  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith('#wiki-claim-')) {
        const claim = claimsByKey.get(href.slice('#wiki-claim-'.length))
        if (!claim || !isClaim(claim)) return null
        const tip = claim.sources.map((s) => s.label).join('、')
        return (
          <sup
            data-wiki-claim-ref={claim.claimKey}
            title={`依据：${tip}（${claim.evidenceCount} 个来源）`}
            className="ml-0.5 cursor-help text-[10px] text-[var(--nx-accent)]"
          >
            ※
          </sup>
        )
      }
      if (href?.startsWith('#wiki-page-')) {
        const slug = decodeURIComponent(href.slice('#wiki-page-'.length))
        const link = view.outgoingLinks.find((l) => l.slug === slug)
        if (!link?.exists) return <span className="text-[var(--nx-text-muted)]">{children}</span>
        return (
          <button
            type="button"
            data-wiki-link={slug}
            onClick={() => onOpenSlug(slug)}
            className="text-[var(--nx-accent)] underline-offset-2 hover:underline"
          >
            {children}
          </button>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--nx-accent)] underline"
        >
          {children}
        </a>
      )
    },
  }

  const visibleClaims = view.claims.filter(isClaim)
  // 项目复盘页（v3-llm-wiki-retrospective-lessons）：「教训」章节里的主张可晋升到组织教训库
  const isRetrospective =
    spaceScope === 'project' &&
    view.page.slug === WIKI_RETROSPECTIVE_SLUG &&
    view.canReview &&
    !view.asOf &&
    view.revision !== null
  const lessonKeys = React.useMemo(() => {
    if (!isRetrospective) return new Set<string>()
    const parsed = parseWikiMarkdown(view.body)
    if (!parsed.ok) return new Set<string>()
    return new Set(
      parsed.doc.claims
        .filter(
          (c) =>
            !c.derived &&
            wikiSectionOfLine(view.body, c.line) === WIKI_RETROSPECTIVE_LESSONS_HEADING,
        )
        .map((c) => c.key),
    )
  }, [isRetrospective, view.body])

  return (
    <article data-wiki-page-view={view.page.slug} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            {WIKI_PAGE_TYPE_LABELS[view.page.pageType]}
            {view.revision ? ` · 修订 #${view.revision.id}` : ' · 尚未发布'}
            {view.asOf ? ` · 时点 ${view.asOf.slice(0, 10)}` : ''}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-[var(--nx-text-primary)]">
            {view.page.title}
          </h2>
          {view.page.summaryLine ? (
            <p className="mt-1 text-xs text-[var(--nx-text-secondary)]">{view.page.summaryLine}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view.sharedWithProjectIds !== null ? (
            <WikiButton data-wiki-share-open onClick={() => setSharing(true)}>
              <Share2 className="h-3.5 w-3.5" aria-hidden />
              授权查看
            </WikiButton>
          ) : null}
          <WikiButton data-wiki-history-toggle onClick={() => setShowHistory((v) => !v)}>
            <History className="h-3.5 w-3.5" aria-hidden />
            历史
          </WikiButton>
          {view.canEdit ? (
            <WikiButton data-wiki-edit tone="primary" onClick={onEdit}>
              <PencilLine className="h-3.5 w-3.5" aria-hidden />
              {view.canReview ? '编辑' : '提议修改'}
            </WikiButton>
          ) : null}
        </div>
      </header>

      {view.canReview &&
      view.revision &&
      !view.asOf &&
      view.page.pageType === 'process' &&
      wikiProcessKindOfSlug(view.page.slug) ? (
        <WikiProcessInterpret pageId={view.page.id} spaceId={spaceId} />
      ) : null}

      {isRetrospective ? <WikiLessonsDraft pageId={view.page.id} spaceId={spaceId} /> : null}

      {view.page.hasPendingProposal ? (
        <WikiNotice tone="warning" data-wiki-pending>
          本页有待审的修订提议，审阅确认前不会生效。
        </WikiNotice>
      ) : null}
      {view.hasMaskedContent ? (
        <WikiNotice data-wiki-masked-notice>
          <Lock className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          部分内容引用了你无权查看的资料，已显示为「{WIKI_MASKED_PLACEHOLDER}」。
        </WikiNotice>
      ) : null}
      <WikiNotice>
        维基内容是 AI 与团队整理的理解，不是正式记录；与任务、日期等实时数据冲突时以实时数据为准。
      </WikiNotice>
      {message ? <WikiNotice tone={message.tone}>{message.text}</WikiNotice> : null}

      <div
        data-wiki-body
        className="prose prose-sm max-w-none text-[var(--nx-text-primary)] dark:prose-invert"
      >
        {view.body.trim() ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {prepareWikiMarkdown(view.body)}
          </ReactMarkdown>
        ) : (
          <p className="text-xs text-[var(--nx-text-muted)]">本页尚无已发布内容。</p>
        )}
      </div>

      {visibleClaims.length > 0 ? (
        <section data-wiki-claims className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">主张与依据</h3>
          <ul className="flex flex-col gap-1.5">
            {visibleClaims.map((c) => (
              <li
                key={c.claimKey}
                data-wiki-claim={c.claimKey}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--nx-border-hairline)] px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="text-[var(--nx-text-primary)]">{c.statement}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                    {CLAIM_KIND_LABELS[c.claimKind] ?? c.claimKind} · 依据{' '}
                    {c.sources.map((s) => s.label).join('、')}
                    {c.invalidReason === 'source_deleted' ? ' · 来源已删除' : ''}
                  </p>
                </div>
                {lessonKeys.has(c.claimKey) && c.status === 'active' ? (
                  <WikiPromoteLesson claimId={c.id} onResult={setMessage} />
                ) : null}
                {view.canReview && !view.asOf ? (
                  <WikiButton
                    data-wiki-retract={c.claimKey}
                    tone="danger"
                    onClick={() => setRetracting(c)}
                  >
                    <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                    这条不对
                  </WikiButton>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showHistory ? (
        <WikiHistory pageId={view.page.id} canReview={view.canReview} spaceId={spaceId} />
      ) : null}

      <Dialog open={retracting !== null} onOpenChange={(open) => !open && setRetracting(null)}>
        <DialogContent data-wiki-retract-dialog>
          <DialogHeader>
            <DialogTitle>撤回这条主张？</DialogTitle>
            <DialogDescription>
              撤回后它不再被采信，相同的说法以后也不能再写回维基（除非审阅者解除撤回记录）。系统会生成一条删除它的修订提议，仍需你确认发布。
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-[var(--nx-bg-2)] px-3 py-2 text-xs">
            {retracting?.statement}
          </p>
          <textarea
            aria-label="撤回原因"
            value={retractReason}
            onChange={(e) => setRetractReason(e.target.value)}
            placeholder="原因（可选）"
            className="min-h-16 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2 text-xs"
          />
          <DialogFooter>
            <WikiButton onClick={() => setRetracting(null)}>取消</WikiButton>
            <WikiButton
              data-wiki-retract-confirm
              tone="danger"
              disabled={retract.isPending}
              onClick={() => retract.mutate()}
            >
              确认撤回
            </WikiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sharing} onOpenChange={setSharing}>
        <DialogContent data-wiki-share-dialog>
          <DialogHeader>
            <DialogTitle>授权项目经理只读</DialogTitle>
            <DialogDescription>
              默认只有你自己能看到个人页。填写项目编号（用逗号分隔），这些项目的项目经理就能只读这一页；留空即取消全部授权。
            </DialogDescription>
          </DialogHeader>
          <input
            aria-label="授权的项目编号"
            value={shareInput}
            onChange={(e) => setShareInput(e.target.value)}
            placeholder="例如 12, 15"
            className="h-9 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs"
          />
          <DialogFooter>
            <WikiButton onClick={() => setSharing(false)}>取消</WikiButton>
            <WikiButton tone="primary" disabled={share.isPending} onClick={() => share.mutate()}>
              保存授权
            </WikiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

function WikiHistory({
  pageId,
  canReview,
  spaceId,
}: {
  pageId: number
  canReview: boolean
  spaceId: number
}) {
  const queryClient = useQueryClient()
  const [error, setError] = React.useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: WIKI_QUERY_KEYS.revisions(pageId),
    queryFn: () => wikiApi.revisions(pageId),
  })
  const rollback = useMutation({
    mutationFn: (revisionId: number) => wikiApi.rollback(pageId, revisionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all }),
    onError: (e) => setError(wikiErrorMessage(e)),
  })
  const STATUS: Record<string, string> = {
    published: '当前版本',
    superseded: '历史版本',
    proposed: '待审',
    rejected: '已驳回',
  }
  return (
    <section data-wiki-history data-space={spaceId} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">修订历史</h3>
      {error ? <WikiNotice tone="error">{error}</WikiNotice> : null}
      {isLoading ? <p className="text-xs text-[var(--nx-text-muted)]">加载中…</p> : null}
      <ul className="flex flex-col gap-1">
        {(data?.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
            <span>
              #{r.id} · {STATUS[r.status] ?? r.status} ·{' '}
              {r.editClass === 'bookkeeping' ? '簿记' : '知识'}修改
              {r.authorKind === 'system' ? ' · 系统' : ''} · {r.changeSummary || '无说明'}
            </span>
            {canReview && r.status === 'superseded' ? (
              <WikiButton
                data-wiki-rollback={r.id}
                disabled={rollback.isPending}
                onClick={() => rollback.mutate(r.id)}
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden />
                回滚到此版本
              </WikiButton>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
