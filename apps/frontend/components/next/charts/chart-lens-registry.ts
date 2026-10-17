/**
 * 图表镜头注册表（v3-ui-next-chart-gallery W1 · tasks 1.8 / W5 · 总装接线）。
 *
 * chartId → 镜头组件的唯一装配点：`[chartId]` 路由页只消费本注册表，绝不硬编码
 * 具体镜头组件。W5 总装将全部 7 项 entry 从建设中占位替换为 W2-W4 交付的真实
 * 镜头组件（保持 `ChartLensComponentProps` 契约），页面与目录零改动。
 *
 * ## W2-W4 / W5 接线契约
 *
 * 1. 镜头组件 props 契约（全部镜头统一）：
 *    ```ts
 *    interface ChartLensComponentProps { projectId: number }
 *    ```
 *    组件挂载在 `[data-chart-viewport-slot]` 容器内（导出引擎捕获目标，
 *    ChartLensToolbar 的 exportSlot 由页面注入 ChartExportMenu 并定位该容器）；
 * 2. `exportViewLabel`：汇出文件名的视图描述段（`[项目名]-[视图]-[时间戳]`），
 *    由 [chartId] 页面传入 ChartExportMenu 消费；
 * 3. `interactionMode`：fishbone / risk-register = 'editable'（受控手动编辑，
 *    保存入口在镜头内部工具条），其余 'readonly'（纯只读分析）。
 *
 * RL-14（确定性渲染器）：注册表为静态白名单，禁止运行时注册注入。
 * 注：AON/鱼骨拓扑依赖的 `@xyflow/react/dist/style.css` 由路由页单点导入
 * （[chartId]/page.tsx），此处不重复注入。
 */
import type { ComponentType } from 'react'
import {
  getChartDefinition,
  type PmChartDefinition,
} from '@/lib/next/charts/chart-catalog-metadata'
import { RbsTreeChartLens } from './RbsTreeChartLens'
import { RiskRegisterChartLens } from './RiskRegisterChartLens'
import { AonNetworkChartLens } from './lenses/AonNetworkChartLens'
import { FishboneChartLens } from './lenses/FishboneChartLens'
import { MilestoneTimelineChartLens } from './lenses/MilestoneTimelineChartLens'
import { ResourceLoadChartLens } from './lenses/ResourceLoadChartLens'
import { ScatterPlotChartLens } from './lenses/ScatterPlotChartLens'
import { TrizContradictionMatrixChartLens } from './lenses/triz/TrizContradictionMatrixChartLens'
import { TrizNineWindowsChartLens } from './lenses/triz/TrizNineWindowsChartLens'
import { TrizFunctionAnalysisChartLens } from './lenses/triz/TrizFunctionAnalysisChartLens'
import { TrizEvolutionScurveChartLens } from './lenses/triz/TrizEvolutionScurveChartLens'
import { EvmChartLens } from './lenses/EvmChartLens'
import { BurndownChartLens } from './lenses/BurndownChartLens'
import { ControlChartLens } from './lenses/ControlChartLens'
import { ParetoChartLens } from './lenses/ParetoChartLens'
import { LobChartLens } from './lenses/LobChartLens'
import { RaciMatrixChartLens } from './lenses/RaciMatrixChartLens'
import { RtmMatrixChartLens } from './lenses/RtmMatrixChartLens'
import { StakeholderChartLens } from './lenses/StakeholderChartLens'
import { IssuesChartLens } from './lenses/IssuesChartLens'
import { ObsTreeChartLens } from './lenses/ObsTreeChartLens'
import { CharterChartLens } from './lenses/CharterChartLens'
import { CommunicationPlanChartLens } from './lenses/CommunicationPlanChartLens'

/** 全部镜头组件统一 props 契约（{projectId, ...} 的最小公共面，W5 总装据此接线）。 */
export interface ChartLensComponentProps {
  projectId: number
}

export type ChartLensComponent = ComponentType<ChartLensComponentProps>

/** 镜头交互模式：editable = 受控手动编辑（鱼骨图/风险登记表），readonly = 纯只读分析。 */
export type ChartLensInteractionMode = 'readonly' | 'editable'

export interface ChartLensRegistryEntry {
  /** 与 PM_CHART_DEFINITIONS.id 一致（路由 /charts/:chartId 段） */
  chartId: string
  /** 镜头组件（W5 总装后全部指向 W2-W4 真实渲染器） */
  component: ChartLensComponent
  /** 图表静态元数据（标题/领域/图标/描述等，与目录同源 RL-04） */
  definition: PmChartDefinition
  /** 汇出文件名视图段（W5 ChartExportMenu 消费） */
  exportViewLabel: string
  /** 编辑边界：editable 仅限受控编辑承诺的两项图表 */
  interactionMode: ChartLensInteractionMode
}

const AVAILABLE_LENS_CHART_IDS = [
  'resource-load',
  'risk-register',
  'aon-network',
  'milestone-timeline',
  'fishbone',
  'rbs',
  'scatter-plot',
  'triz-contradiction-matrix',
  'triz-nine-windows',
  'triz-function-analysis',
  'triz-evolution-scurve',
  'evm',
  'burndown',
  'control-chart',
  'pareto',
  'lob',
  'raci',
  'rtm',
  'stakeholder',
  'issues',
  'obs',
  'charter',
  'communication',
] as const

export type ChartLensId = (typeof AVAILABLE_LENS_CHART_IDS)[number]

function buildEntry(
  chartId: ChartLensId,
  component: ChartLensComponent,
  exportViewLabel: string,
  interactionMode: ChartLensInteractionMode,
): ChartLensRegistryEntry {
  const definition = getChartDefinition(chartId)
  if (!definition) {
    throw new Error(`图表馆注册表：缺少 chart-catalog-metadata 定义 "${chartId}"`)
  }
  return { chartId, definition, component, exportViewLabel, interactionMode }
}

export const CHART_LENS_REGISTRY: Record<ChartLensId, ChartLensRegistryEntry> = {
  'resource-load': buildEntry('resource-load', ResourceLoadChartLens, '资源负荷直方图', 'readonly'),
  'risk-register': buildEntry(
    'risk-register',
    RiskRegisterChartLens,
    '风险矩阵与登记表',
    'editable',
  ),
  'aon-network': buildEntry('aon-network', AonNetworkChartLens, 'AON紧前节点网络图', 'readonly'),
  'milestone-timeline': buildEntry(
    'milestone-timeline',
    MilestoneTimelineChartLens,
    '里程碑时间轴泳道',
    'readonly',
  ),
  fishbone: buildEntry('fishbone', FishboneChartLens, '鱼骨图因果分析', 'editable'),
  rbs: buildEntry('rbs', RbsTreeChartLens, '资源分解结构RBS', 'readonly'),
  'scatter-plot': buildEntry('scatter-plot', ScatterPlotChartLens, '工时成本散布图', 'readonly'),
  'triz-contradiction-matrix': buildEntry(
    'triz-contradiction-matrix',
    TrizContradictionMatrixChartLens,
    'TRIZ矛盾矩阵',
    'editable',
  ),
  'triz-nine-windows': buildEntry(
    'triz-nine-windows',
    TrizNineWindowsChartLens,
    '九屏幕分析图',
    'editable',
  ),
  'triz-function-analysis': buildEntry(
    'triz-function-analysis',
    TrizFunctionAnalysisChartLens,
    '功能分析图',
    'editable',
  ),
  'triz-evolution-scurve': buildEntry(
    'triz-evolution-scurve',
    TrizEvolutionScurveChartLens,
    '进化S曲线',
    'readonly',
  ),
  evm: buildEntry('evm', EvmChartLens, '实值管理S曲线与指标', 'readonly'),
  burndown: buildEntry('burndown', BurndownChartLens, '燃尽与燃起时序图', 'readonly'),
  'control-chart': buildEntry('control-chart', ControlChartLens, 'SPC过程控制图', 'readonly'),
  pareto: buildEntry('pareto', ParetoChartLens, '柏拉图分析', 'readonly'),
  lob: buildEntry('lob', LobChartLens, '线条平衡图LOB', 'readonly'),
  raci: buildEntry('raci', RaciMatrixChartLens, '责任分配矩阵RACI', 'readonly'),
  rtm: buildEntry('rtm', RtmMatrixChartLens, '需求追踪矩阵RTM', 'readonly'),
  stakeholder: buildEntry('stakeholder', StakeholderChartLens, '利害关系人登记表', 'readonly'),
  issues: buildEntry('issues', IssuesChartLens, '议题与变更追踪', 'readonly'),
  obs: buildEntry('obs', ObsTreeChartLens, '组织分解结构OBS', 'readonly'),
  charter: buildEntry('charter', CharterChartLens, '项目章程', 'readonly'),
  communication: buildEntry(
    'communication',
    CommunicationPlanChartLens,
    '沟通管理计划',
    'readonly',
  ),
}

export function isChartLensId(chartId: string): chartId is ChartLensId {
  return (AVAILABLE_LENS_CHART_IDS as readonly string[]).includes(chartId)
}

export function getChartLensEntry(chartId: string): ChartLensRegistryEntry | undefined {
  return isChartLensId(chartId) ? CHART_LENS_REGISTRY[chartId] : undefined
}
