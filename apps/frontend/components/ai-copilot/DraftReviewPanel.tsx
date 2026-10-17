'use client'

import { useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  FileText,
  HelpCircle,
  ListChecks,
  Save,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import {
  DraftGovernanceSection,
  DraftPlanInsightsPanel,
  riskStrategyLabel,
} from './DraftPlanInsightsPanel'
import type {
  ProjectDraft,
  ProjectDraftDependency,
  ProjectDraftMeta,
  ProjectDraftModule,
  ProjectDraftTask,
  ProjectDraftWbsNode,
  DraftValidationReport,
} from '@aiproj/types'

const moduleLabels: Record<ProjectDraftModule, string> = {
  charter: '项目章程',
  wbs: '工作分解结构',
  tasks: '任务清单',
  dependencies: '任务依赖',
  acceptance: '验收标准',
  resource: '资源建议',
  risk: '风险建议',
  milestone: '里程碑',
  ganttPreview: '甘特图预览',
}

const stageLabels = {
  charter_scope: '章程与范围',
  wbs_tasks: 'WBS 与任务',
  schedule_dependencies: '排期与依赖',
  resources_risks_acceptance: '资源、风险与验收',
  reconcile_review: '一致性复核',
} as const

interface Props {
  draft: ProjectDraft
  meta: ProjectDraftMeta
  validation: DraftValidationReport | null
  onAcceptAll: () => void
  onAcceptPartial: (selection: {
    wbsNodeIds: string[]
    taskIds: string[]
    acceptanceIds: string[]
    riskHintIds: string[]
  }) => void
  /** 行内字段编辑=本地暂存该改动（不导入）；导入仅由「确认导入」触发。 */
  onApplyEdit: (path: string, value: string | number | boolean | string[]) => void
  onRejectRetry: () => void
  onSaveDraft: () => void
  onBack: () => void
}

export function DraftReviewPanel({
  draft,
  meta,
  validation,
  onAcceptAll,
  onAcceptPartial,
  onApplyEdit,
  onRejectRetry,
  onSaveDraft,
  onBack,
}: Props) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['charter', 'wbs', 'tasks']),
  )
  const [selectedWbsNodes, setSelectedWbsNodes] = useState<Set<string>>(new Set())
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [selectedRiskHints, setSelectedRiskHints] = useState<Set<string>>(new Set())
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'all' | 'partial' | 'edit'>('all')
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState(false)

  const confirmabilityStatus = meta.confirmability?.status ?? 'confirmable'
  const canConfirm = (validation?.canConfirm ?? true) && confirmabilityStatus === 'confirmable'
  const rawConfidence = validation?.confidenceScore ?? 50
  // API 契约为 0–100；兼容早期前端 fixture 曾使用的 0–1 表示法。
  const confidencePercent = rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence
  const displayedConfidence = Math.round(Math.min(confidencePercent, canConfirm ? 100 : 85))
  const blockingIssues = validation?.blocking ?? []
  const warningIssues = validation?.warning ?? []
  const infoIssues = validation?.info ?? []
  const autoFixDiffs = validation?.autoFixDiffs ?? []
  const needsWarningAck = warningIssues.length > 0 && !acknowledgedWarnings

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleWbsNode = (id: string) => {
    setSelectedWbsNodes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTask = (id: string) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleRiskHint = (id: string) => {
    setSelectedRiskHints((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAcceptAll = () => {
    if (needsWarningAck) {
      setConfirmAction('all')
      setShowConfirmDialog(true)
      return
    }
    onAcceptAll()
  }

  const handleAcceptPartial = () => {
    if (needsWarningAck) {
      setConfirmAction('partial')
      setShowConfirmDialog(true)
      return
    }
    onAcceptPartial({
      wbsNodeIds: Array.from(selectedWbsNodes),
      taskIds: Array.from(selectedTasks),
      acceptanceIds: [],
      riskHintIds: Array.from(selectedRiskHints),
    })
  }

  const handleConfirmDialog = () => {
    setShowConfirmDialog(false)
    setAcknowledgedWarnings(true)
    if (confirmAction === 'all') onAcceptAll()
    else if (confirmAction === 'partial') {
      onAcceptPartial({
        wbsNodeIds: Array.from(selectedWbsNodes),
        taskIds: Array.from(selectedTasks),
        acceptanceIds: [],
        riskHintIds: Array.from(selectedRiskHints),
      })
    }
  }

  const startEdit = (path: string, currentValue: string) => {
    setEditingField(path)
    setEditValue(currentValue)
  }

  const submitEdit = () => {
    if (editingField) {
      // 只把该字段改动暂存到本地草案，保留继续编辑其他字段；不触发导入。
      onApplyEdit(editingField, editValue)
    }
    setEditingField(null)
  }

  const allWbsIds = useMemo(() => {
    const ids: string[] = []
    const walk = (nodes: ProjectDraftWbsNode[]) => {
      for (const n of nodes) {
        ids.push(n.id)
        walk(n.children)
      }
    }
    walk(draft.wbs)
    return ids
  }, [draft.wbs])

  const allTaskIds = useMemo(() => draft.tasks.map((t) => t.id), [draft.tasks])

  const selectAllWbs = () => setSelectedWbsNodes(new Set(allWbsIds))
  const selectAllTasks = () => setSelectedTasks(new Set(allTaskIds))

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-ai" aria-hidden />
            <h2 className="text-xl font-semibold text-heading">草案审查</h2>
          </div>
          <p className="mt-1 text-sm text-gray-600">AI 生成的草案须经人工确认才可导入正式项目</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-primary-50 px-2 py-1 text-primary-700">
            {meta.consistency === 'strict'
              ? '结构完整'
              : meta.consistency === 'repairable'
                ? '结构已修复'
                : '低保证'}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600">
            {meta.structuredStrategy}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600">
            {displayedConfidence}% 置信
          </span>
        </div>
      </header>

      <div
        data-draft-quality-provenance
        className="grid gap-3 rounded-[var(--radius-lg)] border border-border bg-gray-50 p-4 text-xs text-gray-600 md:grid-cols-2"
      >
        <div>
          <p className="font-medium text-gray-800">生成来源</p>
          <p className="mt-1">
            {meta.fallbackUsed ? 'Fallback / 离线结果' : '真实模型结果'} · 请求策略{' '}
            {meta.provenance?.requestedStrategy ?? meta.structuredStrategy} · 生效策略{' '}
            {meta.provenance?.effectiveStrategy ?? meta.structuredStrategy}
          </p>
          <p className="mt-1">
            请求模型 {meta.provenance?.requestedModel ?? meta.model} · 响应模型{' '}
            {meta.provenance?.responseModel ?? meta.model}
          </p>
        </div>
        <div>
          <p className="font-medium text-gray-800">阶段产物</p>
          {meta.stages?.length ? (
            <ul className="mt-1 space-y-1">
              {meta.stages.map((stage) => (
                <li key={stage.stage}>
                  {stageLabels[stage.stage]}：{stage.status === 'completed' ? '已完成' : '失败'} ·
                  工具 {stage.allowedTools.length}/2
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">旧版草案未记录阶段产物</p>
          )}
        </div>
      </div>

      {confirmabilityStatus !== 'confirmable' ? (
        <div
          data-draft-confirmability-blocked
          className="rounded-[var(--radius-lg)] border border-danger/30 bg-danger-bg/70 p-4"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
            <div>
              <p className="font-medium text-danger">当前草案不可确认导入</p>
              <ul className="mt-2 space-y-1 text-sm text-danger/90">
                {(meta.confirmability?.reasons.length
                  ? meta.confirmability.reasons
                  : ['草案来源或语义尚未完成服务端验证']
                ).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {blockingIssues.length > 0 ? (
        <div
          className="rounded-[var(--radius-lg)] border border-danger/30 bg-danger-bg/70 p-4"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
            <div className="flex-1">
              <p className="font-medium text-danger">校验未通过，禁止确认导入</p>
              <ul className="mt-2 space-y-1 text-sm text-danger/90">
                {blockingIssues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {warningIssues.length > 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-warning/30 bg-warning-bg/70 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <div className="flex-1">
              <p className="font-medium text-warning">校验警告，建议人工检查</p>
              <ul className="mt-2 space-y-1 text-sm text-warning/90">
                {warningIssues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {infoIssues.length > 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-border bg-gray-50 p-4">
          <div className="flex items-start gap-2">
            <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-gray-500" aria-hidden />
            <div className="flex-1">
              <p className="font-medium text-slate-700">校验提示</p>
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {infoIssues.map((issue, i) => (
                  <li key={`${issue.ruleId}-${i}`} className="flex items-start gap-2">
                    <span className="mt-0.5 rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">
                      {issue.ruleId}
                    </span>
                    <span>
                      {issue.message}
                      {issue.path ? <span className="text-gray-400"> · {issue.path}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {autoFixDiffs.length > 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-primary-200 bg-primary-50/70 p-4">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
            <div className="flex-1">
              <p className="font-medium text-primary-800">自动修正差异</p>
              <div className="mt-2 space-y-2">
                {autoFixDiffs.map((diff, i) => (
                  <div
                    key={`${diff.path}-${i}`}
                    className="rounded border border-primary-200 bg-white p-2 text-xs"
                  >
                    <div className="font-medium text-slate-700">{diff.path}</div>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      <div className="rounded bg-rose-50 px-2 py-1 text-rose-700">
                        {String(diff.before)}
                      </div>
                      <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">
                        {String(diff.after)}
                      </div>
                    </div>
                    <div className="mt-1 text-gray-500">{diff.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
        <Button type="button" disabled={!canConfirm} onClick={handleAcceptAll}>
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          确认导入（全部）
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!canConfirm || selectedTasks.size === 0}
          onClick={handleAcceptPartial}
        >
          <ListChecks className="h-4 w-4" aria-hidden />
          确认导入（所选 {selectedTasks.size}）
        </Button>
        <span className="text-xs text-gray-500">
          行内编辑仅暂存改动，点「确认导入」才会创建正式项目
        </span>
        <Button type="button" variant="ghost" onClick={onRejectRetry}>
          <Trash2 className="h-4 w-4" aria-hidden />
          拒绝重试
        </Button>
        <Button type="button" variant="ghost" onClick={onSaveDraft}>
          <Save className="h-4 w-4" aria-hidden />
          保存草稿
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          返回修改
        </Button>
      </div>

      <div className="space-y-4">
        <CharterSection
          charter={draft.charter}
          expanded={expandedSections.has('charter')}
          onToggle={() => toggleSection('charter')}
          editingField={editingField}
          editValue={editValue}
          onStartEdit={startEdit}
          onEditChange={setEditValue}
          onSubmitEdit={submitEdit}
          onCancelEdit={() => setEditingField(null)}
        />

        <WbsSection
          nodes={draft.wbs}
          expanded={expandedSections.has('wbs')}
          onToggle={() => toggleSection('wbs')}
          selectedIds={selectedWbsNodes}
          onToggleNode={toggleWbsNode}
          selectAll={() => selectAllWbs()}
        />

        <TasksSection
          tasks={draft.tasks}
          dependencies={draft.dependencies}
          expanded={expandedSections.has('tasks')}
          onToggle={() => toggleSection('tasks')}
          selectedIds={selectedTasks}
          onToggleTask={toggleTask}
          selectAll={() => selectAllTasks()}
          editingField={editingField}
          editValue={editValue}
          onStartEdit={startEdit}
          onEditChange={setEditValue}
          onSubmitEdit={submitEdit}
        />

        {expandedSections.has('acceptance') ? (
          <AcceptanceSection criteria={draft.acceptanceCriteria} />
        ) : (
          <SectionCollapsed
            label={moduleLabels.acceptance}
            onExpand={() => toggleSection('acceptance')}
          />
        )}

        {expandedSections.has('resource') ? (
          <ResourceSection hints={draft.resourceHints} />
        ) : (
          <SectionCollapsed
            label={moduleLabels.resource}
            onExpand={() => toggleSection('resource')}
          />
        )}

        {expandedSections.has('risk') ? (
          <RiskSection
            hints={draft.riskHints}
            selectedIds={selectedRiskHints}
            onToggle={toggleRiskHint}
          />
        ) : (
          <SectionCollapsed label={moduleLabels.risk} onExpand={() => toggleSection('risk')} />
        )}

        {expandedSections.has('milestone') ? (
          <MilestoneSection hints={draft.milestoneHints} />
        ) : (
          <SectionCollapsed
            label={moduleLabels.milestone}
            onExpand={() => toggleSection('milestone')}
          />
        )}

        {expandedSections.has('ganttPreview') ? (
          <GanttPreviewSection preview={draft.ganttPreview} />
        ) : (
          <SectionCollapsed
            label={moduleLabels.ganttPreview}
            onExpand={() => toggleSection('ganttPreview')}
          />
        )}

        {meta.planInsights ? (
          <DraftPlanInsightsPanel insights={meta.planInsights} tasks={draft.tasks} />
        ) : null}

        {draft.governance ? <DraftGovernanceSection governance={draft.governance} /> : null}
      </div>

      {showConfirmDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-lg rounded-[var(--radius-xl)] bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-heading">确认操作</h3>
            <p className="mt-2 text-sm text-gray-600">
              {warningIssues.length > 0
                ? `存在 ${warningIssues.length} 项校验警告，请确认已了解以下问题：`
                : '确认执行当前操作？'}
            </p>
            {warningIssues.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-warning">
                {warningIssues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowConfirmDialog(false)}>
                取消
              </Button>
              <Button type="button" onClick={handleConfirmDialog}>
                确认
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SectionCollapsed({ label, onExpand }: { label: string; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-gray-0 px-4 py-3 text-left text-sm text-gray-500 hover:bg-gray-50"
    >
      <Eye className="h-4 w-4" aria-hidden />
      <span>查看 {label}</span>
    </button>
  )
}

function CharterSection({
  charter,
  expanded,
  onToggle,
  editingField,
  editValue,
  onStartEdit,
  onEditChange,
  onSubmitEdit,
  onCancelEdit,
}: {
  charter: ProjectDraft['charter']
  expanded: boolean
  onToggle: () => void
  editingField: string | null
  editValue: string
  onStartEdit: (path: string, value: string) => void
  onEditChange: (value: string) => void
  onSubmitEdit: () => void
  onCancelEdit: () => void
}) {
  const fields: { label: string; path: string; value: string }[] = [
    { label: '项目名称', path: 'charter.title', value: charter.title.value },
    { label: '项目愿景', path: 'charter.vision', value: charter.vision.value },
    { label: '项目范围', path: 'charter.scope', value: charter.scope.value },
    { label: '目标', path: 'charter.objectives', value: charter.objectives.value.join(', ') },
    {
      label: '成功标准',
      path: 'charter.successCriteria',
      value: charter.successCriteria.value.join(', '),
    },
    { label: '开始日期', path: 'charter.startDate', value: charter.startDate.value },
    { label: '结束日期', path: 'charter.endDate', value: charter.endDate.value },
  ]

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <h3 className="font-medium text-heading">项目章程</h3>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {expanded ? (
        <div className="border-t border-border px-4 py-3">
          <dl className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.path} className="rounded-lg bg-gray-50 p-3">
                <dt className="text-xs text-gray-500">{f.label}</dt>
                {editingField === f.path ? (
                  <div className="mt-1 flex gap-2">
                    <input
                      value={editValue}
                      onChange={(e) => onEditChange(e.target.value)}
                      className="min-h-8 min-w-0 flex-1 rounded border border-border px-2 text-sm"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={onSubmitEdit}
                      className="rounded bg-primary-600 px-2 text-xs text-white hover:bg-primary-700"
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      onClick={onCancelEdit}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="group mt-1 flex items-center justify-between gap-2">
                    <dd className="text-sm text-slate-800">{f.value}</dd>
                    <button
                      type="button"
                      onClick={() => onStartEdit(f.path, f.value)}
                      className="shrink-0 opacity-0 group-hover:opacity-100"
                      aria-label={`编辑 ${f.label}`}
                    >
                      <Edit3 className="h-3.5 w-3.5 text-gray-400 hover:text-primary-600" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  )
}

function WbsSection({
  nodes,
  expanded,
  onToggle,
  selectedIds,
  onToggleNode,
  selectAll,
}: {
  nodes: ProjectDraftWbsNode[]
  expanded: boolean
  onToggle: () => void
  selectedIds: Set<string>
  onToggleNode: (id: string) => void
  selectAll: () => void
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <h3 className="font-medium text-heading">WBS 结构（{countNodes(nodes)} 节点）</h3>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {expanded ? (
        <div className="border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={selectAll}
            className="mb-2 text-xs text-primary-600 hover:text-primary-800"
          >
            全选
          </button>
          <ul className="space-y-1">
            {nodes.map((n) => (
              <WbsNodeRow
                key={n.id}
                node={n}
                depth={0}
                selectedIds={selectedIds}
                onToggle={onToggleNode}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function WbsNodeRow({
  node,
  depth,
  selectedIds,
  onToggle,
}: {
  node: ProjectDraftWbsNode
  depth: number
  selectedIds: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <li>
      <label
        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-gray-50"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <input
          type="checkbox"
          checked={selectedIds.has(node.id)}
          onChange={() => onToggle(node.id)}
          className="h-4 w-4 rounded border-gray-300"
        />
        <span className="min-w-[2.5rem] text-xs text-gray-400">{node.outlineCode}</span>
        <span className="text-sm text-slate-800">{node.name.value}</span>
        {node.isNote ? (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">说明</span>
        ) : null}
      </label>
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((c) => (
            <WbsNodeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedIds={selectedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function countNodes(nodes: ProjectDraftWbsNode[]): number {
  let count = 0
  for (const n of nodes) {
    count += 1
    count += countNodes(n.children)
  }
  return count
}

/** 依赖端点的可读标签：优先任务名，找不到（悬空引用）时回退完整 id。 */
function taskLabel(tasks: ProjectDraftTask[], taskId: string): string {
  return tasks.find((task) => task.id === taskId)?.name.value || taskId
}

function TasksSection({
  tasks,
  dependencies,
  expanded,
  onToggle,
  selectedIds,
  onToggleTask,
  selectAll,
  editingField,
  editValue,
  onStartEdit,
  onEditChange,
  onSubmitEdit,
}: {
  tasks: ProjectDraftTask[]
  dependencies: ProjectDraftDependency[]
  expanded: boolean
  onToggle: () => void
  selectedIds: Set<string>
  onToggleTask: (id: string) => void
  selectAll: () => void
  editingField: string | null
  editValue: string
  onStartEdit: (path: string, value: string) => void
  onEditChange: (value: string) => void
  onSubmitEdit: () => void
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <h3 className="font-medium text-heading">
          任务清单（{tasks.length}）· 依赖（{dependencies.length}）
        </h3>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {expanded ? (
        <div className="border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={selectAll}
            className="mb-2 text-xs text-primary-600 hover:text-primary-800"
          >
            全选
          </button>
          <div className="overflow-x-auto rounded border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-1"></th>
                  <th className="px-2 py-1 text-left">名称</th>
                  <th className="px-2 py-1 text-left">工期(天)</th>
                  <th className="px-2 py-1 text-left">开始</th>
                  <th className="px-2 py-1 text-left">结束</th>
                  <th className="px-2 py-1 text-left">负责人</th>
                  <th className="w-10 px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, idx) => {
                  const taskPath = `tasks[${idx}]`
                  return (
                    <tr key={t.id} className={selectedIds.has(t.id) ? 'bg-primary-50' : ''}>
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => onToggleTask(t.id)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </td>
                      <td className="px-2 py-1 font-medium text-slate-800">{t.name.value}</td>
                      <EditableCell
                        path={`${taskPath}.durationDays`}
                        value={String(t.durationDays.value)}
                        editingField={editingField}
                        editValue={editValue}
                        onStartEdit={onStartEdit}
                        onEditChange={onEditChange}
                        onSubmitEdit={onSubmitEdit}
                      />
                      <EditableCell
                        path={`${taskPath}.startDate`}
                        value={t.startDate.value}
                        editingField={editingField}
                        editValue={editValue}
                        onStartEdit={onStartEdit}
                        onEditChange={onEditChange}
                        onSubmitEdit={onSubmitEdit}
                      />
                      <EditableCell
                        path={`${taskPath}.endDate`}
                        value={t.endDate.value}
                        editingField={editingField}
                        editValue={editValue}
                        onStartEdit={onStartEdit}
                        onEditChange={onEditChange}
                        onSubmitEdit={onSubmitEdit}
                      />
                      <EditableCell
                        path={`${taskPath}.assigneeHint`}
                        value={t.assigneeHint.value}
                        editingField={editingField}
                        editValue={editValue}
                        onStartEdit={onStartEdit}
                        onEditChange={onEditChange}
                        onSubmitEdit={onSubmitEdit}
                      />
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          onClick={() => onStartEdit(`${taskPath}.name`, t.name.value)}
                          aria-label="编辑任务"
                        >
                          <Edit3 className="h-3.5 w-3.5 text-gray-400 hover:text-primary-600" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {dependencies.length > 0 ? (
            <div className="mt-3">
              <h4 className="mb-1 text-xs font-medium text-gray-500">任务依赖</h4>
              <div className="flex flex-wrap gap-1.5">
                {dependencies.map((dep) => (
                  <span
                    key={dep.id}
                    title={`${dep.predecessorId} → ${dep.successorId}`}
                    className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
                  >
                    {/* 显示任务名而非截断 id：slice(0, 6) 会把 task-10…task-16 都截成 task-1，看起来像自环依赖。 */}
                    {taskLabel(tasks, dep.predecessorId)} → {taskLabel(tasks, dep.successorId)}
                    {dep.lagDays.value ? ` +${dep.lagDays.value}d` : ''}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function EditableCell({
  path,
  value,
  editingField,
  editValue,
  onStartEdit,
  onEditChange,
  onSubmitEdit,
}: {
  path: string
  value: string
  editingField: string | null
  editValue: string
  onStartEdit: (path: string, value: string) => void
  onEditChange: (value: string) => void
  onSubmitEdit: () => void
}) {
  if (editingField === path) {
    return (
      <td className="px-2 py-1">
        <div className="flex gap-1">
          <input
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            className="min-h-7 min-w-0 w-20 rounded border border-border px-1.5 text-xs"
            autoFocus
          />
          <button
            type="button"
            onClick={onSubmitEdit}
            className="rounded bg-primary-600 px-1.5 text-[10px] text-white"
          >
            确认
          </button>
        </div>
      </td>
    )
  }

  return (
    <td className="group relative px-2 py-1 text-slate-700">
      <span>{value}</span>
      <button
        type="button"
        onClick={() => onStartEdit(path, value)}
        className="ml-1 align-middle opacity-0 group-hover:opacity-100"
        aria-label="编辑"
      >
        <Edit3 className="inline h-3 w-3 text-gray-400 hover:text-primary-600" />
      </button>
    </td>
  )
}

function AcceptanceSection({ criteria }: { criteria: ProjectDraft['acceptanceCriteria'] }) {
  if (!criteria.length) return null
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0 px-4 py-3">
      <h3 className="mb-2 font-medium text-heading">验收标准</h3>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {criteria.map((c) => (
          <li key={c.id}>
            <span className="text-slate-800">{c.statement.value}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ResourceSection({ hints }: { hints: ProjectDraft['resourceHints'] }) {
  if (!hints.length) return null
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0 px-4 py-3">
      <h3 className="mb-2 font-medium text-heading">资源建议</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {hints.map((h) => (
          <div key={h.id} className="rounded-lg bg-gray-50 p-3 text-sm">
            <p className="font-medium text-slate-800">{h.role.value}</p>
            <p className="text-xs text-gray-500">{h.headcount.value} 人</p>
            <p className="text-xs text-gray-500">{h.allocationNote.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function RiskSection({
  hints,
  selectedIds,
  onToggle,
}: {
  hints: ProjectDraft['riskHints']
  selectedIds?: Set<string>
  onToggle?: (id: string) => void
}) {
  if (!hints.length) return null
  const isSelectable = !!onToggle
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0 px-4 py-3">
      <h3 className="mb-2 font-medium text-heading">风险建议</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {hints.map((h) => (
          <div
            key={h.id}
            className={cn(
              'rounded-lg p-3 text-sm',
              isSelectable && selectedIds?.has(h.id)
                ? 'bg-primary-50 border border-primary-200'
                : 'bg-gray-50',
            )}
          >
            <div className="flex items-center gap-2">
              {isSelectable && (
                <input
                  type="checkbox"
                  checked={selectedIds?.has(h.id) ?? false}
                  onChange={() => onToggle(h.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
              )}
              <span className="font-medium text-slate-800">{h.description.value}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px]',
                  h.level.value === 'high'
                    ? 'bg-rose-50 text-rose-700'
                    : h.level.value === 'medium'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-emerald-50 text-emerald-700',
                )}
              >
                {h.level.value}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">{h.mitigation.value}</p>
            {h.trigger?.value || h.ownerRole?.value || h.strategy?.value ? (
              <p className="mt-1 text-xs text-gray-500">
                {[
                  h.trigger?.value ? `触发：${h.trigger.value}` : null,
                  h.ownerRole?.value ? `责任：${h.ownerRole.value}` : null,
                  h.strategy?.value ? `策略：${riskStrategyLabel(h.strategy.value)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function MilestoneSection({ hints }: { hints: ProjectDraft['milestoneHints'] }) {
  if (!hints.length) return null
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0 px-4 py-3">
      <h3 className="mb-2 font-medium text-heading">里程碑建议</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {hints.map((h) => (
          <div key={h.id} className="rounded-lg bg-gray-50 p-3 text-sm">
            <p className="font-medium text-slate-800">{h.name.value}</p>
            <p className="text-xs text-gray-500">{h.targetDate.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function GanttPreviewSection({ preview }: { preview: ProjectDraft['ganttPreview'] }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0 px-4 py-3">
      <h3 className="mb-2 font-medium text-heading">甘特预览摘要</h3>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-gray-50 p-2">
          <dt className="text-xs text-gray-500">开始</dt>
          <dd className="font-medium text-slate-800">{preview.startDate.value}</dd>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <dt className="text-xs text-gray-500">结束</dt>
          <dd className="font-medium text-slate-800">{preview.endDate.value}</dd>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <dt className="text-xs text-gray-500">总工期</dt>
          <dd className="font-medium text-slate-800">{preview.totalDurationDays.value} 天</dd>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <dt className="text-xs text-gray-500">阶段数</dt>
          <dd className="font-medium text-slate-800">{preview.phaseCount}</dd>
        </div>
      </dl>
    </div>
  )
}
