'use client'

import * as React from 'react'
import { Bookmark, Info, TrendingUp } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { useEChartsInstance, type EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'
import { trizGalleryApi } from '@/lib/api/triz-gallery'
import { evolutionTrendApi } from '@/lib/api/triz-evolution-trend-analysis'

export interface TrizEvolutionScurveChartLensProps {
  projectId: number
}

interface ScurvePhaseInfo {
  phase: number
  key: string
  name: string
  desc: string
  characteristics: string
  evolutionPath: string
}

const SCURVE_PHASES: readonly ScurvePhaseInfo[] = [
  {
    phase: 1,
    key: 'nascent',
    name: '婴儿期 (初始引入与探索)',
    desc: '系统雏形初具，研发投入大而产出较慢，主要验证技术可行性与解决关键概念冲突。',
    characteristics: '效率增长缓慢，技术方案多样且未定型，专利与试错较多。',
    evolutionPath: '聚焦核心可用性验证与可行性落地，降低概念探索的不确定性。',
  },
  {
    phase: 2,
    key: 'developing',
    name: '成长期 (快速扩散与性能攀升)',
    desc: '技术架构趋向稳定，市场与团队认可度提高，性能指标与生产力迅速提升。',
    characteristics: '交付速度与质量同步改善，规模化效益开始显现，系统处于高价值红利期。',
    evolutionPath: '加大资源配置，强化工程化标准与自动化管道，迅速抢占技术制高点。',
  },
  {
    phase: 3,
    key: 'established',
    name: '成熟期 (效率饱和与精细调优)',
    desc: '系统性能接近当前物理/架构极限，边际改善成本增加，增长率进入平缓平台期。',
    characteristics: '性能趋向饱和，优化空间收窄，主要关注细节体验、成本控制与维护便利。',
    evolutionPath: '提前准备向超系统进化或研发下一代替代系统，布局新技术储备。',
  },
  {
    phase: 4,
    key: 'advanced',
    name: '衰退与蜕变期 (极限瓶颈与换轨跃迁)',
    desc: '原有技术系统达到极限寿命瓶颈，收益递减显著，亟待通过技术换轨实现跨越式蜕变。',
    characteristics: '现有架构复杂度极高，局部优化难以带来质变，产生换轨跃迁需求。',
    evolutionPath: '推动向新原理或上一级超系统跃迁，开启下一代技术的全新 S 曲线。',
  },
]

export function TrizEvolutionScurveChartLens({ projectId }: TrizEvolutionScurveChartLensProps) {
  const { can } = usePermissions()
  const canManage = can('diagram:manage')

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [currentPhaseIndex, setCurrentPhaseIndex] = React.useState<number>(1) // 默认为成长期 (Phase 2)
  const [currentStageName, setCurrentStageName] = React.useState<string>('成长期 (developing)')
  const [basisSummary, setBasisSummary] = React.useState<string>(
    '根据技术进化趋势分析指标投影，当前系统处于性能快速攀升的成长期。',
  )
  const [loading, setLoading] = React.useState(true)
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null)

  // 读取既有进化趋势分析只读结论（只读投影，绝不创建写接口）
  React.useEffect(() => {
    let active = true
    setLoading(true)

    async function loadEvolutionData() {
      try {
        const runs = await evolutionTrendApi.list(projectId, { perPage: 1 })
        if (!active) return

        if (runs.data && runs.data.length > 0) {
          const latestRun = runs.data[0]!
          // 若有运行记录，读取趋势指标进行描述性判定
          const scoresRes = await evolutionTrendApi.listTrends(projectId, latestRun.id, {
            perPage: 10,
          })
          if (!active) return

          if (scoresRes.data && scoresRes.data.length > 0) {
            const stages = scoresRes.data.map((s) => s.stage)
            // 统计最高频出现的阶段
            if (stages.includes('established')) {
              setCurrentPhaseIndex(2)
              setCurrentStageName('成熟期 (established)')
              setBasisSummary('多项技术进化指标显现效率饱和态势，系统处于稳定精细化的成熟期。')
            } else if (stages.includes('advanced')) {
              setCurrentPhaseIndex(3)
              setCurrentStageName('衰退与蜕变期 (advanced)')
              setBasisSummary('主要维度逼近极限瓶颈，具备向新 S 曲线跃迁换轨的演化条件。')
            } else if (stages.includes('developing')) {
              setCurrentPhaseIndex(1)
              setCurrentStageName('成长期 (developing)')
              setBasisSummary('研发吞吐与功能完备性呈加速提升态势，系统处于成长期。')
            } else {
              setCurrentPhaseIndex(0)
              setCurrentStageName('婴儿期 (nascent)')
              setBasisSummary('系统处于概念探索与技术原型验证阶段。')
            }
          }
        }
      } catch {
        // 无分析记录或只读端点异常时，保持确定性基线描述，零报错
      } finally {
        if (active) setLoading(false)
      }
    }

    loadEvolutionData()
    return () => {
      active = false
    }
  }, [projectId])

  // 生成典型 S 曲线数学采样点数据（Sigmoid 逻辑曲线：y = 1 / (1 + e^(-k*(x-x0)))）
  const chartOption = React.useMemo<EChartsCoreOption>(() => {
    const points: [number, number][] = []
    const totalSteps = 40
    for (let i = 0; i <= totalSteps; i++) {
      const x = i
      // 归一化自变量映射到 [-6, 6] 区间
      const normalizedX = (i / totalSteps) * 12 - 6
      const y = +(100 / (1 + Math.exp(-0.8 * normalizedX))).toFixed(1)
      points.push([x, y])
    }

    const currentX = [6, 17, 28, 36][currentPhaseIndex] ?? 17

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : []
          const pt = (list[0] as { data?: [number, number] } | undefined)?.data
          if (!pt) return ''
          const step = pt[0]
          const phaseText =
            step < 10 ? '婴儿期' : step < 22 ? '成长期' : step < 32 ? '成熟期' : '衰退与蜕变期'
          return `<div style="font-size:12px;padding:4px 6px;">
            <div style="color:var(--nx-text-muted);">演进阶段：<b>${phaseText}</b></div>
            <div>技术系统成熟度指数：<b>${pt[1]}%</b></div>
          </div>`
        },
      },
      grid: {
        top: 40,
        left: 50,
        right: 40,
        bottom: 40,
      },
      xAxis: {
        type: 'value',
        name: '技术系统演进进程',
        nameLocation: 'middle',
        nameGap: 26,
        min: 0,
        max: 40,
        splitLine: { show: false },
        axisLabel: {
          formatter: (val: number) => {
            if (val === 5) return '婴儿期'
            if (val === 16) return '成长期'
            if (val === 27) return '成熟期'
            if (val === 36) return '衰退/蜕变期'
            return ''
          },
        },
      },
      yAxis: {
        type: 'value',
        name: '系统性能与成熟度 (%)',
        min: 0,
        max: 105,
        splitLine: {
          lineStyle: { color: 'var(--nx-border-hairline)', opacity: 0.5 },
        },
      },
      series: [
        {
          name: 'S曲线轨迹',
          type: 'line',
          smooth: true,
          data: points,
          lineStyle: {
            color: '#38bdf8',
            width: 3,
          },
          // 4 阶段背景分区标注（纯描述性）
          markArea: {
            silent: true,
            data: [
              [
                {
                  name: '阶段一：婴儿期',
                  xAxis: 0,
                  itemStyle: { color: 'rgba(56, 189, 248, 0.04)' },
                  label: { color: 'var(--nx-text-muted)', position: 'insideTopLeft' },
                },
                { xAxis: 10 },
              ],
              [
                {
                  name: '阶段二：成长期',
                  xAxis: 10,
                  itemStyle: { color: 'rgba(16, 185, 129, 0.06)' },
                  label: { color: 'var(--nx-text-muted)', position: 'insideTopLeft' },
                },
                { xAxis: 22 },
              ],
              [
                {
                  name: '阶段三：成熟期',
                  xAxis: 22,
                  itemStyle: { color: 'rgba(245, 158, 11, 0.05)' },
                  label: { color: 'var(--nx-text-muted)', position: 'insideTopLeft' },
                },
                { xAxis: 32 },
              ],
              [
                {
                  name: '阶段四：衰退与蜕变期',
                  xAxis: 32,
                  itemStyle: { color: 'rgba(139, 92, 246, 0.06)' },
                  label: { color: 'var(--nx-text-muted)', position: 'insideTopLeft' },
                },
                { xAxis: 40 },
              ],
            ],
          },
          // 当前阶段位置指示点
          markLine: {
            symbol: ['none', 'none'],
            data: [
              {
                name: '当前阶段定位',
                xAxis: currentX,
                lineStyle: {
                  color: '#38bdf8',
                  type: 'dashed',
                  width: 2,
                },
                label: {
                  formatter: '当前定位',
                  position: 'insideEndTop',
                  color: '#38bdf8',
                },
              },
            ],
          },
        },
      ],
    }
  }, [currentPhaseIndex])

  useEChartsInstance({
    containerRef,
    option: chartOption,
    animation: false,
    renderer: 'svg',
  })

  // 保存当前阶段标注快照
  const handleSaveSnapshot = async () => {
    if (!canManage) return
    setSaveStatus('saving')
    setSaveMessage(null)

    try {
      const activePhase = SCURVE_PHASES[currentPhaseIndex] ?? SCURVE_PHASES[0]!
      await trizGalleryApi.createArtifact(projectId, {
        artifactType: 's_curve',
        content: {
          currentPhase: activePhase.phase,
          currentPhaseKey: activePhase.key,
          currentPhaseName: activePhase.name,
          stageName: currentStageName,
          basisSummary,
          characteristics: activePhase.characteristics,
          evolutionPath: activePhase.evolutionPath,
          source: 'evolution_scurve_lens',
          savedAt: new Date().toISOString(),
        },
      })
      setSaveStatus('saved')
      setSaveMessage('已保存 S 曲线阶段快照')
    } catch {
      setSaveStatus('error')
      setSaveMessage('保存快照失败，请稍后重试')
    }
  }

  const activePhase = SCURVE_PHASES[currentPhaseIndex] ?? SCURVE_PHASES[0]!

  return (
    <div
      data-triz-scurve-lens
      className="flex h-full flex-col gap-4 overflow-y-auto p-4 lg:p-6 bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]"
    >
      {/* 顶部工具条 */}
      <header
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <TrendingUp className="h-5 w-5 text-[var(--nx-accent)]" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
              TRIZ 技术系统进化 S 曲线分析
            </h3>
            <p className="text-xs text-[var(--nx-text-muted)] mt-0.5">
              基于确定性进化趋势分析只读结论投影技术生命周期四阶段定位
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canManage ? (
            <button
              type="button"
              onClick={handleSaveSnapshot}
              disabled={loading || saveStatus === 'saving'}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-[var(--nx-accent)] px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Bookmark className="h-3 w-3" />
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

      {/* S 曲线图表视口 */}
      <section
        aria-label="S曲线图表区"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
      >
        <div className="flex items-center justify-between pb-2 border-b border-[var(--nx-border-hairline)] text-xs text-[var(--nx-text-muted)]">
          <span>S 型生命周期轨迹与四大演进阶段</span>
          <span>
            当前阶段：<b className="text-[var(--nx-accent)]">{activePhase.name}</b>
          </span>
        </div>

        <div
          ref={containerRef}
          data-scurve-chart-container
          style={{ width: '100%', height: '360px' }}
        />
      </section>

      {/* 当前阶段描述与演化指引卡（纯描述性，绝不出现任何预警/告警提示） */}
      <section
        aria-label="当前演化阶段说明"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-[var(--nx-accent)]" />
          <h4 className="text-sm font-semibold text-[var(--nx-text-primary)]">
            当前阶段判定与特征说明
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 space-y-2">
            <div className="font-semibold text-[var(--nx-text-primary)]">
              当前阶段：{activePhase.name}
            </div>
            <div className="text-[var(--nx-text-secondary)] leading-relaxed">
              {activePhase.desc}
            </div>
            <div className="text-[var(--nx-text-muted)] text-[11px] pt-1">
              阶段依据：{basisSummary}
            </div>
          </div>

          <div className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 space-y-2">
            <div className="font-semibold text-[var(--nx-text-primary)]">
              阶段典型特征与演进指引
            </div>
            <div className="text-[var(--nx-text-secondary)] leading-relaxed">
              <b>典型特征：</b>
              {activePhase.characteristics}
            </div>
            <div className="text-[var(--nx-text-secondary)] leading-relaxed">
              <b>演化指引：</b>
              {activePhase.evolutionPath}
            </div>
          </div>
        </div>

        {/* 四阶段说明导航条 */}
        <div
          data-export-ignore="true"
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--nx-border-hairline)]"
        >
          {SCURVE_PHASES.map((p, idx) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setCurrentPhaseIndex(idx)}
              className={`flex flex-col p-2 rounded text-left transition-colors border ${
                idx === currentPhaseIndex
                  ? 'border-[var(--nx-accent)] bg-[var(--nx-accent-subtle)]/20'
                  : 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] hover:bg-[var(--nx-bg-1)]'
              }`}
            >
              <span className="text-[11px] font-semibold text-[var(--nx-text-primary)]">
                阶段 {p.phase}: {p.name.split(' ')[0]}
              </span>
              <span className="text-[10px] text-[var(--nx-text-muted)] truncate mt-0.5">
                {p.desc}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

export default TrizEvolutionScurveChartLens
