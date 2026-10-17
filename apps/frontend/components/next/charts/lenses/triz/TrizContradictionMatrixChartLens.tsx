'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Bookmark, Check, Info, Sparkles } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { trizGalleryApi, type TrizGalleryMatrixPrinciplesResult } from '@/lib/api/triz-gallery'
import { TRIZ_39_PARAMETERS, PARAM_BY_NUMBER } from './triz-parameters-data'

export interface TrizContradictionMatrixChartLensProps {
  projectId: number
}

export function TrizContradictionMatrixChartLens({
  projectId,
}: TrizContradictionMatrixChartLensProps) {
  const searchParams = useSearchParams()
  const { can } = usePermissions()
  const canManage = can('diagram:manage')

  // URL query params initialization (e.g. ?improving=9&worsening=25 from dialogue flow)
  const initialImproving = Number(searchParams?.get('improving')) || 9 // default: 交付速度
  const initialWorsening = Number(searchParams?.get('worsening')) || 25 // default: 工期延误

  const [improving, setImproving] = React.useState<number>(
    initialImproving >= 1 && initialImproving <= 39 ? initialImproving : 9,
  )
  const [worsening, setWorsening] = React.useState<number>(
    initialWorsening >= 1 && initialWorsening <= 39 ? initialWorsening : 25,
  )

  const [result, setResult] = React.useState<TrizGalleryMatrixPrinciplesResult | null>(null)
  const [loading, setLoading] = React.useState<boolean>(false)
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null)

  // Fetch principles when improving or worsening changes
  React.useEffect(() => {
    let active = true
    setLoading(true)
    setSaveStatus('idle')
    setSaveMessage(null)

    trizGalleryApi
      .getMatrixPrinciples(projectId, improving, worsening)
      .then((res) => {
        if (active) {
          setResult(res)
          setLoading(false)
        }
      })
      .catch((_err) => {
        if (active) {
          setResult(null)
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [projectId, improving, worsening])

  // Save current parameter pair and principles as snapshot artifact
  const handleSaveSnapshot = async () => {
    if (!canManage || !result) return
    setSaveStatus('saving')
    setSaveMessage(null)

    try {
      const imp = PARAM_BY_NUMBER.get(improving)
      const wor = PARAM_BY_NUMBER.get(worsening)
      await trizGalleryApi.createArtifact(projectId, {
        artifactType: 'contradiction_matrix',
        content: {
          improvingParameter: {
            number: improving,
            nameZh: imp?.nameZh ?? `参数 ${improving}`,
            displayName: imp?.displayName ?? `参数 ${improving}`,
          },
          worseningParameter: {
            number: worsening,
            nameZh: wor?.nameZh ?? `参数 ${worsening}`,
            displayName: wor?.displayName ?? `参数 ${worsening}`,
          },
          matched: result.matched,
          principleNumbers: result.principles.map((p) => p.number),
          principles: result.principles,
          mappings: result.mappings,
          source: 'contradiction_matrix_lens',
          savedAt: new Date().toISOString(),
        },
      })
      setSaveStatus('saved')
      setSaveMessage('已保存为分馆产物快照')
    } catch {
      setSaveStatus('error')
      setSaveMessage('保存快照失败，请稍后重试')
    }
  }

  const improvingMeta = PARAM_BY_NUMBER.get(improving)
  const worseningMeta = PARAM_BY_NUMBER.get(worsening)

  return (
    <div
      data-triz-matrix-lens
      className="flex h-full flex-col gap-5 overflow-y-auto p-4 lg:p-6 bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]"
    >
      {/* 顶部控制栏：参数选择与快照操作 */}
      <header
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-4">
          {/* 改善参数选择器 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="improving-param-select"
              className="text-xs font-semibold text-[var(--nx-status-success)] flex items-center gap-1"
            >
              <span>▲ 想要改善的参数 (Improving)</span>
            </label>
            <select
              id="improving-param-select"
              value={improving}
              onChange={(e) => setImproving(Number(e.target.value))}
              className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-accent)] focus:outline-none"
            >
              {TRIZ_39_PARAMETERS.map((p) => (
                <option key={`imp-${p.number}`} value={p.number}>
                  #{p.number} {p.displayName} ({p.nameZh})
                </option>
              ))}
            </select>
          </div>

          <div className="pt-5 text-[var(--nx-text-muted)]">
            <ArrowRight className="h-4 w-4" aria-hidden />
          </div>

          {/* 恶化参数选择器 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="worsening-param-select"
              className="text-xs font-semibold text-[var(--nx-status-danger)] flex items-center gap-1"
            >
              <span>▼ 发生恶化的参数 (Worsening)</span>
            </label>
            <select
              id="worsening-param-select"
              value={worsening}
              onChange={(e) => setWorsening(Number(e.target.value))}
              className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-accent)] focus:outline-none"
            >
              {TRIZ_39_PARAMETERS.map((p) => (
                <option key={`wor-${p.number}`} value={p.number}>
                  #{p.number} {p.displayName} ({p.nameZh})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 权限受控保存快照入口 */}
        <div className="flex items-center gap-3">
          {canManage ? (
            <button
              type="button"
              onClick={handleSaveSnapshot}
              disabled={loading || saveStatus === 'saving' || !result}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--nx-accent)] px-3 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              <Bookmark className="h-3.5 w-3.5" aria-hidden />
              <span>{saveStatus === 'saving' ? '正在保存...' : '保存快照'}</span>
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

      {/* 参数对解析摘要展示区 */}
      <section
        aria-label="参数对解析摘要"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] pb-3">
          <div className="flex items-center gap-2">
            <span className="rounded bg-[var(--nx-accent-subtle)] px-2 py-0.5 text-xs font-semibold text-[var(--nx-accent)]">
              矛盾参数对交叉分析
            </span>
            <span className="text-xs text-[var(--nx-text-muted)]">
              #{improving} {improvingMeta?.displayName} × #{worsening} {worseningMeta?.displayName}
            </span>
          </div>
          {result?.matched && (
            <span className="inline-flex items-center gap-1 rounded bg-[var(--nx-status-success)]/10 px-2 py-0.5 text-xs text-[var(--nx-status-success)]">
              <Check className="h-3 w-3" />
              <span>命中 {result.principles.length} 条发明原理</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 text-xs">
          <div className="rounded border border-[var(--nx-border-hairline)]/50 p-3 bg-[var(--nx-workspace-surface)]/50">
            <div className="font-medium text-[var(--nx-status-success)] mb-1">
              改善目标: #{improving} {improvingMeta?.displayName} ({improvingMeta?.nameZh})
            </div>
            <div className="text-[var(--nx-text-muted)] leading-relaxed">
              {improvingMeta?.pmMeaning}
            </div>
          </div>
          <div className="rounded border border-[var(--nx-border-hairline)]/50 p-3 bg-[var(--nx-workspace-surface)]/50">
            <div className="font-medium text-[var(--nx-status-danger)] mb-1">
              伴随恶化: #{worsening} {worseningMeta?.displayName} ({worseningMeta?.nameZh})
            </div>
            <div className="text-[var(--nx-text-muted)] leading-relaxed">
              {worseningMeta?.pmMeaning}
            </div>
          </div>
        </div>
      </section>

      {/* 命中原则或空单元中性提示 */}
      <section
        aria-label="推荐发明原理列表"
        className="flex-1 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 flex flex-col gap-4"
      >
        <h4 className="text-sm font-semibold text-[var(--nx-text-primary)] flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          <span>推荐发明原理与落地释义</span>
        </h4>

        {loading ? (
          <div className="flex h-48 items-center justify-center text-xs text-[var(--nx-text-muted)]">
            正在检索 TRIZ 矛盾矩阵知识包...
          </div>
        ) : result && !result.matched ? (
          /* 空单元中性提示（RL-14 / tasks 7.2：空单元中性提示，MUST NOT 报错或呈现为错误） */
          <div
            data-matrix-empty-cell
            className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] p-8 text-center"
          >
            <Info className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
            <p className="text-sm font-medium text-[var(--nx-text-primary)]">
              {result.hint ?? '该组合暂无收录的推荐原则'}
            </p>
            <p className="max-w-md text-xs text-[var(--nx-text-muted)] leading-relaxed">
              阿奇舒勒经典矛盾矩阵中，该特定工程参数交叉对未收录统计意义上的最高频原理。建议尝试调整临近管理参数，或进入
              AI 矛盾求解对话流进行语义映射。
            </p>
          </div>
        ) : result && result.principles.length > 0 ? (
          /* 命中原则卡片网格 */
          <div
            data-matrix-principles-grid
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
          >
            {result.principles.map((principle) => (
              <article
                key={`p-${principle.number}`}
                data-principle-card
                data-principle-number={principle.number}
                className="flex flex-col justify-between rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 transition-all hover:border-[var(--nx-accent)] hover:shadow-sm"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="flex h-6 items-center justify-center rounded bg-[var(--nx-accent)] px-2 text-xs font-bold text-white">
                      #{principle.number}
                    </span>
                    <span className="text-[11px] font-medium text-[var(--nx-text-muted)]">
                      {principle.nameEn}
                    </span>
                  </div>

                  <h5 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                    {principle.displayName} ({principle.nameZh})
                  </h5>

                  <p className="text-xs leading-relaxed text-[var(--nx-text-muted)]">
                    {principle.definition}
                  </p>

                  <div className="rounded bg-[var(--nx-bg-1)] p-2.5 text-xs leading-relaxed text-[var(--nx-text-secondary)] border-l-2 border-[var(--nx-accent)]">
                    <div className="font-medium text-[var(--nx-text-primary)] mb-1">
                      项目管理释义：
                    </div>
                    {principle.pmInterpretation}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {/* 映射场景要点说明 */}
        {result?.mappings && result.mappings.length > 0 && (
          <div className="mt-4 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3">
            <div className="text-xs font-semibold text-[var(--nx-text-primary)] mb-2">
              典型管理场景要点：
            </div>
            {result.mappings.map((m) => (
              <div
                key={m.id}
                className="text-xs text-[var(--nx-text-muted)] leading-relaxed space-y-1 mb-2"
              >
                <div className="font-medium text-[var(--nx-text-primary)]">{m.title}</div>
                <div>{m.scenario}</div>
                {m.recommendations?.map((r, i) => (
                  <div key={i} className="pl-3 text-[11px] text-[var(--nx-text-secondary)]">
                    • {r}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default TrizContradictionMatrixChartLens
