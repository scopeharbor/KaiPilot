/**
 * ECharts 按需引入收敛底座（v3-ui-next-chart-gallery design §1.2 / tasks 1.1）。
 *
 * 包体控制铁律：严禁在任何组件中直接 `import * as echarts from 'echarts'`
 * （全量引入 >1MB 包体膨胀）。所有 ECharts 模块统一从此底座导出：
 *
 * - 统计度量系图表（资源负荷直方图 / 双变量散布图，W2）经本模块取实例与主题；
 * - 注册暗黑控制台 `nx-dark` 主题：绑定 `--nx-*` 令牌色板（RL-15 视觉铁律）；
 * - 只按需注册组件：Bar/Line/Scatter + Grid/Tooltip/Legend/MarkLine/MarkArea/
 *   DataZoom + Canvas/SVG 双渲染器；缺组件由组件编码阶段报错（fail-fast），
 *   绝不静默回退全量。
 */
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  DataZoomComponent,
} from 'echarts/components'
import { SVGRenderer, CanvasRenderer } from 'echarts/renderers'

// 注册所需组件（确定性白名单，禁止在此外新增运行时注册点）
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  DataZoomComponent,
  CanvasRenderer,
  SVGRenderer,
])

// 注册暗黑控制台主题：绑定 --nx-* 令牌色板（next-tokens.css 数值展开）
echarts.registerTheme('nx-dark', {
  backgroundColor: 'transparent',
  color: [
    '#38bdf8', // --nx-chart-1
    '#818cf8', // --nx-chart-2
    '#34d399', // --nx-chart-3
    '#fbbf24', // --nx-chart-4
    '#f87171', // --nx-chart-5
    '#22d3ee', // --nx-chart-6
    '#c084fc', // --nx-chart-7
    '#a3e635', // --nx-chart-8
  ],
  textStyle: {
    color: '#94a3b8', // --nx-text-secondary
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif',
  },
  axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.08)' } },
  splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.04)' } },
})

export default echarts
export type { EChartsCoreOption } from 'echarts/core'
