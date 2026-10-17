/**
 * v3-ui-next-project-space tasks 1.3/1.4 —— 时间主轴 HUD 组件与区间计算测试。
 *
 * 覆盖：过去/今天/未来三区百分比计算（design D3 坐标系算法）、未排期中性兜底、
 * 逾期冷红告警、精确档平整化（光晕归零 + 高对比度文字）与沉浸档微光。
 */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  ProjectTimelineBar,
  computeProjectTimelineMetrics,
  differenceInCalendarDays,
  toDateString,
} from '@/components/next/project-space/ProjectTimelineBar'
import { useNextTrackStore } from '@/stores/next-track-store'

beforeEach(() => {
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
})

afterEach(() => {
  // act 包裹：afterEach 可能与 RTL 自动 cleanup 先后不定，组件仍挂载时重置 store
  // 会触发订阅重渲染，需在 act 内冲刷避免告警。
  act(() => useNextTrackStore.setState({ immersionTier: null }))
  document.documentElement.removeAttribute('data-immersion')
})

describe('computeProjectTimelineMetrics（design D3 坐标系算法）', () => {
  test('周期指定：总跨度含首尾、今天偏移、百分比、剩余天数', () => {
    const metrics = computeProjectTimelineMetrics('2026-09-01', '2026-09-30', '2026-09-09')
    expect(metrics.status).toBe('specified')
    expect(metrics.totalDays).toBe(30)
    expect(metrics.elapsedDays).toBe(8)
    expect(metrics.todayPercent).toBeCloseTo(26.6667, 3)
    expect(metrics.remainingDays).toBe(21)
  })

  test('今天早于起点：百分比钳制 0，剩余天数正常', () => {
    const metrics = computeProjectTimelineMetrics('2026-09-10', '2026-09-30', '2026-09-01')
    expect(metrics.todayPercent).toBe(0)
    expect(metrics.remainingDays).toBe(29)
  })

  test('今天晚于终点：百分比钳制 100，剩余天数为负（逾期）', () => {
    const metrics = computeProjectTimelineMetrics('2026-09-01', '2026-09-05', '2026-09-09')
    expect(metrics.todayPercent).toBe(100)
    expect(metrics.remainingDays).toBe(-4)
  })

  test('起止同日：总跨度 1 天，锚点 0%', () => {
    const metrics = computeProjectTimelineMetrics('2026-09-09', '2026-09-09', '2026-09-09')
    expect(metrics.totalDays).toBe(1)
    expect(metrics.todayPercent).toBe(0)
    expect(metrics.remainingDays).toBe(0)
  })

  test('未设周期：中性兜底，无百分比；endDate 存在时仍给出剩余天数', () => {
    expect(computeProjectTimelineMetrics(null, null, '2026-09-09')).toEqual({
      status: 'unspecified',
      totalDays: null,
      elapsedDays: null,
      todayPercent: null,
      remainingDays: null,
    })
    const oneSide = computeProjectTimelineMetrics('2026-09-01', null, '2026-09-09')
    expect(oneSide.status).toBe('unspecified')
    expect(oneSide.remainingDays).toBeNull()
    expect(computeProjectTimelineMetrics(null, '2026-09-30', '2026-09-09').remainingDays).toBe(21)
  })

  test('日期差与格式化边界（自然日，UTC 零点口径）', () => {
    expect(differenceInCalendarDays('2026-09-30', '2026-09-01')).toBe(29)
    expect(differenceInCalendarDays('2026-03-01', '2026-02-28')).toBe(1)
    expect(differenceInCalendarDays('2026-01-01', '2026-12-31')).toBe(-364)
    expect(toDateString(new Date(2026, 8, 9))).toBe('2026-09-09')
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('ProjectTimelineBar DOM（spec「时间主轴标定过去、今天与未来分区」）', () => {
  test('周期指定：三区语义、今天锚点徽章与宏观度量 HUD', () => {
    const { container } = render(
      <ProjectTimelineBar
        startDate="2026-09-01"
        endDate="2026-09-30"
        progressPercent={35}
        today="2026-09-09"
      />,
    )
    const bar = container.querySelector('[data-timeline-bar]')
    expect(bar?.getAttribute('data-timeline-status')).toBe('specified')

    // 度量 HUD：周期 / 进度 / 剩余天数
    expect(container.querySelector('[data-timeline-period]')?.textContent).toBe(
      '2026-09-01 ~ 2026-09-30',
    )
    expect(container.querySelector('[data-timeline-progress]')?.textContent).toContain('35%')
    const remaining = container.querySelector('[data-timeline-remaining]') as HTMLElement
    expect(remaining?.textContent).toBe('剩余 21 天')
    expect(remaining.getAttribute('data-timeline-overdue')).toBeNull()

    // 三区语义：过去段（暗调）+ 今天锚点 + 未来段
    expect(container.querySelector('[data-timeline-past]')).not.toBeNull()
    expect(container.querySelector('[data-timeline-future]')).not.toBeNull()
    expect(screen.getByText('2026-09-09 今天')).toBeInTheDocument()

    // 位置百分比：today 距起点 8/30 → 26.67%（数据属性稳定暴露，规避浮点样式字符串）
    expect(
      container.querySelector('[data-timeline-axis]')?.getAttribute('data-today-percent'),
    ).toBe('26.67')
    const past = container.querySelector('[data-timeline-past]') as HTMLElement
    expect(Number.parseFloat(past.style.width)).toBeCloseTo(26.67, 1)
  })

  test('未设起止周期：中性虚线兜底 + 居中锚点 + 「未设定起止周期」', () => {
    const { container } = render(
      <ProjectTimelineBar startDate={null} endDate={null} progressPercent={0} today="2026-09-09" />,
    )
    expect(
      container.querySelector('[data-timeline-bar]')?.getAttribute('data-timeline-status'),
    ).toBe('unspecified')
    expect(container.querySelector('[data-timeline-unset]')).not.toBeNull()
    expect(container.querySelector('[data-timeline-past]')).toBeNull()
    expect(container.querySelector('[data-timeline-future]')).toBeNull()
    expect(
      container.querySelector('[data-timeline-axis]')?.getAttribute('data-today-percent'),
    ).toBeNull()
    expect(screen.getByText('未设定起止周期')).toBeInTheDocument()
    expect(screen.getByText('待定 ~ 待定')).toBeInTheDocument()
    expect(screen.getByText('2026-09-09 今天')).toBeInTheDocument()
    const today = container.querySelector('[data-timeline-today]') as HTMLElement
    expect(today.style.left).toBe('50%')
    expect(container.querySelector('[data-timeline-remaining]')).toBeNull()
  })

  test('仅设截止日：周期 HUD 呈现「待定 ~ 截止日」，剩余天数仍计算', () => {
    render(
      <ProjectTimelineBar
        startDate={null}
        endDate="2026-09-30"
        progressPercent={10}
        today="2026-09-09"
      />,
    )
    expect(screen.getByText(/待定 ~ 2026-09-30/)).toBeInTheDocument()
    expect(screen.getByText('剩余 21 天')).toBeInTheDocument()
    expect(
      document.querySelector('[data-timeline-bar]')?.getAttribute('data-timeline-status'),
    ).toBe('unspecified')
  })

  test('逾期：冷红警示徽章「已逾期 X 天」（--nx-status-danger）', () => {
    render(
      <ProjectTimelineBar
        startDate="2026-09-01"
        endDate="2026-09-05"
        progressPercent={80}
        today="2026-09-09"
      />,
    )
    const badge = document.querySelector('[data-timeline-remaining]') as HTMLElement
    expect(badge.textContent).toBe('已逾期 4 天')
    expect(badge.getAttribute('data-timeline-overdue')).toBe('true')
    expect(badge.className).toContain('text-[var(--nx-status-danger)]')
  })

  test('精确档（precise）：光晕归零、刻度实线化、文字高对比度', () => {
    act(() => useNextTrackStore.setState({ immersionTier: 'precise' }))
    const { container } = render(
      <ProjectTimelineBar
        startDate="2026-09-01"
        endDate="2026-09-30"
        progressPercent={35}
        today="2026-09-09"
      />,
    )
    const bar = container.querySelector('[data-timeline-bar]')
    expect(bar?.getAttribute('data-immersion')).toBe('precise')
    const line = container.querySelector('[data-timeline-today-line]') as HTMLElement
    expect(line.className).not.toContain('shadow-[0_0_8px_var(--nx-space-cyan)]')
    expect(line.className).toContain('bg-[var(--nx-space-cyan)]')
    const future = container.querySelector('[data-timeline-future]') as HTMLElement
    expect(future.className).toContain('border-[var(--nx-border-hairline)]')
    expect(future.className).not.toContain('border-dashed')
    const label = container.querySelector('[data-timeline-today-label]') as HTMLElement
    expect(label.className).toContain('text-[var(--nx-text-primary)]')
    // 业务信息 100% 等价：三区与锚点徽章仍在
    expect(container.querySelector('[data-timeline-past]')).not.toBeNull()
    expect(screen.getByText('2026-09-09 今天')).toBeInTheDocument()
    expect(screen.getByText('剩余 21 天')).toBeInTheDocument()
  })

  test('沉浸档：今天锚点呈现电光天青色微光', () => {
    // 默认 store 未手动覆盖 → 合成 immersive
    const { container } = render(
      <ProjectTimelineBar
        startDate="2026-09-01"
        endDate="2026-09-30"
        progressPercent={35}
        today="2026-09-09"
      />,
    )
    const line = container.querySelector('[data-timeline-today-line]') as HTMLElement
    expect(line.className).toContain('shadow-[0_0_8px_var(--nx-space-cyan)]')
    const label = container.querySelector('[data-timeline-today-label]') as HTMLElement
    expect(label.className).toContain('text-[var(--nx-space-cyan)]')
  })

  test('进度钳制：越界百分比不产生非法宽度', () => {
    const { container } = render(
      <ProjectTimelineBar
        startDate="2026-09-01"
        endDate="2026-09-30"
        progressPercent={150}
        today="2026-09-09"
      />,
    )
    expect(container.querySelector('[data-timeline-progress]')?.textContent).toContain('100%')
    expect(container.querySelector('[data-timeline-progress]')?.textContent).not.toContain('150')
  })
})
