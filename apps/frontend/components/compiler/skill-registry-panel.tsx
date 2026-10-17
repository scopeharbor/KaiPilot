'use client'

/**
 * v3-skill-registry-and-lifecycle —— Skill Registry 管理面板。
 *
 * 功能：列表 + 状态徽章 + 创建/编辑 draft 表单 + 生命周期转移动作 + 只读匹配预览。
 * 权限感知（view/author/manage 显隐）；feature-off 入口不渲染。
 *
 * 遵循 compiler-routing-rules-viewer 的 UI 模式：Card/Badge/EmptyState/BrandLoader/Skeleton。
 */
import { useState, useCallback } from 'react'
import {
  useCompilerSkillsList,
  useCreateCompilerSkill,
  useUpdateCompilerSkill,
  useDeleteCompilerSkill,
  useTransitionCompilerSkillLifecycle,
  useCompilerSkillsMatch,
} from '@/hooks/use-compiler-skills'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog'
import { Inbox, BookOpen } from 'lucide-react'
import type { Skill, SkillLifecycleStatus } from '@aiproj/types'
import type { CreateSkillBody } from '@/lib/api/compiler-skills'
import SkillKnowledgeAuthoringPanel from '@/components/compiler/skill-knowledge-authoring-panel'

// ── 状态徽章映射（实际 Badge variant 为 neutral/primary/success/warning/danger/info/ai/outline/solid） ─

const STATUS_BADGE: Record<
  SkillLifecycleStatus,
  { variant: 'neutral' | 'warning' | 'success' | 'danger' | 'outline'; label: string }
> = {
  draft: { variant: 'neutral', label: '草稿' },
  eval: { variant: 'warning', label: '评审中' },
  active: { variant: 'success', label: '已激活' },
  deprecated: { variant: 'danger', label: '已废弃' },
  quality_alert: { variant: 'danger', label: '质量告警' },
}

// ── 合法转移目标（与 compiler-skill.ts 的定义一致） ──────────────

const VALID_TRANSITIONS: Record<SkillLifecycleStatus, SkillLifecycleStatus[]> = {
  draft: ['eval'],
  eval: ['active', 'draft'],
  active: ['deprecated', 'quality_alert'],
  quality_alert: ['active', 'deprecated'],
  deprecated: [],
}

// ── 类别下拉选项 ─────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: 'domain', label: '领域 (domain)' },
  { value: 'methodology', label: '方法论 (methodology)' },
  { value: 'tool', label: '工具 (tool)' },
  { value: 'regulation', label: '法规 (regulation)' },
  { value: 'template', label: '模板 (template)' },
]

// ── 权限判定（useAuthStore.permissions 是 string[]，使用 includes 判断） ─

function useSkillPermissions() {
  const permissions = useAuthStore((s) => s.permissions)
  return {
    canView: permissions.includes('ai:compiler:skill:view'),
    canAuthor: permissions.includes('ai:compiler:skill:author'),
    canManage: permissions.includes('ai:compiler:skill:manage'),
  }
}

// ═══════════════════════════════════════════════════════════════════
// 主面板
// ═══════════════════════════════════════════════════════════════════

export function SkillRegistryPanel() {
  const perms = useSkillPermissions()
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editSkill, setEditSkill] = useState<Skill | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Skill | null>(null)

  const { data, isLoading, error, refetch } = useCompilerSkillsList({ page, perPage: 20 })

  // ── 无权限 ─
  if (!perms.canView) {
    return (
      <EmptyState icon={Inbox} title="无权限" description="您没有查看 Skill Registry 的权限。" />
    )
  }

  // ── 加载态 ─
  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        <BrandLoader size={40} label="正在载入 Skill Registry…" />
        {[0, 1, 2].map((k) => (
          <Skeleton key={k} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  // ── 错误态 ─
  if (error) {
    return (
      <EmptyState
        icon={Inbox}
        title="载入失败"
        description="无法获取 Skill 列表，请重试。"
        action={
          <button onClick={() => refetch()} className="text-sm text-primary underline">
            重试
          </button>
        }
      />
    )
  }

  const skills = data?.data ?? []
  const total = data?.meta?.total ?? 0

  return (
    <div className="space-y-6">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Skill Registry</h2>
          <p className="text-sm text-gray-500">组织级领域知识单元管理 · 共 {total} 个 Skill</p>
        </div>
        {perms.canAuthor && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">新建 Skill</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>新建 Skill</DialogTitle>
              </DialogHeader>
              <SkillForm
                onSubmit={async () => {
                  setCreateOpen(false)
                }}
                onCancel={() => setCreateOpen(false)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* 空态 */}
      {skills.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="暂无 Skill"
          description={
            perms.canAuthor ? '点击「新建 Skill」创建第一个领域知识单元' : '当前组织尚无 Skill'
          }
          action={
            perms.canAuthor ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                新建 Skill
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              perms={perms}
              onEdit={() => setEditSkill(skill)}
              onDelete={() => setConfirmDelete(skill)}
            />
          ))}
        </div>
      )}

      {/* 分页 */}
      {total > 20 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="flex items-center text-sm text-gray-500">
            {page} / {Math.ceil(total / 20)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.ceil(total / 20)}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editSkill && (
        <Dialog open={true} onOpenChange={() => setEditSkill(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>编辑 Skill</DialogTitle>
            </DialogHeader>
            <SkillForm
              defaults={editSkill}
              onSubmit={async () => setEditSkill(null)}
              onCancel={() => setEditSkill(null)}
              isUpdate
            />
          </DialogContent>
        </Dialog>
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <Dialog open={true} onOpenChange={() => setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认删除</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-500">
              确定要删除 Skill 「{confirmDelete.name}」({confirmDelete.skillKey})
              吗？此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <DeleteButton skill={confirmDelete} onDeleted={() => setConfirmDelete(null)} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 知识创作入口（flag 感知）
// ═══════════════════════════════════════════════════════════════════

function SkillKnowledgeLink({
  perms,
  skillId,
}: {
  perms: ReturnType<typeof useSkillPermissions>
  skillId: number
}) {
  const [open, setOpen] = useState(false)
  // feature flag: 需 author 权限才显示入口
  if (!perms.canAuthor) return null

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <BookOpen className="h-4 w-4 mr-1" />
        编辑知识包
      </Button>
      {open && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <SkillKnowledgeAuthoringPanel skillId={skillId} enabled={true} />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Skill 卡片
// ═══════════════════════════════════════════════════════════════════

function SkillCard({
  skill,
  perms,
  onEdit,
  onDelete,
}: {
  skill: Skill
  perms: ReturnType<typeof useSkillPermissions>
  onEdit: () => void
  onDelete: () => void
}) {
  const [transitionOpen, setTransitionOpen] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const badge = STATUS_BADGE[skill.status] ?? { variant: 'neutral' as const, label: skill.status }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{skill.name}</CardTitle>
            <p className="text-xs text-gray-500 font-mono mt-1">{skill.skillKey}</p>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-gray-500 line-clamp-2">{skill.description || '（无描述）'}</p>
        <div className="flex flex-wrap gap-1">
          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">
            v{skill.version}
          </span>
          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">
            {skill.category.primary}
          </span>
          {skill.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">
              {tag}
            </span>
          ))}
        </div>

        {/* 动作按钮 */}
        <div className="flex flex-wrap gap-2 pt-2">
          {/* 编辑知识包入口（flag 感知） */}
          <SkillKnowledgeLink perms={perms} skillId={skill.id} />
          {skill.status === 'draft' && perms.canAuthor && (
            <>
              <Button size="sm" variant="outline" onClick={onEdit}>
                编辑
              </Button>
              <Button size="sm" variant="outline" onClick={onDelete}>
                删除
              </Button>
            </>
          )}
          {perms.canManage && (
            <TransitionButton
              skill={skill}
              open={transitionOpen}
              onOpenChange={setTransitionOpen}
            />
          )}
          {perms.canView && (
            <Button size="sm" variant="outline" onClick={() => setMatchOpen(true)}>
              匹配预览
            </Button>
          )}
        </div>

        {/* 匹配预览（内联对话框） */}
        {matchOpen && <MatchPreview skill={skill} onClose={() => setMatchOpen(false)} />}
      </CardContent>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 新建/编辑 Skill 表单
// ═══════════════════════════════════════════════════════════════════

function SkillForm({
  defaults,
  onSubmit,
  onCancel,
  isUpdate = false,
}: {
  defaults?: Skill
  onSubmit: (body: CreateSkillBody) => Promise<void>
  onCancel: () => void
  isUpdate?: boolean
}) {
  const [form, setForm] = useState({
    skillKey: defaults?.skillKey ?? '',
    name: defaults?.name ?? '',
    version: defaults?.version ?? '1.0.0',
    description: defaults?.description ?? '',
    categoryPrimary: (defaults?.category?.primary ?? 'domain') as string,
    categorySecondary: defaults?.category?.secondary ?? '',
    tagsStr: defaults?.tags?.join(', ') ?? '',
    activationStages: defaults?.activation?.stages ? defaults.activation.stages.join(', ') : '',
    activationProjectTypes: defaults?.activation?.projectTypes
      ? defaults.activation.projectTypes.join(', ')
      : '',
    activationDomains: defaults?.activation?.domains ? defaults.activation.domains.join(', ') : '',
    knowledgeRules: defaults?.knowledge?.rules ? JSON.stringify(defaults.knowledge.rules) : '',
    basePriority: defaults?.basePriority ?? 100,
    submitting: false,
    error: '',
  })

  const createMutation = useCreateCompilerSkill()
  const updateMutation = useUpdateCompilerSkill()

  const handleSubmit = useCallback(async () => {
    setForm((f) => ({ ...f, submitting: true, error: '' }))

    const body: CreateSkillBody = {
      skillKey: form.skillKey,
      name: form.name,
      version: form.version,
      description: form.description,
      category: {
        primary: form.categoryPrimary,
        ...(form.categorySecondary ? { secondary: form.categorySecondary } : {}),
      },
      tags: form.tagsStr
        ? form.tagsStr
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      activation: {
        ...(form.activationStages
          ? {
              stages: form.activationStages
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        ...(form.activationProjectTypes
          ? {
              projectTypes: form.activationProjectTypes
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        ...(form.activationDomains
          ? {
              domains: form.activationDomains
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
      },
      knowledge: form.knowledgeRules ? { rules: JSON.parse(form.knowledgeRules) } : {},
      basePriority: form.basePriority,
    }

    try {
      if (isUpdate && defaults) {
        const { skillKey: _skillKey, ...updateBody } = body
        await updateMutation.mutateAsync({ id: defaults.id, body: updateBody })
      } else {
        await createMutation.mutateAsync(body)
      }
      await onSubmit(body)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交失败'
      setForm((f) => ({ ...f, error: msg }))
    } finally {
      setForm((f) => ({ ...f, submitting: false }))
    }
  }, [form, isUpdate, defaults, createMutation, updateMutation, onSubmit])

  return (
    <div className="space-y-4">
      {form.error && <p className="text-sm text-danger">{form.error}</p>}

      {!isUpdate && (
        <div>
          <Label htmlFor="skillKey">Skill Key *</Label>
          <Input
            id="skillKey"
            value={form.skillKey}
            onChange={(e) => setForm((f) => ({ ...f, skillKey: e.target.value }))}
            placeholder="my-domain-skill（字母数字、短横线、下划线、点）"
          />
        </div>
      )}

      <div>
        <Label htmlFor="name">名称 *</Label>
        <Input
          id="name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Skill 名称"
        />
      </div>

      {!isUpdate && (
        <div>
          <Label htmlFor="version">版本</Label>
          <Input
            id="version"
            value={form.version}
            onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
            placeholder="1.0.0"
          />
        </div>
      )}

      <div>
        <Label htmlFor="description">描述</Label>
        <Textarea
          id="description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Skill 描述"
        />
      </div>

      <div>
        <Label htmlFor="categoryPrimary">类别 *</Label>
        <Select
          value={form.categoryPrimary}
          onValueChange={(v) => setForm((f) => ({ ...f, categoryPrimary: v }))}
        >
          <SelectTrigger id="categoryPrimary">
            <SelectValue placeholder="选择类别" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="categorySecondary">二级分类（可选）</Label>
        <Input
          id="categorySecondary"
          value={form.categorySecondary}
          onChange={(e) => setForm((f) => ({ ...f, categorySecondary: e.target.value }))}
          placeholder="software_engineering"
        />
      </div>

      <div>
        <Label htmlFor="tags">标签（逗号分隔）</Label>
        <Input
          id="tags"
          value={form.tagsStr}
          onChange={(e) => setForm((f) => ({ ...f, tagsStr: e.target.value }))}
          placeholder="ai, compiler, domain"
        />
      </div>

      <div>
        <Label htmlFor="activationStages">激活 Stage（逗号分隔，可选）</Label>
        <Input
          id="activationStages"
          value={form.activationStages}
          onChange={(e) => setForm((f) => ({ ...f, activationStages: e.target.value }))}
          placeholder="intent_parsing, code_generation"
        />
      </div>

      <div>
        <Label htmlFor="activationProjectTypes">激活项目类型（逗号分隔，可选）</Label>
        <Input
          id="activationProjectTypes"
          value={form.activationProjectTypes}
          onChange={(e) => setForm((f) => ({ ...f, activationProjectTypes: e.target.value }))}
          placeholder="software, construction"
        />
      </div>

      <div>
        <Label htmlFor="activationDomains">激活领域（逗号分隔，可选）</Label>
        <Input
          id="activationDomains"
          value={form.activationDomains}
          onChange={(e) => setForm((f) => ({ ...f, activationDomains: e.target.value }))}
          placeholder="ai, nlp"
        />
      </div>

      <div>
        <Label htmlFor="knowledgeRules">知识规则（JSON 数组，可选）</Label>
        <Textarea
          id="knowledgeRules"
          value={form.knowledgeRules}
          onChange={(e) => setForm((f) => ({ ...f, knowledgeRules: e.target.value }))}
          placeholder='[{"rule": "..."}]'
        />
      </div>

      <div>
        <Label htmlFor="basePriority">基础优先级 (1-10000)</Label>
        <Input
          id="basePriority"
          type="number"
          value={form.basePriority}
          onChange={(e) => setForm((f) => ({ ...f, basePriority: Number(e.target.value) }))}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={form.submitting}>
          取消
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={form.submitting || (!isUpdate && !form.skillKey) || !form.name}
          loading={form.submitting}
        >
          {isUpdate ? '保存' : '创建'}
        </Button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 删除按钮
// ═══════════════════════════════════════════════════════════════════

function DeleteButton({ skill, onDeleted }: { skill: Skill; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const mutate = useDeleteCompilerSkill()

  return (
    <Button
      variant="danger"
      size="sm"
      disabled={deleting}
      loading={deleting}
      onClick={async () => {
        setDeleting(true)
        try {
          await mutate.mutateAsync(skill.id)
          onDeleted()
        } finally {
          setDeleting(false)
        }
      }}
    >
      确认删除
    </Button>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 生命周期转移按钮
// ═══════════════════════════════════════════════════════════════════

function TransitionButton({
  skill,
  open,
  onOpenChange,
}: {
  skill: Skill
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const targets = VALID_TRANSITIONS[skill.status] ?? []
  if (targets.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          转移状态
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生命周期转移</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500">
          当前状态：{STATUS_BADGE[skill.status]?.label ?? skill.status}
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          {targets.map((target) => (
            <TransitionActionButton
              key={target}
              skill={skill}
              target={target}
              onDone={() => onOpenChange(false)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TransitionActionButton({
  skill,
  target,
  onDone,
}: {
  skill: Skill
  target: SkillLifecycleStatus
  onDone: () => void
}) {
  const [pending, setPending] = useState(false)
  const mutate = useTransitionCompilerSkillLifecycle()

  return (
    <Button
      size="sm"
      disabled={pending}
      loading={pending}
      onClick={async () => {
        setPending(true)
        try {
          await mutate.mutateAsync({ id: skill.id, body: { status: target } })
          onDone()
        } finally {
          setPending(false)
        }
      }}
    >
      → {STATUS_BADGE[target]?.label ?? target}
    </Button>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 匹配预览
// ═══════════════════════════════════════════════════════════════════

function MatchPreview({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const { data } = useCompilerSkillsMatch({
    stageId: skill.activation?.stages?.[0] ?? undefined,
  })
  const results = data?.data ?? []

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>匹配预览</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500">
          基于激活规则的匹配结果预览（模拟当前 Skill 的激活条件）
        </p>
        {results.length === 0 ? (
          <p className="text-sm text-gray-400 italic">无匹配结果</p>
        ) : (
          <ul className="space-y-2 mt-2">
            {results.map((r) => (
              <li key={r.skill.id} className="text-sm flex items-center justify-between">
                <span>
                  {r.skill.name} ({r.skill.skillKey})
                </span>
                <Badge variant="outline">得分: {r.score.toFixed(1)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
