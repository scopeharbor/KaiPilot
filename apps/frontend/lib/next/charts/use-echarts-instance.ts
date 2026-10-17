/**
 * ECharts 实例生命周期 hook（v3-ui-next-chart-gallery W2 统计系镜头共用）。
 *
 * - 容器出现且 option 就绪时 `echarts.init`（nx-dark 主题 / SVG 渲染器，
 *   SVG 便于汇出引擎克隆矢量节点），option 变化时 `setOption(notMerge)` 全量替换；
 * - ResizeObserver 驱动容器 resize（jsdom 桩为空实现，安全空转）；
 * - 卸载 / option 置空时 dispose 释放；动画开关（精确档降级）作为实例重建键，
 *   切换精确档后即时定格数据，无残余动效（spec「精确档视觉降级」）。
 *
 * 严禁在镜头组件里直接 import echarts 或手写 init/dispose 生命周期。
 */
'use client'

import { useEffect, useRef, type RefObject } from 'react'
import echarts, { type EChartsCoreOption } from '@/lib/next/echarts-core'
import type { EChartsType } from 'echarts/core'

export interface UseEChartsInstanceParams {
  /** 图表宿主容器（data-* 定位由镜头自身附加）。 */
  containerRef: RefObject<HTMLDivElement | null>
  /** 渲染配置；null 或容器缺失时挂起（组件用空态/骨架兜底）。 */
  option: EChartsCoreOption | null
  /** 渲染器：默认 svg（矢量汇出与零外发光一致）。 */
  renderer?: 'svg' | 'canvas'
  /** 动画开关：precise 档传 false（animation: false 即时定格）。 */
  animation: boolean
  /** nx-dark 主题；一般无需改动。 */
  theme?: string
}

/**
 * 挂载/更新/销毁单一 ECharts 实例。返回当前实例引用（测试经 mock 捕获 setOption）。
 */
export function useEChartsInstance({
  containerRef,
  option,
  renderer = 'svg',
  animation,
  theme = 'nx-dark',
}: UseEChartsInstanceParams): EChartsType | null {
  const instanceRef = useRef<EChartsType | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !option) return

    const instance = echarts.init(container, theme, { renderer })
    instanceRef.current = instance
    instance.setOption({ ...option, animation }, { notMerge: true })

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        const current = instanceRef.current
        if (current && !current.isDisposed()) current.resize()
      })
      observer.observe(container)
    }

    return () => {
      observer?.disconnect()
      const current = instanceRef.current
      instanceRef.current = null
      if (current && !current.isDisposed()) current.dispose()
    }
    // option 引用由镜头 useMemo 稳定化；动画/渲染器变更重建实例。
  }, [containerRef, option, renderer, animation, theme])

  return instanceRef.current
}

export type { EChartsCoreOption }
