'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  BookOpen,
  Code2,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  Tag,
  X,
} from 'lucide-react'
import { compilerSkillsApi, type CreateSkillBody } from '@/lib/api/compiler-skills'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'
import type { Skill, SkillLifecycleStatus } from '@aiproj/types'

/**
 * 编译器技能注册表工作区（/next/settings/compiler-skills，
 * v3-ui-next-settings-admin-domains W5 · tasks 5.5，spec「编译器技能注册表」）。
 *
 * - 准入 `ai:compiler:skill:view`（RBAC 事实源 `start/rbac/permissions.ts`）：
 *   无查看权限时渲染受限横幅且底层接口 0 请求（RL-06）；
 * - 写操作门 `ai:compiler:skill:manage` / `author` / `eval`：
 *   无管理/撰写权限时只读呈现，写操作按钮（新建/启停/删除）物理隐藏；
 * - 技能注册表展示：名称、标识符（skillKey）、版本、描述、分类、能力标签、状态徽章；
 * - 启停操作二次确认：说明对 AI 编译流水线与可用能力的影响（RL-01 / RL-06）；
 * - 写失败回显服务端错误（ApiError），禁止静默失败；
 * - 暗黑仪器感 `--nx-*` 令牌，1px 发丝线，精确档（precise）降级，三态闭环。
 */

export interface CompilerSkillsWorkspaceProps {
  className?: string
}

const SKILLS_QUERY_KEY = ['compiler', 'skills', 'list'] as const

const CATEGORY_LABELS: Record<string, string> = {
  domain: '领域知识',
  methodology: '工程方法',
  tool: '工具链路',
  regulation: '合规法规',
  template: '标准模板',
}

const STATUS_LABELS: Record<
  SkillLifecycleStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  active: {
    label: '已激活',
    badgeClass:
      'border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)] text-[var(--nx-status-success)]',
    dotClass: 'bg-[var(--nx-status-success)]',
  },
  draft: {
    label: '草稿',
    badgeClass:
      'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)]',
    dotClass: 'bg-[var(--nx-text-secondary)]',
  },
  eval: {
    label: '评审中',
    badgeClass:
      'border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.1)] text-[var(--nx-status-warning)]',
    dotClass: 'bg-[var(--nx-status-warning)]',
  },
  deprecated: {
    label: '已停用',
    badgeClass:
      'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] text-[var(--nx-status-danger)]',
    dotClass: 'bg-[var(--nx-status-danger)]',
  },
  quality_alert: {
    label: '质量告警',
    badgeClass:
      'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.15)] text-[var(--nx-status-danger)]',
    dotClass: 'bg-[var(--nx-status-danger)]',
  },
}

export function CompilerSkillsWorkspace({ className }: CompilerSkillsWorkspaceProps) {
  const tier = useImmersionTier()
  const { can, canAny } = usePermissions()
  const queryClient = useQueryClient()

  // 权限判断
  const hasViewPermission = can('ai:compiler:skill:view')
  const hasWritePermission = canAny([
    'ai:compiler:skill:manage',
    'ai:compiler:skill:author',
    'ai:compiler:skill:eval',
  ])

  // 搜索与过滤态（纯前端，0 写请求）
  const [searchQuery, setSearchQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<string>('all')

  // 新建技能弹窗状态
  const [createOpen, setCreateOpen] = React.useState(false)
  const [formName, setFormName] = React.useState('')
  const [formSkillKey, setFormSkillKey] = React.useState('')
  const [formVersion, setFormVersion] = React.useState('1.0.0')
  const [formCategory, setFormCategory] = React.useState<string>('domain')
  const [formDescription, setFormDescription] = React.useState('')
  const [formTags, setFormTags] = React.useState('')
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({})
  const [formServerError, setFormServerError] = React.useState<string | null>(null)

  // 启停二次确认状态
  const [toggleTarget, setToggleTarget] = React.useState<Skill | null>(null)
  const [toggleTargetStatus, setToggleTargetStatus] =
    React.useState<SkillLifecycleStatus>('deprecated')
  const [toggleServerError, setToggleServerError] = React.useState<string | null>(null)

  // 查询技能列表
  const listQuery = useQuery({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: () => compilerSkillsApi.list({ perPage: 100 }),
    enabled: hasViewPermission,
  })

  // 创建 Mutation
  const createMutation = useMutation({
    mutationFn: (body: CreateSkillBody) => compilerSkillsApi.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY })
      closeCreateDialog()
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '创建技能失败，请检查参数'
      setFormServerError(msg)
    },
  })

  // 启停/生命周期转移 Mutation
  const lifecycleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      compilerSkillsApi.lifecycle(id, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY })
      setToggleTarget(null)
      setToggleServerError(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '状态切换失败'
      setToggleServerError(msg)
    },
  })

  function closeCreateDialog() {
    setCreateOpen(false)
    setFormName('')
    setFormSkillKey('')
    setFormVersion('1.0.0')
    setFormCategory('domain')
    setFormDescription('')
    setFormTags('')
    setFormErrors({})
    setFormServerError(null)
  }

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errors: Record<string, string> = {}
    if (!formName.trim()) {
      errors.name = '请输入技能名称'
    }
    if (!formSkillKey.trim()) {
      errors.skillKey = '请输入技能唯一标识 (skillKey)'
    }
    if (!formVersion.trim()) {
      errors.version = '请输入版本号'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    setFormErrors({})
    setFormServerError(null)

    const tags = formTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    createMutation.mutate({
      name: formName.trim(),
      skillKey: formSkillKey.trim(),
      version: formVersion.trim(),
      description: formDescription.trim(),
      category: { primary: formCategory },
      tags,
    })
  }

  function handleToggleClick(skill: Skill) {
    const nextStatus: SkillLifecycleStatus = skill.status === 'active' ? 'deprecated' : 'active'
    setToggleTarget(skill)
    setToggleTargetStatus(nextStatus)
    setToggleServerError(null)
  }

  function handleToggleConfirm() {
    if (!toggleTarget) return
    lifecycleMutation.mutate({
      id: toggleTarget.id,
      status: toggleTargetStatus,
    })
  }

  // 新建技能弹层（含表单）：在途创建拒绝 Escape 关闭，与「取消」按钮禁用同口径。
  const createSkillDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: createSkillDialogRef,
    open: createOpen,
    onClose: closeCreateDialog,
    canClose: () => !createMutation.isPending,
  })

  // 启停二次确认弹层（role="alertdialog"）：在途提交拒绝 Escape 关闭
  const lifecycleDialogRef = React.useRef<HTMLDivElement | null>(null)
  const closeLifecycleDialog = React.useCallback(() => {
    setToggleTarget(null)
    setToggleServerError(null)
  }, [])
  useDialogA11y({
    ref: lifecycleDialogRef,
    open: toggleTarget !== null,
    onClose: closeLifecycleDialog,
    canClose: () => !lifecycleMutation.isPending,
  })

  // 权限防御（RL-06）：无权限受限横幅且 0 请求
  if (!hasViewPermission) {
    return (
      <div
        data-permission-fallback
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          没有查看编译器技能的权限
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          查看编译器技能注册表需要 ai:compiler:skill:view 权限。请联系组织管理员为你授权。
        </p>
      </div>
    )
  }

  // 安全提取技能数组：避免双重解包陷阱
  const rawData = listQuery.data
  const allSkills: Skill[] = Array.isArray(rawData)
    ? (rawData as Skill[])
    : rawData &&
        typeof rawData === 'object' &&
        'data' in rawData &&
        Array.isArray((rawData as { data: unknown }).data)
      ? (rawData as { data: Skill[] }).data
      : []

  // 筛选过滤
  const filteredSkills = allSkills.filter((s) => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matchName = s.name.toLowerCase().includes(q)
      const matchKey = s.skillKey.toLowerCase().includes(q)
      const matchDesc = s.description?.toLowerCase().includes(q)
      const matchTags = s.tags?.some((t) => t.toLowerCase().includes(q))
      if (!matchName && !matchKey && !matchDesc && !matchTags) return false
    }
    return true
  })

  return (
    <div
      data-compiler-skills-workspace
      data-immersion={tier}
      className={cn('flex flex-col gap-6', className)}
    >
      {/* 头部标题与操作区 */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <BookOpen className="h-5 w-5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">
              编译器技能注册表
            </h1>
            <p className="mt-0.5 text-xs text-[var(--nx-text-muted)]">
              组织级领域知识单元与模型指令集注册底册。控制技能的生命周期与编译器引用范围。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="refresh-skills-button"
            onClick={() => void listQuery.refetch()}
            disabled={listQuery.isFetching}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', listQuery.isFetching && 'animate-spin')}
              aria-hidden
            />
            刷新
          </button>

          {/* 仅在具备写权限时展示新建技能按钮，只读用户物理隐藏 */}
          {hasWritePermission ? (
            <button
              type="button"
              data-testid="create-skill-button"
              onClick={() => setCreateOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-accent)] bg-[var(--nx-accent)] px-3 text-xs font-medium text-black transition-opacity hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建技能
            </button>
          ) : null}
        </div>
      </header>

      {/* 过滤条（纯本地筛选，0 网络写请求） */}
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--nx-text-muted)]" />
          <input
            type="text"
            data-testid="skills-search-input"
            placeholder="按技能名称 / Key / 标签关键词过滤…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-8 pr-3 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--nx-text-muted)]">状态:</label>
          <select
            data-testid="skills-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            <option value="all">全部状态</option>
            <option value="active">已激活</option>
            <option value="draft">草稿</option>
            <option value="eval">评审中</option>
            <option value="deprecated">已停用</option>
            <option value="quality_alert">质量告警</option>
          </select>
        </div>
      </section>

      {/* 三态呈现 */}
      {listQuery.isLoading ? (
        <div
          data-compiler-skills-skeleton
          aria-busy="true"
          className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-6"
        >
          <div className="h-5 w-40 animate-pulse rounded bg-[var(--nx-border-hairline)]" />
          <div className="h-16 w-full animate-pulse rounded bg-[var(--nx-border-hairline)]" />
          <div className="h-16 w-full animate-pulse rounded bg-[var(--nx-border-hairline)]" />
        </div>
      ) : listQuery.isError ? (
        <div
          data-compiler-skills-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <ShieldAlert className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">无法载入技能注册表数据</p>
          <button
            type="button"
            data-testid="retry-skills-button"
            onClick={() => void listQuery.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div
          data-compiler-skills-empty
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-14 text-center"
        >
          <Code2 className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-sm font-medium text-[var(--nx-text-secondary)]">
            {searchQuery || statusFilter !== 'all' ? '未找到匹配的技能' : '暂无编译器技能'}
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            {searchQuery || statusFilter !== 'all'
              ? '请尝试调整检索关键词或状态筛选条件。'
              : hasWritePermission
                ? '点击「新建技能」登记第一个领域知识与规则单元。'
                : '当前组织尚未登记领域技能单元。'}
          </p>
        </div>
      ) : (
        <div data-compiler-skills-list className="grid gap-3">
          {filteredSkills.map((skill) => {
            const statusConfig = STATUS_LABELS[skill.status] || {
              label: skill.status,
              badgeClass:
                'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]',
              dotClass: 'bg-[var(--nx-text-muted)]',
            }

            const primaryCategory =
              typeof skill.category === 'object' && skill.category?.primary
                ? skill.category.primary
                : typeof skill.category === 'string'
                  ? skill.category
                  : 'domain'

            const categoryText = CATEGORY_LABELS[primaryCategory] || primaryCategory

            return (
              <div
                key={skill.id}
                data-skill-card={skill.id}
                className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 transition-colors hover:border-[rgba(255,255,255,0.15)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold text-[var(--nx-text-primary)]">
                      {skill.name}
                    </span>
                    <span className="font-mono text-xs text-[var(--nx-text-muted)]">
                      ({skill.skillKey})
                    </span>
                    <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
                      v{skill.version}
                    </span>
                    <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                      {categoryText}
                    </span>

                    {/* 双通道状态徽章 */}
                    <span
                      data-testid={`skill-status-${skill.id}`}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        statusConfig.badgeClass,
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', statusConfig.dotClass)} />
                      {statusConfig.label}
                    </span>
                  </div>

                  {/* 写操作区：只读态隐藏 */}
                  {hasWritePermission ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid={`toggle-skill-${skill.id}`}
                        onClick={() => handleToggleClick(skill)}
                        className={cn(
                          'flex h-7 items-center gap-1 rounded border px-2.5 text-xs transition-colors',
                          skill.status === 'active'
                            ? 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.06)] text-[var(--nx-status-danger)] hover:border-[var(--nx-status-danger)]'
                            : 'border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.06)] text-[var(--nx-status-success)] hover:border-[var(--nx-status-success)]',
                        )}
                      >
                        <Power className="h-3 w-3" />
                        {skill.status === 'active' ? '停用' : '激活'}
                      </button>
                    </div>
                  ) : null}
                </div>

                {skill.description ? (
                  <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                    {skill.description}
                  </p>
                ) : null}

                {skill.tags && skill.tags.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Tag className="h-3 w-3 text-[var(--nx-text-muted)]" />
                    {skill.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-[var(--nx-bg-0)] px-2 py-0.5 text-[10px] text-[var(--nx-text-muted)] border border-[var(--nx-border-hairline)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* 新建技能对话框 */}
      {createOpen ? (
        <div
          data-testid="create-skill-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-skill-title"
          ref={createSkillDialogRef}
          tabIndex={-1}
        >
          <div className="w-full max-w-lg rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] pb-3">
              <h2
                id="create-skill-title"
                className="text-base font-semibold text-[var(--nx-text-primary)]"
              >
                新建编译器技能
              </h2>
              <button
                type="button"
                data-testid="close-skill-dialog"
                onClick={closeCreateDialog}
                className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 flex flex-col gap-4">
              {formServerError ? (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-2.5 text-xs text-[var(--nx-status-danger)]"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formServerError}</span>
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                  技能名称 <span className="text-[var(--nx-status-danger)]">*</span>
                </label>
                <input
                  type="text"
                  data-testid="input-skill-name"
                  placeholder="如：React 架构规范审查"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-1.5 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                />
                {formErrors.name ? (
                  <p className="mt-1 text-[11px] text-[var(--nx-status-danger)]">
                    {formErrors.name}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                    唯一标识符 (Key) <span className="text-[var(--nx-status-danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    data-testid="input-skill-key"
                    placeholder="如：react-arch-review"
                    value={formSkillKey}
                    onChange={(e) => setFormSkillKey(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-1.5 font-mono text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  />
                  {formErrors.skillKey ? (
                    <p className="mt-1 text-[11px] text-[var(--nx-status-danger)]">
                      {formErrors.skillKey}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                    版本号 <span className="text-[var(--nx-status-danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    data-testid="input-skill-version"
                    placeholder="1.0.0"
                    value={formVersion}
                    onChange={(e) => setFormVersion(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-1.5 font-mono text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  />
                  {formErrors.version ? (
                    <p className="mt-1 text-[11px] text-[var(--nx-status-danger)]">
                      {formErrors.version}
                    </p>
                  ) : null}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                  分类
                </label>
                <select
                  data-testid="select-skill-category"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                >
                  <option value="domain">领域知识 (domain)</option>
                  <option value="methodology">工程方法 (methodology)</option>
                  <option value="tool">工具链路 (tool)</option>
                  <option value="regulation">合规法规 (regulation)</option>
                  <option value="template">标准模板 (template)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                  技能描述
                </label>
                <textarea
                  rows={3}
                  data-testid="input-skill-desc"
                  placeholder="详细描述该技能所包含的规范、指南或分析策略…"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                  标签（英文逗号分隔）
                </label>
                <input
                  type="text"
                  data-testid="input-skill-tags"
                  placeholder="frontend, react, review"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-1.5 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                />
              </div>

              <div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
                <button
                  type="button"
                  data-testid="cancel-create-skill"
                  onClick={closeCreateDialog}
                  disabled={createMutation.isPending}
                  className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  data-testid="submit-create-skill"
                  disabled={createMutation.isPending}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-accent)] bg-[var(--nx-accent)] px-4 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  保存技能
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* 启停二次确认对话框 */}
      {toggleTarget ? (
        <div
          ref={lifecycleDialogRef}
          tabIndex={-1}
          data-testid="lifecycle-confirm-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="lifecycle-confirm-title"
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 text-[var(--nx-status-warning)]">
              <ShieldAlert className="h-5 w-5" aria-hidden />
              <h3 id="lifecycle-confirm-title" className="text-base font-semibold">
                {toggleTargetStatus === 'deprecated' ? '停用技能确认' : '激活技能确认'}
              </h3>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
              确定要将技能「
              <strong className="text-[var(--nx-text-primary)]">{toggleTarget.name}</strong>
              」状态变更为「
              <span className="text-[var(--nx-text-primary)]">
                {toggleTargetStatus === 'deprecated' ? '已停用' : '已激活'}
              </span>
              」吗？
              {toggleTargetStatus === 'deprecated'
                ? '停用后，AI 编译器在代码编译与架构生成流水线中将不再自动加载和注入该技能中的领域规则与知识。'
                : '激活后，AI 编译器将可以在对应的上下文匹配场景中自动检索和应用此技能。'}
            </p>

            {toggleServerError ? (
              <div
                role="alert"
                className="mt-3 flex items-center gap-2 rounded border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-2.5 text-xs text-[var(--nx-status-danger)]"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{toggleServerError}</span>
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="cancel-lifecycle-button"
                onClick={() => {
                  setToggleTarget(null)
                  setToggleServerError(null)
                }}
                disabled={lifecycleMutation.isPending}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="confirm-lifecycle-button"
                onClick={handleToggleConfirm}
                disabled={lifecycleMutation.isPending}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50',
                  toggleTargetStatus === 'deprecated'
                    ? 'border border-[var(--nx-status-danger)] bg-[var(--nx-status-danger)] text-white'
                    : 'border border-[var(--nx-status-success)] bg-[var(--nx-status-success)] text-white',
                )}
              >
                {lifecycleMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                确认{toggleTargetStatus === 'deprecated' ? '停用' : '激活'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default CompilerSkillsWorkspace
