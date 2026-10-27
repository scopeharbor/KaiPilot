'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  BookMarked,
  BrainCircuit,
  ClipboardCheck,
  Download,
  FilePlus2,
  Gauge,
  Search,
  Stethoscope,
  Trash2,
  Workflow,
} from 'lucide-react'
import {
  WIKI_PAGE_TYPE_LABELS,
  WIKI_PAGE_TYPES,
  type WikiPageSummaryDto,
  type WikiScopeKind,
  type WikiSpaceDto,
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
import { cn } from '@/lib/utils'
import { WikiContradictionCheck } from './WikiContradictionCheck'
import { WikiEditor, type WikiEditorTarget } from './WikiEditor'
import { WikiEvalPanel } from './WikiEvalPanel'
import { WikiIngestPanel } from './WikiIngestPanel'
import { WikiPageView } from './WikiPageView'
import { WikiReviewQueue } from './WikiReviewQueue'
import { WikiButton, WikiNotice, WikiPanel } from './wiki-ui'

type Tab = 'pages' | 'review' | 'ingest' | 'lint' | 'eval' | 'log'

const FINDING_LABELS: Record<string, string> = {
  broken_link: '断链已清理',
  orphan_page: '孤立页面（没有其他页面链接到它）',
  index_drift: '目录已重建',
  source_deleted: '主张来源已删除，已关闭有效期',
  stale_page: '页面已过期，建议复核',
  retracted_claim: '已撤回的说法仍在页面上，已生成删除提议',
  contradiction: '可能矛盾',
}

/**
 * 记忆维基工作台（组织 / 项目 / 个人三种入口共用）。
 * 开关关闭：管理员看到开启入口，其余成员看到未开启说明，零维基业务请求。
 */
export function WikiWorkspace({
  scopeKind,
  scopeRefId,
}: {
  scopeKind: WikiScopeKind
  scopeRefId?: number
}) {
  const settings = useQuery({
    queryKey: WIKI_QUERY_KEYS.settings(),
    queryFn: () => wikiApi.settings(),
  })
  const queryClient = useQueryClient()
  const enable = useMutation({
    mutationFn: () => wikiApi.setEnabled(true),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all }),
  })

  if (settings.isLoading) return <p className="text-xs text-[var(--nx-text-muted)]">加载中…</p>
  if (settings.isError || !settings.data) {
    return <WikiNotice tone="error">{wikiErrorMessage(settings.error)}</WikiNotice>
  }
  if (!settings.data.enabled) {
    return (
      <WikiPanel data-wiki-disabled className="flex flex-col items-center gap-3 py-12 text-center">
        <BookMarked className="h-8 w-8 text-[var(--nx-accent)]" aria-hidden />
        <h2 className="text-base font-medium text-[var(--nx-text-primary)]">记忆维基尚未开启</h2>
        <p className="max-w-md text-xs text-[var(--nx-text-muted)]">
          记忆维基把公司业务、流程、项目经验与个人偏好整理成有依据、可审阅的页面，供团队和 AI 参考。
        </p>
        {settings.data.canManage ? (
          <WikiButton
            data-wiki-enable
            tone="primary"
            disabled={enable.isPending}
            onClick={() => enable.mutate()}
          >
            为本组织开启
          </WikiButton>
        ) : (
          <p className="text-xs text-[var(--nx-text-secondary)]">请联系组织管理员开启。</p>
        )}
      </WikiPanel>
    )
  }
  return <WikiSpaceWorkspace scopeKind={scopeKind} scopeRefId={scopeRefId} />
}

function WikiSpaceWorkspace({
  scopeKind,
  scopeRefId,
}: {
  scopeKind: WikiScopeKind
  scopeRefId?: number
}) {
  const space = useQuery({
    queryKey: WIKI_QUERY_KEYS.space(scopeKind, scopeRefId ?? null),
    queryFn: () => wikiApi.resolveSpace(scopeKind, scopeRefId),
    retry: false,
  })
  if (space.isLoading) return <p className="text-xs text-[var(--nx-text-muted)]">加载空间…</p>
  if (space.isError || !space.data) {
    return (
      <WikiNotice tone="error" data-wiki-space-error>
        {wikiErrorMessage(space.error, '无法打开这个维基空间。')}
      </WikiNotice>
    )
  }
  return <WikiSpaceView space={space.data} />
}

function WikiSpaceView({ space }: { space: WikiSpaceDto }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = React.useState<Tab>('pages')
  // ?page=<id>：从 AI 同事的维基结果卡直接打开某页
  const searchParams = useSearchParams()
  const [selectedId, setSelectedId] = React.useState<number | null>(() => {
    const raw = Number(searchParams?.get('page'))
    return Number.isInteger(raw) && raw > 0 ? raw : null
  })
  const [editor, setEditor] = React.useState<WikiEditorTarget | null>(null)
  const [query, setQuery] = React.useState('')
  const [notice, setNotice] = React.useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [confirmClear, setConfirmClear] = React.useState(false)

  const pages = useQuery({
    queryKey: WIKI_QUERY_KEYS.pages(space.id),
    queryFn: () => wikiApi.listPages(space.id),
  })
  const search = useQuery({
    queryKey: WIKI_QUERY_KEYS.search(space.id, query.trim()),
    queryFn: () => wikiApi.search(space.id, query.trim()),
    enabled: query.trim().length > 0,
  })
  const allPages = pages.data?.data ?? []
  const indexPage = allPages.find((p) => p.pageType === 'index')
  const activeId = selectedId ?? indexPage?.id ?? null
  const view = useQuery({
    queryKey: WIKI_QUERY_KEYS.page(activeId ?? 0, null),
    queryFn: () => wikiApi.page(activeId!),
    enabled: activeId !== null,
  })

  const openSlug = (slug: string) => {
    const target = allPages.find((p) => p.slug === slug)
    if (target) {
      setEditor(null)
      setSelectedId(target.id)
    }
  }

  // 计划档案（v3-llm-wiki-planning-dossier）：组织维基审阅者刷新参照类 / 打法页
  const refreshDossier = useMutation({
    mutationFn: () => wikiApi.refreshDossier(),
    onSuccess: async (s) => {
      setNotice({
        tone: 'info',
        text:
          s.created + s.updated === 0
            ? `计划档案已是最新（未变 ${s.unchanged} 页；样本不足或没有数据的 ${s.skipped} 类未生成）。`
            : `计划档案已刷新：新建 ${s.created} 页、更新 ${s.updated} 页、未变 ${s.unchanged} 页。统计段自动发布，人写的解读保持不变。`,
      })
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    },
    onError: (e) => setNotice({ tone: 'error', text: wikiErrorMessage(e) }),
  })
  // 流程实况（v3-llm-wiki-process-reality）：组织维基审阅者刷新任务流转 / 变更审批页
  const refreshProcess = useMutation({
    mutationFn: () => wikiApi.refreshProcess(),
    onSuccess: async (s) => {
      setNotice({
        tone: 'info',
        text:
          s.created + s.updated === 0
            ? `流程实况已是最新（未变 ${s.unchanged} 页；数据不足的 ${s.skipped} 类未生成）。`
            : `流程实况已刷新：新建 ${s.created} 页、更新 ${s.updated} 页、未变 ${s.unchanged} 页。实际段自动发布，人写的声明与解读保持不变。`,
      })
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    },
    onError: (e) => setNotice({ tone: 'error', text: wikiErrorMessage(e) }),
  })
  // 结项复盘（v3-llm-wiki-retrospective-lessons）：项目维基审阅者在项目结项后生成
  const refreshRetrospective = useMutation({
    mutationFn: () => wikiApi.refreshRetrospective(Number(space.scopeRefId)),
    onSuccess: async (s) => {
      setNotice({
        tone: 'info',
        text:
          s.created > 0
            ? '已生成项目复盘页：计划与实际的统计已发布，请在「教训」章节补充或请 AI 提炼教训。'
            : s.updated > 0
              ? '项目复盘已更新统计，人写的教训保持不变。'
              : s.unchanged > 0
                ? '项目复盘已是最新。'
                : '本项目还没有任务，暂时无法生成复盘。',
      })
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    },
    onError: (e) => setNotice({ tone: 'error', text: wikiErrorMessage(e) }),
  })
  // 个人空间（v3-llm-wiki-person-space）：只作用于本人
  const refreshEstimate = useMutation({
    mutationFn: () => wikiApi.refreshMyEstimate(),
    onSuccess: async (s) => {
      setNotice({
        tone: 'info',
        text:
          s.created + s.updated + s.unchanged === 0
            ? '你负责并已完成的任务太少（不足 5 个），暂时无法校准。'
            : s.created + s.updated === 0
              ? '估算校准已是最新。'
              : '估算校准已更新。只有你自己能看到，除非你授权给某个项目的项目经理。',
      })
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    },
    onError: (e) => setNotice({ tone: 'error', text: wikiErrorMessage(e) }),
  })
  const importMemory = useMutation({
    mutationFn: () => wikiApi.importMyMemory(),
    onSuccess: async (r) => {
      setNotice({
        tone: 'info',
        text:
          r.imported > 0
            ? `已整理 ${r.imported} 条偏好${r.skipped ? `（跳过 ${r.skipped} 条已有、敏感或不合规的）` : ''}，请到「审阅队列」确认后才会生效。`
            : `没有可导入的新偏好${r.skipped ? `（跳过 ${r.skipped} 条已有、敏感或不合规的）` : ''}。`,
      })
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    },
    onError: (e) => setNotice({ tone: 'error', text: wikiErrorMessage(e) }),
  })
  // v3-llm-wiki-rag-retirement：项目 / 组织的 AI 同事记忆迁移为本空间的待审提议（审阅者）
  const migrateMemory = useMutation({
    mutationFn: () => wikiApi.migrateCopilotMemory(space.id),
    onSuccess: async (r) => {
      setNotice({
        tone: 'info',
        text:
          r.imported > 0
            ? `已把 ${r.imported} 条 AI 同事记忆整理为「AI 同事记忆（迁移）」页的待审提议${r.skipped ? `（跳过 ${r.skipped} 条已有、敏感或不合规的）` : ''}，请到「审阅队列」确认后才会生效。`
            : `没有可迁移的 AI 同事记忆${r.skipped ? `（跳过 ${r.skipped} 条已有、敏感或不合规的）` : ''}。`,
      })
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    },
    onError: (e) => setNotice({ tone: 'error', text: wikiErrorMessage(e) }),
  })
  const exportZip = useMutation({
    mutationFn: () => wikiApi.exportSpace(space.id),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
    onError: (e) => setNotice({ tone: 'error', text: wikiErrorMessage(e) }),
  })
  const clear = useMutation({
    mutationFn: () => wikiApi.clearPersonalSpace(space.id),
    onSuccess: async (r) => {
      setConfirmClear(false)
      setSelectedId(null)
      setNotice({
        tone: 'info',
        text: `已清空个人空间（${r.pagesDeleted} 个页面），内容不可恢复。`,
      })
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    },
    onError: (e) => setNotice({ tone: 'error', text: wikiErrorMessage(e) }),
  })

  const listed: WikiPageSummaryDto[] = query.trim() ? (search.data?.data ?? []) : allPages
  // 评测（v3-llm-wiki-eval-gate）：只有组织维基的管理者
  const settingsForEval = useQuery({
    queryKey: WIKI_QUERY_KEYS.settings(),
    queryFn: () => wikiApi.settings(),
    enabled: space.scopeKind === 'organization',
  })
  const canEval = space.scopeKind === 'organization' && settingsForEval.data?.canManage === true
  const tabs: Array<[Tab, string]> = [
    ['pages', '页面'],
    ...(space.canReview
      ? ([
          [
            'review',
            `审阅队列${space.pendingProposalCount ? `（${space.pendingProposalCount}）` : ''}`,
          ],
          ...(space.scopeKind === 'project'
            ? ([['ingest', 'AI 编入']] as Array<[Tab, string]>)
            : []),
          ['lint', '体检'],
        ] as Array<[Tab, string]>)
      : []),
    ...(canEval ? ([['eval', '评测']] as Array<[Tab, string]>) : []),
    ['log', '操作日志'],
  ]

  return (
    <div data-wiki-workspace={space.scopeKind} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <BookMarked className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">{space.title}</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              {space.pageCount} 个页面 ·{' '}
              {space.scopeKind === 'user'
                ? '仅你自己可见，可逐页授权给项目经理'
                : '有依据、可审阅的团队知识'}
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2 text-xs" aria-label="维基空间">
          <Link
            href="/next/wiki"
            className="text-[var(--nx-text-secondary)] hover:text-[var(--nx-accent)]"
          >
            组织维基
          </Link>
          <Link
            href="/next/me/wiki"
            className="text-[var(--nx-text-secondary)] hover:text-[var(--nx-accent)]"
          >
            我的维基
          </Link>
          {space.canPropose ? (
            <WikiButton
              data-wiki-new-page
              tone="primary"
              onClick={() => {
                setTab('pages')
                setEditor({ mode: 'create', spaceId: space.id })
              }}
            >
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
              新建页面
            </WikiButton>
          ) : null}
          {space.canReview && space.scopeKind === 'organization' ? (
            <WikiButton
              data-wiki-dossier-refresh
              disabled={refreshDossier.isPending}
              onClick={() => refreshDossier.mutate()}
            >
              <BarChart3 className="h-3.5 w-3.5" aria-hidden />
              刷新计划档案
            </WikiButton>
          ) : null}
          {space.canReview && space.scopeKind === 'organization' ? (
            <WikiButton
              data-wiki-process-refresh
              disabled={refreshProcess.isPending}
              onClick={() => refreshProcess.mutate()}
            >
              <Workflow className="h-3.5 w-3.5" aria-hidden />
              刷新流程实况
            </WikiButton>
          ) : null}
          {space.canReview && space.scopeKind === 'project' ? (
            <WikiButton
              data-wiki-retrospective-refresh
              disabled={refreshRetrospective.isPending}
              onClick={() => refreshRetrospective.mutate()}
            >
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
              生成项目复盘
            </WikiButton>
          ) : null}
          {space.canReview ? (
            <WikiButton
              data-wiki-export
              disabled={exportZip.isPending}
              onClick={() => exportZip.mutate()}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              导出 Markdown
            </WikiButton>
          ) : null}
          {space.scopeKind === 'user' ? (
            <WikiButton
              data-wiki-estimate-refresh
              disabled={refreshEstimate.isPending}
              onClick={() => refreshEstimate.mutate()}
            >
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              刷新我的估算校准
            </WikiButton>
          ) : null}
          {space.scopeKind === 'user' ? (
            <WikiButton
              data-wiki-import-memory
              disabled={importMemory.isPending}
              onClick={() => importMemory.mutate()}
            >
              <BrainCircuit className="h-3.5 w-3.5" aria-hidden />从 AI 记忆导入偏好
            </WikiButton>
          ) : null}
          {(space.scopeKind === 'project' || space.scopeKind === 'organization') &&
          space.canReview ? (
            <WikiButton
              data-wiki-migrate-memory
              disabled={migrateMemory.isPending}
              onClick={() => migrateMemory.mutate()}
            >
              <BrainCircuit className="h-3.5 w-3.5" aria-hidden />
              迁移 AI 同事记忆
            </WikiButton>
          ) : null}
          {space.scopeKind === 'user' ? (
            <WikiButton data-wiki-clear tone="danger" onClick={() => setConfirmClear(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              清空个人空间
            </WikiButton>
          ) : null}
        </nav>
      </header>
      {space.scopeKind === 'organization' ? <WikiShadowSummaryNote /> : null}

      {notice ? <WikiNotice tone={notice.tone}>{notice.text}</WikiNotice> : null}

      <div role="tablist" className="flex gap-1 border-b border-[var(--nx-border-hairline)]">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-wiki-tab={key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-1.5 text-xs',
              tab === key
                ? 'border-[var(--nx-accent)] text-[var(--nx-accent)]'
                : 'border-transparent text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'pages' ? (
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <WikiPanel className="flex flex-col gap-3 p-3">
            <label className="flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-2">
              <Search className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
              <input
                aria-label="搜索页面"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题与小标题"
                className="h-8 w-full bg-transparent text-xs outline-none"
              />
            </label>
            {space.scopeKind === 'project' ? (
              <WikiSharedWithMe
                projectId={Number(space.scopeRefId)}
                activeId={activeId}
                onSelect={(id) => {
                  setEditor(null)
                  setSelectedId(id)
                }}
              />
            ) : null}
            <WikiPageList
              pages={listed}
              activeId={activeId}
              onSelect={(id) => {
                setEditor(null)
                setSelectedId(id)
              }}
            />
          </WikiPanel>
          <WikiPanel>
            {editor ? (
              <WikiEditor
                key={editor.mode === 'edit' ? `edit-${editor.pageId}` : 'create'}
                target={editor}
                canReview={space.canReview}
                onCancel={() => setEditor(null)}
                onDone={({ pageId, published }) => {
                  setEditor(null)
                  setSelectedId(pageId)
                  setNotice({
                    tone: 'info',
                    text: published ? '已发布。' : '已提交审阅，审阅者确认后才会生效。',
                  })
                }}
              />
            ) : view.isError ? (
              <WikiNotice tone="error">{wikiErrorMessage(view.error)}</WikiNotice>
            ) : view.data ? (
              <WikiPageView
                key={view.data.page.id}
                view={view.data}
                spaceId={space.id}
                spaceScope={space.scopeKind}
                onOpenSlug={openSlug}
                onEdit={async () => {
                  let source = ''
                  if (view.data.revision) {
                    const detail = await wikiApi.revision(view.data.revision.id)
                    // 遮蔽内容会被占位文字覆盖：看不全的人不能直接改，避免误删别人的依据
                    if (detail.hasMaskedContent) {
                      setNotice({
                        tone: 'error',
                        text: '本页含有你无权查看的内容，不能直接编辑，请联系有权限的审阅者修改。',
                      })
                      return
                    }
                    source = detail.body
                  }
                  setEditor({
                    mode: 'edit',
                    spaceId: space.id,
                    pageId: view.data.page.id,
                    baseRevisionId: view.data.revision?.id ?? null,
                    source,
                  })
                }}
              />
            ) : (
              <p className="text-xs text-[var(--nx-text-muted)]">
                {allPages.length ? '从左侧选择页面。' : '这个空间还没有页面。'}
              </p>
            )}
          </WikiPanel>
        </div>
      ) : null}
      {tab === 'review' ? <WikiReviewQueue spaceId={space.id} /> : null}
      {tab === 'ingest' ? <WikiIngestPanel spaceId={space.id} /> : null}
      {tab === 'lint' ? (
        <WikiLintPanel
          spaceId={space.id}
          onOpenPage={(id) => {
            setEditor(null)
            setSelectedId(id)
            setTab('pages')
          }}
        />
      ) : null}
      {tab === 'eval' && canEval ? <WikiEvalPanel /> : null}
      {tab === 'log' ? <WikiLogPanel spaceId={space.id} /> : null}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent data-wiki-clear-dialog>
          <DialogHeader>
            <DialogTitle>清空个人空间？</DialogTitle>
            <DialogDescription>
              会删除你个人空间里的全部页面、历史与主张，且不可恢复。为避免这些内容被重新整理回来，系统只保留无法还原原文的撤回指纹。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <WikiButton onClick={() => setConfirmClear(false)}>取消</WikiButton>
            <WikiButton
              data-wiki-clear-confirm
              tone="danger"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
            >
              确认清空
            </WikiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function WikiPageList({
  pages,
  activeId,
  onSelect,
}: {
  pages: WikiPageSummaryDto[]
  activeId: number | null
  onSelect: (id: number) => void
}) {
  if (pages.length === 0)
    return <p className="text-xs text-[var(--nx-text-muted)]">没有匹配的页面。</p>
  const groups = WIKI_PAGE_TYPES.map(
    (t) => [t, pages.filter((p) => p.pageType === t)] as const,
  ).filter(([, list]) => list.length > 0)
  return (
    <nav data-wiki-page-list className="flex flex-col gap-3" aria-label="页面列表">
      {groups.map(([type, list]) => (
        <div key={type}>
          <p className="mb-1 text-[11px] text-[var(--nx-text-muted)]">
            {WIKI_PAGE_TYPE_LABELS[type]}
          </p>
          <ul className="flex flex-col gap-0.5">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  data-wiki-page-item={p.slug}
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    'w-full rounded px-2 py-1 text-left text-xs',
                    activeId === p.id
                      ? 'bg-[var(--nx-bg-2)] text-[var(--nx-accent)]'
                      : 'text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-2)]',
                  )}
                >
                  {p.title}
                  {p.hasPendingProposal ? (
                    <span className="ml-1 text-[10px] text-[var(--nx-status-warning)]">待审</span>
                  ) : null}
                  {p.publishedRevisionId === null ? (
                    <span className="ml-1 text-[10px] text-[var(--nx-text-muted)]">未发布</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function WikiLintPanel({
  spaceId,
  onOpenPage,
}: {
  spaceId: number
  onOpenPage: (pageId: number) => void
}) {
  const queryClient = useQueryClient()
  const findings = useQuery({
    queryKey: WIKI_QUERY_KEYS.findings(spaceId),
    queryFn: () => wikiApi.findings(spaceId),
  })
  const retractions = useQuery({
    queryKey: WIKI_QUERY_KEYS.retractions(spaceId),
    queryFn: () => wikiApi.retractions(spaceId),
  })
  const [summary, setSummary] = React.useState<string | null>(null)
  const run = useMutation({
    mutationFn: () => wikiApi.runLint(spaceId),
    onSuccess: async (s) => {
      setSummary(
        `体检完成：清理断链 ${s.fixedBrokenLinks} 个，关闭来源已删除的主张 ${s.closedClaims} 条，孤立页面 ${s.orphanPages} 个，过期页面 ${s.stalePages} 个` +
          (s.retractedClaims ? `，移除已撤回的说法 ${s.retractedClaims} 条` : '') +
          (s.resolvedContradictions ? `，已解决的矛盾 ${s.resolvedContradictions} 处` : '') +
          '。',
      )
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    },
    onError: (e) => setSummary(wikiErrorMessage(e)),
  })
  const dismiss = useMutation({
    mutationFn: (id: number) => wikiApi.dismissFinding(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.findings(spaceId) }),
    onError: (e) => setSummary(wikiErrorMessage(e)),
  })
  const lift = useMutation({
    mutationFn: (id: number) => wikiApi.liftRetraction(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.retractions(spaceId) }),
  })
  return (
    <section data-wiki-lint className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--nx-text-secondary)]">
          「立即体检」不调用
          AI：只检查断链、孤立页面、目录、已删除的来源、已撤回的说法与过期页面，能自动修的直接修好并记入日志。
          「AI 矛盾体检」只报告可能互相矛盾的说法，不修改页面。
        </p>
        <div className="flex items-start gap-2">
          <WikiContradictionCheck spaceId={spaceId} />
          <WikiButton
            data-wiki-run-lint
            tone="primary"
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
            立即体检
          </WikiButton>
        </div>
      </div>
      {summary ? <WikiNotice data-wiki-lint-summary>{summary}</WikiNotice> : null}
      <ul className="flex flex-col gap-1 text-xs">
        {(findings.data?.data ?? []).map((f) => (
          <li
            key={f.id}
            data-wiki-finding={f.findingKind}
            className="flex items-start justify-between gap-2"
          >
            {f.findingKind === 'contradiction' ? (
              <WikiContradictionItem detail={f.detail} onOpenPage={onOpenPage} />
            ) : (
              <span>
                {FINDING_LABELS[f.findingKind] ?? f.findingKind}
                {f.pageId ? `（页面 #${f.pageId}）` : ''}
              </span>
            )}
            {f.status === 'open' ? (
              <WikiButton
                data-wiki-dismiss={f.id}
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(f.id)}
              >
                忽略
              </WikiButton>
            ) : null}
          </li>
        ))}
        {findings.data && findings.data.data.length === 0 ? (
          <li className="text-[var(--nx-text-muted)]">没有待处理的体检发现。</li>
        ) : null}
      </ul>
      <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">撤回记录</h3>
      <ul className="flex flex-col gap-1 text-xs">
        {(retractions.data?.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span>
              {r.createdAt.slice(0, 10)} · {r.reason || '无原因'}
            </span>
            <WikiButton
              data-wiki-lift={r.id}
              disabled={lift.isPending}
              onClick={() => lift.mutate(r.id)}
            >
              解除撤回
            </WikiButton>
          </li>
        ))}
        {retractions.data && retractions.data.data.length === 0 ? (
          <li className="text-[var(--nx-text-muted)]">没有撤回记录。</li>
        ) : null}
      </ul>
    </section>
  )
}

function WikiLogPanel({ spaceId }: { spaceId: number }) {
  const log = useQuery({
    queryKey: WIKI_QUERY_KEYS.log(spaceId),
    queryFn: () => wikiApi.log(spaceId),
  })
  return (
    <section data-wiki-log className="flex flex-col gap-1">
      {(log.data?.data ?? []).map((l) => (
        <p key={l.id} className="font-mono text-[11px] text-[var(--nx-text-secondary)]">
          {l.line}
        </p>
      ))}
      {log.data && log.data.data.length === 0 ? (
        <p className="text-xs text-[var(--nx-text-muted)]">还没有操作记录。</p>
      ) : null}
    </section>
  )
}

/** 知识库页头的维基入口：开启后显示；未开启时只对能开启的管理员显示。 */
export function WikiEntryButton() {
  const settings = useQuery({
    queryKey: WIKI_QUERY_KEYS.settings(),
    queryFn: () => wikiApi.settings(),
    retry: false,
  })
  if (!settings.data || (!settings.data.enabled && !settings.data.canManage)) return null
  return (
    <Link
      href="/next/wiki"
      data-wiki-entry
      className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
    >
      <BookMarked className="h-3.5 w-3.5" aria-hidden />
      记忆维基
    </Link>
  )
}

/**
 * AI 同事读取维基的近 30 天统计（v3-llm-wiki-query-navigation 影子记录；v3-llm-wiki-rag-retirement 起回答会带上这些维基主张）。
 * 只有能管理维基开关的人看得到；没有数据或接口不可用时不显示。
 */
function WikiShadowSummaryNote() {
  const settings = useQuery({
    queryKey: WIKI_QUERY_KEYS.settings(),
    queryFn: () => wikiApi.settings(),
  })
  const canManage = settings.data?.canManage === true
  const summary = useQuery({
    queryKey: WIKI_QUERY_KEYS.shadowSummary(),
    queryFn: () => wikiApi.shadowSummary(),
    enabled: canManage,
    retry: false,
  })
  const data = summary.data
  if (!canManage || !data || data.turns === 0) return null
  const rate = Math.round((data.turnsWithWiki / data.turns) * 100)
  return (
    <p
      data-wiki-shadow-summary
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-[11px] text-[var(--nx-text-secondary)]"
    >
      维基读取统计（近 {data.days} 天）：AI 同事 {data.turns} 次回答中，{rate}%
      带上了相关维基主张，平均 {data.avgClaims} 条、约 {data.avgBytes} 字节
      {data.truncatedTurns ? `；${data.truncatedTurns} 次超出预算被截断` : ''}。
    </p>
  )
}

/** 项目维基里「成员授权给你的个人页」（v3-llm-wiki-person-space）：只列授权给本项目的，有数据才显示。 */
function WikiSharedWithMe({
  projectId,
  activeId,
  onSelect,
}: {
  projectId: number
  activeId: number | null
  onSelect: (id: number) => void
}) {
  const shared = useQuery({
    queryKey: WIKI_QUERY_KEYS.sharedWithMe(),
    queryFn: () => wikiApi.sharedWithMe(),
  })
  const rows = (shared.data?.data ?? []).filter((r) => r.projectIds.includes(projectId))
  if (rows.length === 0) return null
  return (
    <section data-wiki-shared-with-me className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-medium text-[var(--nx-text-muted)]">成员授权给你的个人页</h3>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.page.id}>
            <button
              type="button"
              data-wiki-shared-page={r.page.id}
              onClick={() => onSelect(r.page.id)}
              className={cn(
                'w-full rounded-md px-2 py-1 text-left text-xs hover:bg-[var(--nx-bg-2)]',
                activeId === r.page.id
                  ? 'text-[var(--nx-accent)]'
                  : 'text-[var(--nx-text-secondary)]',
              )}
            >
              {r.ownerName} · {r.page.title}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-[var(--nx-text-muted)]">
        只读；仅供协作参考，不用于考核或比较。
      </p>
    </section>
  )
}

/** 矛盾发现：两条主张原文、理由，各带「打开页面」。 */
function WikiContradictionItem({
  detail,
  onOpenPage,
}: {
  detail: Record<string, string | number>
  onOpenPage: (pageId: number) => void
}) {
  const side = (statement: unknown, pageId: unknown, label: string) => (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-[var(--nx-text-primary)]">「{String(statement ?? '')}」</span>
      {typeof pageId === 'number' ? (
        <button
          type="button"
          data-wiki-open-page={pageId}
          aria-label={`打开${label}所在页面`}
          className="text-[var(--nx-accent)] underline-offset-2 hover:underline"
          onClick={() => onOpenPage(pageId)}
        >
          打开页面
        </button>
      ) : null}
    </span>
  )
  return (
    <span className="flex flex-col gap-0.5" data-wiki-contradiction>
      <span className="font-medium">{FINDING_LABELS.contradiction}</span>
      {side(detail.statementA, detail.pageA, '第一条')}
      {side(detail.statementB, detail.pageB, '第二条')}
      {detail.reason ? (
        <span className="text-[var(--nx-text-secondary)]">理由：{String(detail.reason)}</span>
      ) : null}
    </span>
  )
}
