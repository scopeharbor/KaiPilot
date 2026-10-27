'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import type { WikiRevisionDto } from '@aiproj/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'
import { WikiButton, WikiNotice, lineDiff } from './wiki-ui'

/**
 * 审阅队列：按页面聚合待审提议，展开看差异，逐条发布或驳回；
 * 可勾选多条后「发布所选」，必须在确认对话框里再次点击——不按置信度或类别自动放行。
 */
export function WikiReviewQueue({ spaceId }: { spaceId: number }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [confirmBatch, setConfirmBatch] = React.useState(false)
  const [notice, setNotice] = React.useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const { data, isLoading, isError } = useQuery({
    queryKey: WIKI_QUERY_KEYS.queue(spaceId),
    queryFn: () => wikiApi.reviewQueue(spaceId),
  })
  const items = data?.data ?? []
  const refresh = () => queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })

  const batch = useMutation({
    mutationFn: async (ids: number[]) => {
      const failures: string[] = []
      for (const id of ids) {
        try {
          await wikiApi.publish(id)
        } catch (e) {
          failures.push(`#${id}：${wikiErrorMessage(e)}`)
        }
      }
      return { ok: ids.length - failures.length, failures }
    },
    onSuccess: async ({ ok, failures }) => {
      setConfirmBatch(false)
      setSelected(new Set())
      setNotice(
        failures.length
          ? {
              tone: 'error',
              text: `已发布 ${ok} 条；${failures.length} 条未发布：${failures.join('；')}`,
            }
          : { tone: 'info', text: `已发布 ${ok} 条修订。` },
      )
      await refresh()
    },
  })

  if (isLoading) return <p className="text-xs text-[var(--nx-text-muted)]">加载审阅队列…</p>
  if (isError) return <WikiNotice tone="error">审阅队列加载失败，请稍后重试。</WikiNotice>

  return (
    <section data-wiki-review-queue className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--nx-text-secondary)]">
          AI
          或成员提交的知识修改要在这里确认后才生效；同一页面的多条提议基于同一版本，发布其一后其余需重新提交。
        </p>
        <WikiButton
          data-wiki-batch-publish
          tone="primary"
          disabled={selected.size === 0}
          onClick={() => setConfirmBatch(true)}
        >
          发布所选（{selected.size}）
        </WikiButton>
      </div>
      {notice ? <WikiNotice tone={notice.tone}>{notice.text}</WikiNotice> : null}
      {items.length === 0 ? (
        <p data-wiki-queue-empty className="text-xs text-[var(--nx-text-muted)]">
          没有待审的修订。
        </p>
      ) : null}
      {items.map((item) => (
        <div
          key={item.page.id}
          className="rounded-md border border-[var(--nx-border-hairline)] p-3"
        >
          <h4 className="text-sm font-medium text-[var(--nx-text-primary)]">{item.page.title}</h4>
          <ul className="mt-2 flex flex-col gap-2">
            {item.proposals.map((p) => (
              <WikiProposalRow
                key={p.id}
                proposal={p}
                checked={selected.has(p.id)}
                onToggle={(on) =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (on) next.add(p.id)
                    else next.delete(p.id)
                    return next
                  })
                }
                onDone={(text, tone) => {
                  setNotice({ text, tone })
                  void refresh()
                }}
              />
            ))}
          </ul>
        </div>
      ))}

      <Dialog open={confirmBatch} onOpenChange={setConfirmBatch}>
        <DialogContent data-wiki-batch-dialog>
          <DialogHeader>
            <DialogTitle>发布 {selected.size} 条修订？</DialogTitle>
            <DialogDescription>
              发布后这些内容会作为本空间的已发布知识被大家看到。请确认你已逐条看过差异。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <WikiButton onClick={() => setConfirmBatch(false)}>再看看</WikiButton>
            <WikiButton
              data-wiki-batch-confirm
              tone="primary"
              disabled={batch.isPending}
              onClick={() => batch.mutate([...selected])}
            >
              确认发布
            </WikiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function WikiProposalRow({
  proposal,
  checked,
  onToggle,
  onDone,
}: {
  proposal: WikiRevisionDto
  checked: boolean
  onToggle: (on: boolean) => void
  onDone: (text: string, tone: 'info' | 'error') => void
}) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const detail = useQuery({
    queryKey: ['wiki', 'revision', proposal.id],
    queryFn: () => wikiApi.revision(proposal.id),
    enabled: open,
  })
  const publish = useMutation({
    mutationFn: () => wikiApi.publish(proposal.id),
    onSuccess: () => onDone(`已发布修订 #${proposal.id}。`, 'info'),
    onError: (e) => onDone(wikiErrorMessage(e), 'error'),
  })
  const reject = useMutation({
    mutationFn: () => wikiApi.reject(proposal.id, reason),
    onSuccess: () => onDone(`已驳回修订 #${proposal.id}。`, 'info'),
    onError: (e) => onDone(wikiErrorMessage(e), 'error'),
  })
  const diff = detail.data ? lineDiff(detail.data.baseBody ?? '', detail.data.body) : []

  return (
    <li data-wiki-proposal={proposal.id} className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          aria-label={`选择修订 #${proposal.id}`}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="text-[var(--nx-text-primary)]">
          #{proposal.id} ·{' '}
          {proposal.authorKind === 'system' ? '系统' : proposal.authorKind === 'ai' ? 'AI' : '成员'}
          提交 · {proposal.editClass === 'bookkeeping' ? '簿记' : '知识'}修改 ·{' '}
          {proposal.changeSummary || '无说明'}
        </span>
        <WikiButton data-wiki-proposal-diff onClick={() => setOpen((v) => !v)}>
          {open ? '收起差异' : '查看差异'}
        </WikiButton>
        <WikiButton
          data-wiki-proposal-publish
          tone="primary"
          disabled={publish.isPending}
          onClick={() => publish.mutate()}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          发布
        </WikiButton>
        <input
          aria-label={`驳回原因 #${proposal.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="驳回原因"
          className="h-8 w-40 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2"
        />
        <WikiButton
          data-wiki-proposal-reject
          tone="danger"
          disabled={reject.isPending}
          onClick={() => reject.mutate()}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          驳回
        </WikiButton>
      </div>
      {open ? (
        <pre
          data-wiki-diff
          className="max-h-80 overflow-auto rounded-md bg-[var(--nx-bg-2)] p-2 font-mono text-[11px] leading-5"
        >
          {detail.isLoading ? '加载差异…' : null}
          {diff.map((d, i) => (
            <div
              key={i}
              className={
                d.kind === 'add'
                  ? 'text-[var(--nx-status-success)]'
                  : d.kind === 'del'
                    ? 'text-[var(--nx-status-danger)] line-through'
                    : 'text-[var(--nx-text-muted)]'
              }
            >
              {d.kind === 'add' ? '+ ' : d.kind === 'del' ? '- ' : '  '}
              {d.text}
            </div>
          ))}
        </pre>
      ) : null}
    </li>
  )
}
