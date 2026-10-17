/**
 * OKR Objective Detail Drawer 组件（v3-okr-hierarchy-management tasks 6.7）。
 *
 * 职责：
 *   - 展示 Objective 详情（title、scope、status、progress、confidence）
 *   - KR 列表 + 进度编辑器
 *   - Evidence 列表（低敏摘要）
 *   - Alignment 编辑
 *   - 确认/取消状态
 *
 * 设计：抽屉式面板，支持从 OKR workbench 树节点点击打开。
 */

'use client'

import { useState } from 'react'
import type {
  OkrObjective,
  OkrKeyResult,
  OkrEvidenceLink,
  OkrAlignment,
  OkrRollupResult,
} from '@aiproj/types'
import { cn } from '@/lib/utils'

export interface OkrDetailDrawerProps {
  objective: OkrObjective & {
    rollup?: OkrRollupResult
    keyResults?: OkrKeyResult[]
    evidence?: OkrEvidenceLink[]
    alignments?: OkrAlignment[]
  }
  open: boolean
  onClose: () => void
  onKrProgressUpdate?: (krId: number, value: number) => Promise<void>
  readOnly?: boolean
}

export function OkrDetailDrawer({
  objective,
  open,
  onClose,
  onKrProgressUpdate,
  readOnly,
}: OkrDetailDrawerProps) {
  const [editingKrId, setEditingKrId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!open) return null

  const statusLabels: Record<string, string> = {
    draft: '草稿',
    active: '活跃',
    paused: '暂停',
    completed: '已完成',
    archived: '已归档',
  }
  const confidenceLabels: Record<string, string> = {
    high: '高',
    medium: '中',
    low: '低',
  }
  const scopeLabels: Record<string, string> = {
    organization: '组织',
    team: '团队',
    project: '项目',
    individual: '个人',
  }

  async function handleKrSave(krId: number) {
    if (!onKrProgressUpdate) return
    const value = Number(editValue)
    if (isNaN(value)) {
      setError('请输入有效数值')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await onKrProgressUpdate(krId, value)
      setSuccess('进度已更新')
      setEditingKrId(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '更新失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-y-0 right-0 w-full max-w-lg bg-background border-l shadow-xl z-50 overflow-y-auto"
      data-testid="okr-detail-drawer"
    >
      {/* Header */}
      <div className="sticky top-0 bg-background border-b p-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold truncate flex-1">{objective.title}</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Meta */}
        <div className="flex gap-2 flex-wrap text-xs">
          <span className="px-2 py-1 bg-muted rounded">
            {scopeLabels[objective.scope] ?? objective.scope}
          </span>
          <span
            className={cn(
              'px-2 py-1 rounded text-white',
              objective.status === 'active'
                ? 'bg-green-600'
                : objective.status === 'draft'
                  ? 'bg-gray-500'
                  : objective.status === 'paused'
                    ? 'bg-amber-500'
                    : objective.status === 'completed'
                      ? 'bg-blue-600'
                      : 'bg-red-600',
            )}
          >
            {statusLabels[objective.status] ?? objective.status}
          </span>
          <span className="px-2 py-1 bg-muted rounded">
            置信度: {confidenceLabels[objective.confidence]}
          </span>
          <span className="px-2 py-1 bg-muted rounded">进度: {objective.progress}%</span>
        </div>

        {/* Description */}
        {objective.description && (
          <p className="text-sm text-muted-foreground">{objective.description}</p>
        )}

        {/* Rollup */}
        {objective.rollup && (
          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            {objective.rollup.sourceCount} 个源 · {objective.rollup.restrictedCount} 个受限
            {objective.rollup.warnings.length > 0 &&
              objective.rollup.warnings.map((w, i) => (
                <span key={i} className="block text-amber-600">
                  {w.message}
                </span>
              ))}
          </div>
        )}

        {/* Error / Success */}
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</div>
        )}
        {success && <div className="text-sm text-green-700 bg-green-50 p-2 rounded">{success}</div>}

        {/* Key Results */}
        {objective.keyResults && objective.keyResults.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">关键结果</h3>
            <div className="space-y-2">
              {objective.keyResults.map((kr) => (
                <div key={kr.id} className="border rounded p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{kr.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {kr.currentValue}/{kr.targetValue} ({kr.measurementType})
                    </span>
                  </div>
                  {editingKrId === kr.id ? (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="number"
                        className="border rounded px-2 py-1 text-sm w-24"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="新值"
                        disabled={saving || readOnly}
                      />
                      <button
                        className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
                        onClick={() => handleKrSave(kr.id)}
                        disabled={saving || readOnly}
                      >
                        {saving ? '保存中...' : '保存'}
                      </button>
                      <button
                        className="px-3 py-1 border rounded text-sm"
                        onClick={() => {
                          setEditingKrId(null)
                          setError(null)
                        }}
                        disabled={saving}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    !readOnly && (
                      <button
                        className="mt-1 text-xs text-primary hover:underline"
                        onClick={() => {
                          setEditingKrId(kr.id)
                          setEditValue(String(kr.currentValue))
                          setError(null)
                        }}
                      >
                        编辑进度
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Evidence */}
        {objective.evidence && objective.evidence.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">证据引用</h3>
            <div className="space-y-1">
              {objective.evidence.map((ev) => (
                <div key={ev.id} className="text-xs text-muted-foreground flex justify-between">
                  <span>
                    [{ev.sourceKind}] {ev.summary}
                  </span>
                  <span className="text-muted-foreground/60">{ev.hash.slice(0, 6)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alignments */}
        {objective.alignments && objective.alignments.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">对齐关系</h3>
            <div className="text-xs text-muted-foreground space-y-1">
              {objective.alignments.map((al) => (
                <div key={al.id}>
                  child={al.childObjectiveId} → parent={al.parentObjectiveId}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Read-only note */}
        {readOnly && (
          <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
            您只有查看权限，无法编辑。
          </div>
        )}
      </div>
    </div>
  )
}
