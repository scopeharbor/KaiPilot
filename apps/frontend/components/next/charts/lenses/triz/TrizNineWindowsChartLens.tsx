'use client'

import * as React from 'react'
import { Bookmark, RotateCcw, Sparkles } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import {
  trizGalleryApi,
  type TrizNineWindowsCellDraft,
  type TrizNineWindowsPrefillDraft,
} from '@/lib/api/triz-gallery'

export interface TrizNineWindowsChartLensProps {
  projectId: number
}

interface CellData {
  key: string
  timeAxis: 'past' | 'present' | 'future'
  levelAxis: 'supersystem' | 'system' | 'subsystem'
  timeLabel: string
  levelLabel: string
  prompt: string
  text: string
  locked: boolean
  source?: string
}

// 平民化系统层级定义（spec：超系统 → 外部环境 / 市场 / 组织；子系统 → 组件 / 模块 / 角色）
const TIME_AXES: readonly { id: 'past' | 'present' | 'future'; label: string }[] = [
  { id: 'past', label: '过去 (Past)' },
  { id: 'present', label: '现在 (Present)' },
  { id: 'future', label: '未来 (Future)' },
]

const LEVEL_AXES: readonly {
  id: 'supersystem' | 'system' | 'subsystem'
  label: string
  desc: string
}[] = [
  {
    id: 'supersystem',
    label: '外部环境 / 市场 / 组织',
    desc: '宏观环境、上下游生态、行业规范与组织约束',
  },
  {
    id: 'system',
    label: '当前系统',
    desc: '系统本体、主要业务流程与核心交付物',
  },
  {
    id: 'subsystem',
    label: '组件 / 模块 / 角色',
    desc: '内部子模块、依赖库、执行人员与角色单元',
  },
]

// 确定性默认模板（防空画布冷启动兜底）
function makeDefaultTemplate(): CellData[] {
  return [
    {
      key: 'past.supersystem',
      timeAxis: 'past',
      levelAxis: 'supersystem',
      timeLabel: '过去',
      levelLabel: '外部环境 / 市场 / 组织',
      prompt: '过去的外部环境与行业先例',
      text: '过去采用传统瀑布式项目管理，依赖线下对齐，跨团队沟通链路长。',
      locked: false,
    },
    {
      key: 'present.supersystem',
      timeAxis: 'present',
      levelAxis: 'supersystem',
      timeLabel: '现在',
      levelLabel: '外部环境 / 市场 / 组织',
      prompt: '当前的外部环境、组织制度与生态约束',
      text: '当前推进数字化与敏捷协同，多项目并行，交付周期压缩，对齐成本激增。',
      locked: false,
    },
    {
      key: 'future.supersystem',
      timeAxis: 'future',
      levelAxis: 'supersystem',
      timeLabel: '未来',
      levelLabel: '外部环境 / 市场 / 组织',
      prompt: '未来的外部演化趋势与长期组织期望',
      text: '未来期望实现全链路自动化风险雷达与智能化治理，协同阻力接近零。',
      locked: false,
    },
    {
      key: 'past.system',
      timeAxis: 'past',
      levelAxis: 'system',
      timeLabel: '过去',
      levelLabel: '当前系统',
      prompt: '系统的历史版本与早期形态',
      text: '系统初代功能单一，模块紧耦合，单体部署，改动牵一发而动全身。',
      locked: false,
    },
    {
      key: 'present.system',
      timeAxis: 'present',
      levelAxis: 'system',
      timeLabel: '现在',
      levelLabel: '当前系统',
      prompt: '【中心锁定】当前核心痛点与主要矛盾',
      text: '【核心痛点】需求变更频繁导致计划滑移，交付速度与质量稳定性产生冲突。',
      locked: true,
    },
    {
      key: 'future.system',
      timeAxis: 'future',
      levelAxis: 'system',
      timeLabel: '未来',
      levelLabel: '当前系统',
      prompt: '系统理想化最终结果 (IFR)',
      text: '系统具备自适应解耦与弹性扩缩能力，变更影响面收敛在局部。',
      locked: false,
    },
    {
      key: 'past.subsystem',
      timeAxis: 'past',
      levelAxis: 'subsystem',
      timeLabel: '过去',
      levelLabel: '组件 / 模块 / 角色',
      prompt: '早期内部组件与分工方式',
      text: '早期依赖人工编写脚本与单兵作战，缺乏自动化测试与标准化接口。',
      locked: false,
    },
    {
      key: 'present.subsystem',
      timeAxis: 'present',
      levelAxis: 'subsystem',
      timeLabel: '现在',
      levelLabel: '组件 / 模块 / 角色',
      prompt: '当前关键组件状态与资源负荷',
      text: '核心开发模块承担过多职责，关键路径上人员过载，自动化测试覆盖率待提升。',
      locked: false,
    },
    {
      key: 'future.subsystem',
      timeAxis: 'future',
      levelAxis: 'subsystem',
      timeLabel: '未来',
      levelLabel: '组件 / 模块 / 角色',
      prompt: '未来组件自治与工具协同形态',
      text: '组件微服务化/标准化，AI Copilot 承担常规校验，释放人员专注核心解耦。',
      locked: false,
    },
  ]
}

export function TrizNineWindowsChartLens({ projectId }: TrizNineWindowsChartLensProps) {
  const { can } = usePermissions()
  const canManage = can('diagram:manage')

  const [cells, setCells] = React.useState<CellData[]>(makeDefaultTemplate())
  const [templateCells, setTemplateCells] = React.useState<CellData[]>(makeDefaultTemplate())
  const [isDirty, setIsDirty] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [existingArtifactId, setExistingArtifactId] = React.useState<number | null>(null)
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null)
  const [sourcePath, setSourcePath] = React.useState<'saved' | 'ai' | 'rule' | 'template'>(
    'template',
  )

  // 未保存离开防护
  React.useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // 初始化加载：先查是否已有保存的九屏幕分馆产物，若有则回显；若无则调预填端点
  React.useEffect(() => {
    let active = true
    setLoading(true)

    async function loadData() {
      try {
        const artifactsList = await trizGalleryApi.listArtifacts(projectId, {
          artifactType: 'nine_windows',
        })
        if (!active) return

        if (artifactsList.data && artifactsList.data.length > 0) {
          const current = artifactsList.data[0]!
          setExistingArtifactId(current.id)
          const savedCells = (current.content?.cells as CellData[]) || []
          if (savedCells.length > 0) {
            setCells(savedCells)
            setTemplateCells(savedCells)
            setSourcePath('saved')
            setIsDirty(false)
            setLoading(false)
            return
          }
        }

        // 无保存产物，尝试拉取预填草案
        const draft = await trizGalleryApi.getPrefillDraft<TrizNineWindowsPrefillDraft>(
          projectId,
          'nine_windows',
        )
        if (!active) return

        if (draft && draft.cells && draft.cells.length > 0) {
          const formatted: CellData[] = draft.cells.map((c: TrizNineWindowsCellDraft) => ({
            key: c.key,
            timeAxis: c.timeAxis,
            levelAxis: c.levelAxis,
            timeLabel: c.timeLabel,
            levelLabel: c.levelLabel,
            prompt: c.prompt,
            text: c.text,
            locked: c.locked,
            source: c.source,
          }))
          setCells(formatted)
          setTemplateCells(formatted)
          setSourcePath(draft.path)
        }
      } catch {
        // 预填异常时默认已持有确定性模板，空画布冷启动不存在
      } finally {
        if (active) setLoading(false)
      }
    }

    loadData()
    return () => {
      active = false
    }
  }, [projectId])

  // 编辑单格文本（纯本地状态更新，零网络写请求）
  const handleCellChange = (key: string, newText: string) => {
    setCells((prev) => prev.map((cell) => (cell.key === key ? { ...cell, text: newText } : cell)))
    setIsDirty(true)
    setSaveStatus('idle')
    setSaveMessage(null)
  }

  // 清空单格
  const handleClearCell = (key: string) => {
    handleCellChange(key, '')
  }

  // 重置为初始模板/预填
  const handleResetTemplate = () => {
    setCells(templateCells)
    setIsDirty(false)
    setSaveStatus('idle')
    setSaveMessage('已重置为初始脚手架模板')
  }

  // 显式保存产物
  const handleSave = async () => {
    if (!canManage) return
    setSaveStatus('saving')
    setSaveMessage(null)

    try {
      const payload = {
        artifactType: 'nine_windows' as const,
        content: {
          cells,
          centerKey: 'present.system',
          filledCells: cells.filter((c) => c.text.trim().length > 0).length,
          savedAt: new Date().toISOString(),
        },
      }

      if (existingArtifactId) {
        await trizGalleryApi.updateArtifact(projectId, existingArtifactId, payload)
      } else {
        const created = await trizGalleryApi.createArtifact(projectId, payload)
        setExistingArtifactId(created.id)
      }

      setIsDirty(false)
      setSaveStatus('saved')
      setSaveMessage('九屏幕已显式落库保存')
    } catch {
      setSaveStatus('error')
      setSaveMessage('保存失败，请稍后重试')
    }
  }

  return (
    <div
      data-triz-nine-windows-lens
      className="flex h-full flex-col gap-4 overflow-y-auto p-4 lg:p-6 bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]"
    >
      {/* 顶部工具栏 */}
      <header
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--nx-text-primary)]">
              九屏幕空间推演 (3×3 矩阵)
            </span>
            <span
              data-nine-windows-source-badge
              className="rounded bg-[var(--nx-accent-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--nx-accent)] flex items-center gap-1"
            >
              <Sparkles className="h-3 w-3" />
              <span>
                {sourcePath === 'saved'
                  ? '已加载已存版本'
                  : sourcePath === 'ai'
                    ? 'AI 预填脚手架 (~80%)'
                    : '确定性模板预填'}
              </span>
            </span>
          </div>

          {isDirty && (
            <span
              data-unsaved-badge
              className="rounded bg-[var(--nx-status-warning)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--nx-status-warning)] animate-pulse"
            >
              未保存修改
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleResetTemplate}
            disabled={loading || saveStatus === 'saving'}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2.5 text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)] transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            <span>重置模板</span>
          </button>

          {canManage ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saveStatus === 'saving' || !isDirty}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-[var(--nx-accent)] px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Bookmark className="h-3 w-3" />
              <span>{saveStatus === 'saving' ? '正在保存...' : '保存九屏幕'}</span>
            </button>
          ) : (
            <span
              data-permission-neutral-hint
              className="text-xs text-[var(--nx-text-muted)] italic"
            >
              当前账号仅具只读权限，保存入口已隐藏
            </span>
          )}

          {saveMessage && (
            <span
              className={`text-xs ${saveStatus === 'saved' ? 'text-[var(--nx-status-success)]' : 'text-[var(--nx-status-danger)]'}`}
            >
              {saveMessage}
            </span>
          )}
        </div>
      </header>

      {/* 未保存离开警告条 */}
      {isDirty && (
        <div
          data-unsaved-warning-banner
          data-export-ignore="true"
          className="flex items-center justify-between rounded border border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/10 px-4 py-2 text-xs text-[var(--nx-status-warning)]"
        >
          <span>提示：当前存在未保存的文本编辑，离开前请记得点击「保存九屏幕」以免内容丢失。</span>
        </div>
      )}

      {/* 3×3 九屏幕网格容器 */}
      <section
        aria-label="九屏幕分析矩阵"
        className="flex-1 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 flex flex-col gap-3"
      >
        <div className="grid grid-cols-4 gap-3 text-xs font-semibold text-[var(--nx-text-muted)] pb-2 border-b border-[var(--nx-border-hairline)]">
          <div className="text-center self-center">系统层级 \ 时间轴</div>
          {TIME_AXES.map((t) => (
            <div key={t.id} className="text-center font-medium text-[var(--nx-text-primary)]">
              {t.label}
            </div>
          ))}
        </div>

        {LEVEL_AXES.map((lvl) => (
          <div key={lvl.id} className="grid grid-cols-4 gap-3 min-h-[140px]">
            {/* 纵轴层级标签（平民化平替） */}
            <div className="flex flex-col justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3">
              <span className="font-semibold text-xs text-[var(--nx-text-primary)]">
                {lvl.label}
              </span>
              <span className="text-[11px] text-[var(--nx-text-muted)] mt-1 leading-relaxed">
                {lvl.desc}
              </span>
            </div>

            {/* 该层级下 3 个时间段卡片 */}
            {TIME_AXES.map((time) => {
              const cellKey = `${time.id}.${lvl.id}`
              const cell = cells.find((c) => c.key === cellKey)
              const isCenter = cellKey === 'present.system'

              return (
                <div
                  key={cellKey}
                  data-nine-window-cell={cellKey}
                  className={`flex flex-col rounded-md border p-3 transition-colors ${
                    isCenter
                      ? 'border-[var(--nx-accent)] bg-[var(--nx-accent-subtle)]/30'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="text-[11px] font-semibold text-[var(--nx-text-muted)] flex items-center gap-1">
                      {isCenter ? (
                        <span className="rounded bg-[var(--nx-accent)] px-1.5 py-0.2 text-[10px] text-white">
                          核心格
                        </span>
                      ) : null}
                      <span>{cell?.prompt || `${time.label} × ${lvl.label}`}</span>
                    </span>
                    {!isCenter && cell?.text && (
                      <button
                        type="button"
                        data-export-ignore="true"
                        onClick={() => handleClearCell(cellKey)}
                        className="text-[10px] text-[var(--nx-text-muted)] hover:text-[var(--nx-status-danger)]"
                      >
                        清空
                      </button>
                    )}
                  </div>

                  <textarea
                    value={cell?.text ?? ''}
                    onChange={(e) => handleCellChange(cellKey, e.target.value)}
                    placeholder="请输入推演描述..."
                    className="flex-1 w-full resize-none rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-2 text-xs leading-relaxed text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)]/50 focus:border-[var(--nx-accent)] focus:outline-none"
                    rows={4}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </section>
    </div>
  )
}

export default TrizNineWindowsChartLens
