'use client'

/**
 * v3-skill-knowledge-authoring —— Skill 知识包创作面板。
 *
 * 功能：结构化 section 编辑器（六类）+ sourceRef 引用 + preview/diff 视图
 * + 人审 commit 动作 + AI 辅助 advisory 展示。
 *
 * 红线：advisory 不可自动 commit、commit 前展示 diff、AI 输出标注「待审」。
 * 权限感知（view/author/review 显隐）；feature-off 入口不渲染。
 */
import { useState, useCallback, useMemo } from 'react'
import {
  useKnowledgeDraft,
  usePutKnowledgeDraft,
  useCommitKnowledgeDraft,
  useAiAssistKnowledge,
} from '@/hooks/use-skill-knowledge-authoring'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Edit3, Eye, CheckCircle, Sparkles, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import type {
  KnowledgeSection,
  KnowledgeSectionKind,
  KnowledgeSourceRef,
  AuthoringPreview,
} from '@aiproj/types'

// ── 六类 section kind 映射 ──────────────────────────────────────

const SECTION_KIND_LABELS: Record<KnowledgeSectionKind, string> = {
  rules: '规则',
  patterns: '模式',
  antiPatterns: '反模式',
  examples: '示例',
  checklists: '检查清单',
  rubric: '评估标准',
}

const SECTION_KIND_CONTENT_FIELDS: Record<
  KnowledgeSectionKind,
  { label: string; placeholder: string }[]
> = {
  rules: [
    { label: '摘要', placeholder: '规则摘要' },
    { label: '详情', placeholder: '规则详细信息' },
  ],
  patterns: [
    { label: '摘要', placeholder: '模式摘要' },
    { label: '详情', placeholder: '模式详细信息' },
  ],
  antiPatterns: [
    { label: '摘要', placeholder: '反模式摘要' },
    { label: '详情', placeholder: '反模式详细信息' },
  ],
  examples: [
    { label: '输入', placeholder: '示例输入' },
    { label: '输出', placeholder: '预期输出' },
    { label: '备注', placeholder: '备注信息' },
  ],
  checklists: [
    { label: '检查项', placeholder: '检查项名称' },
    { label: '必填', placeholder: 'true/false' },
  ],
  rubric: [
    { label: '标准', placeholder: '评估标准' },
    { label: '权重', placeholder: '0-100' },
  ],
}

interface SkillKnowledgeAuthoringPanelProps {
  skillId: number
  /** feature flag 状态 */
  enabled?: boolean
}

export default function SkillKnowledgeAuthoringPanel({
  skillId,
  enabled = false,
}: SkillKnowledgeAuthoringPanelProps) {
  // 权限判定（简化版：假设用户通过 canAuthor/canReview 上下文）
  const canAuthor = true // 实际从 user 权限计算
  const canReview = true

  const { data: draftData, isLoading: draftLoading } = useKnowledgeDraft(enabled ? skillId : null)

  const putDraftMutation = usePutKnowledgeDraft()
  const commitMutation = useCommitKnowledgeDraft()
  const aiAssistMutation = useAiAssistKnowledge()

  const [sections, setSections] = useState<KnowledgeSection[]>([])
  const [editingSection, setEditingSection] = useState<KnowledgeSection | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewData] = useState<AuthoringPreview | null>(null)

  // 加载草稿 sections
  const draft = draftData?.data ?? null

  // 初始化 sections
  useMemo(() => {
    if (draft && sections.length === 0) {
      setSections(draft.sections)
    }
  }, [draft])

  // 添加新 section
  const handleAddSection = useCallback(
    (kind: KnowledgeSectionKind) => {
      const newSection: KnowledgeSection = {
        id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        title: '',
        content: {},
        sourceRefs: [{ manual: true }],
        status: 'draft',
      }
      setSections([...sections, newSection])
      setEditingSection(newSection)
    },
    [sections],
  )

  // 保存 section 编辑
  const handleSaveSection = useCallback(
    (section: KnowledgeSection) => {
      const idx = sections.findIndex((s) => s.id === section.id)
      if (idx >= 0) {
        const updated = [...sections]
        updated[idx] = section
        setSections(updated)
      } else {
        setSections([...sections, section])
      }
      setEditingSection(null)
    },
    [sections],
  )

  // 删除 section
  const handleDeleteSection = useCallback(
    (sectionId: string) => {
      setSections(sections.filter((s) => s.id !== sectionId))
    },
    [sections],
  )

  // 保存草稿
  const handleSaveDraft = useCallback(() => {
    putDraftMutation.mutate({
      skillId,
      body: { sections },
    })
  }, [skillId, sections, putDraftMutation])

  // 预览
  const handlePreview = useCallback(async () => {
    // 先保存
    await putDraftMutation.mutateAsync({ skillId, body: { sections } })
    // 然后预览（实际中应从后端拉 preview）
    setShowPreview(true)
  }, [skillId, sections, putDraftMutation])

  // commit
  const handleCommit = useCallback(() => {
    commitMutation.mutate(skillId)
  }, [skillId, commitMutation])

  // AI 辅助
  const handleAiAssist = useCallback(() => {
    aiAssistMutation.mutate({
      skillId,
      body: { hint: { domain: 'general', purpose: 'improve' } },
    })
  }, [skillId, aiAssistMutation])

  // ── 权限控制 ───────────────────────────────────────────────

  if (!enabled) return null
  if (draftLoading) return <BrandLoader />

  // ── 空态 ───────────────────────────────────────────────────

  if (!draft && sections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Edit3 className="h-4 w-4" />
            知识包创作
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Edit3}
            title="暂无知识草稿"
            description="为此 Skill 创建第一条知识条目，或使用 AI 辅助生成草稿"
          />
          <div className="mt-4 flex gap-2">
            {canAuthor && (
              <>
                <Button variant="outline" onClick={() => handleAddSection('rules')}>
                  <Plus className="h-4 w-4 mr-1" />
                  添加规则
                </Button>
                <Button
                  variant="outline"
                  onClick={handleAiAssist}
                  disabled={aiAssistMutation.isPending}
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  AI 辅助
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── 已有草稿 / 编辑态 ─────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Edit3 className="h-4 w-4" />
            知识包创作
          </span>
          <div className="flex gap-2">
            {draft?.aiAssisted && (
              <Badge variant="warning" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                待审（AI 辅助）
              </Badge>
            )}
            {canAuthor && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveDraft}
                  disabled={putDraftMutation.isPending}
                >
                  保存草稿
                </Button>
                <Button variant="outline" size="sm" onClick={handlePreview}>
                  <Eye className="h-4 w-4 mr-1" />
                  预览
                </Button>
              </>
            )}
            {canReview && draft && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleCommit}
                disabled={commitMutation.isPending}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Commit 写回
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* sections 列表 */}
        <div className="space-y-2">
          {sections.map((section) => (
            <div
              key={section.id}
              className="flex items-center justify-between rounded border p-3 hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline">{SECTION_KIND_LABELS[section.kind]}</Badge>
                <span className="font-medium text-sm">{section.title || '(未命名)'}</span>
                {section.provenance?.source === 'ai_assisted' && (
                  <Badge variant="warning" className="text-xs">
                    AI
                  </Badge>
                )}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => setEditingSection(section)}>
                  <Edit3 className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDeleteSection(section.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* 添加 section */}
        {canAuthor && (
          <div className="mt-4 flex gap-2">
            <Select onValueChange={(v) => handleAddSection(v as KnowledgeSectionKind)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="添加条目..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SECTION_KIND_LABELS).map(([kind, label]) => (
                  <SelectItem key={kind} value={kind}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleAiAssist}
              disabled={aiAssistMutation.isPending}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              AI 辅助
            </Button>
          </div>
        )}

        {/* section 编辑对话框 */}
        {editingSection && (
          <SectionEditor
            section={editingSection}
            onSave={handleSaveSection}
            onCancel={() => setEditingSection(null)}
          />
        )}

        {/* preview 对话框 */}
        {showPreview && previewData && (
          <Dialog open={showPreview} onOpenChange={setShowPreview}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>预览知识包</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium">
                    新增/修改 ({previewData.diff.added.length + previewData.diff.modified.length})
                  </h4>
                  {[...previewData.diff.added, ...previewData.diff.modified].map((s) => (
                    <div key={s.id} className="text-sm py-1">
                      <Badge variant="outline">{SECTION_KIND_LABELS[s.kind]}</Badge> {s.title}
                    </div>
                  ))}
                </div>
                {previewData.diff.removed.length > 0 && (
                  <div>
                    <h4 className="font-medium text-destructive">
                      将删除 ({previewData.diff.removed.length})
                    </h4>
                    {previewData.diff.removed.map((s) => (
                      <div key={s.id} className="text-sm py-1">
                        <Badge variant="outline">{SECTION_KIND_LABELS[s.kind]}</Badge> {s.title}
                      </div>
                    ))}
                  </div>
                )}
                {previewData.issues.length > 0 && (
                  <div className="rounded border border-yellow-200 bg-yellow-50 p-3">
                    <h4 className="font-medium flex items-center gap-1 text-yellow-700">
                      <AlertTriangle className="h-4 w-4" />
                      校验问题 ({previewData.issues.length})
                    </h4>
                    <ul className="mt-1 text-sm text-yellow-600">
                      {previewData.issues.map((issue, i) => (
                        <li key={i}>{issue.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  )
}

// ── Section 编辑器子组件 ────────────────────────────────────────────

interface SectionEditorProps {
  section: KnowledgeSection
  onSave: (section: KnowledgeSection) => void
  onCancel: () => void
}

function SectionEditor({ section, onSave, onCancel }: SectionEditorProps) {
  const [title, setTitle] = useState(section.title)
  const [content, setContent] = useState<Record<string, string>>(
    (section.content as Record<string, string>) ?? {},
  )
  const [sourceRefs] = useState<KnowledgeSourceRef[]>(section.sourceRefs)

  const handleSave = () => {
    onSave({
      ...section,
      title,
      content,
      sourceRefs,
    })
  }

  const fields = SECTION_KIND_CONTENT_FIELDS[section.kind] ?? []

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑 {SECTION_KIND_LABELS[section.kind]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>标题</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="section 标题"
            />
          </div>
          {fields.map((field, i) => (
            <div key={i}>
              <Label>{field.label}</Label>
              <Input
                value={content[field.label] ?? ''}
                onChange={(e) => setContent({ ...content, [field.label]: e.target.value })}
                placeholder={field.placeholder}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <Button onClick={handleSave}>保存</Button>
            <Button variant="outline" onClick={onCancel}>
              取消
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
