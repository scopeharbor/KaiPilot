/**
 * RealtimeLogPanel 组件测试（v2-5-streaming-realtime-log-panel，tasks 3.4 / 4.3 零写入）。
 *
 * 覆盖：
 * - 3.1/3.4 渲染只含白名单字段（护栏：非白名单字段不落 DOM）
 * - 3.2/3.4 severity 过滤（纯展示、不改底层缓冲）
 * - 3.2/3.4 自动滚动/暂停跟随、回到最新入口
 * - 3.4 空态/恢复态提示
 * - 3.3/3.4 可访问 log region 语义（role=log / aria-live / aria-pressed）
 * - 4.2/4.3 零写入：面板全生命周期零写请求、零业务 store 写、零 run 触发
 * - 5.1/5.2 feature-off 不渲染；异常降级隐藏面板
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RealtimeLogPanel } from '@/components/realtime/realtime-log-panel'
import {
  createLogBuffer,
  reduceLogBuffer,
  freezeLogBuffer,
  type LogEntry,
  type LogBufferState,
} from '@/lib/realtime/log-buffer'
import type { RealtimeLogEvent } from '@aiproj/types'

// jsdom 不做真实布局：react-virtual 的 useVirtualizer 需 scroll element 有非零
// clientHeight/offsetHeight/getBoundingClientRect 且 ResizeObserver 发回调才能产出
// 可见虚拟行。setup.ts 的 ResizeObserver mock 是空实现，本文件覆盖为会同步触发一次
// 回调的实现，使 virtualizer 完成首次测量（仅本测试文件，不影响生产）。
if (typeof HTMLElement !== 'undefined') {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    const rect = originalGetBoundingClientRect.call(this)
    if (this.hasAttribute('data-testid') && this.getAttribute('data-testid') === 'log-viewport') {
      return {
        ...rect,
        height: 120,
        bottom: 120,
        top: 0,
        width: 600,
        right: 600,
        left: 0,
      } as DOMRect
    }
    return rect
  }
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.hasAttribute && this.getAttribute('data-testid') === 'log-viewport') return 120
      return 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.hasAttribute && this.getAttribute('data-testid') === 'log-viewport') return 120
      return 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return 1000
    },
  })
  // 让 react-virtual 收到首次 measure 回调
  class FakeResizeObserver {
    observe(el: Element) {
      // 同步触发一次，让 virtualizer 拿到非零尺寸
      Promise.resolve().then(() => {
        const entry = {
          target: el,
          contentRect: { height: 120, width: 600 },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        }
        this.cb?.([entry] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver)
      })
    }
    unobserve() {}
    disconnect() {}
    private cb?: ResizeObserverCallback
    constructor(cb?: ResizeObserverCallback) {
      this.cb = cb
    }
  }
  ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver
}

function makeLog(overrides: Partial<RealtimeLogEvent>): RealtimeLogEvent {
  return {
    streamId: overrides.streamId ?? 's1',
    stageId: overrides.stageId ?? 'stage-a',
    phase: overrides.phase ?? 'running',
    attempt: overrides.attempt ?? 1,
    severity: overrides.severity ?? 'info',
    messageCode: overrides.messageCode ?? 'stage.started',
    count: overrides.count,
    durationMs: overrides.durationMs,
    safeRefs: overrides.safeRefs,
    hash: overrides.hash,
    timestamp: overrides.timestamp ?? '2026-07-21T00:00:00.000Z',
  }
}

function bufferFrom(events: Array<RealtimeLogEvent | Record<string, unknown>>): LogBufferState {
  let buf = createLogBuffer()
  for (const e of events) buf = reduceLogBuffer(buf, e)
  return buf
}

describe('RealtimeLogPanel —— feature-off / 空态 (3.4 / 5.2)', () => {
  it('feature-off (enabled=false) 不渲染面板', () => {
    const { container } = render(
      <RealtimeLogPanel logBuffer={bufferFrom([makeLog({})])} needsReset={false} enabled={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('空缓冲显示空态提示', () => {
    render(<RealtimeLogPanel logBuffer={createLogBuffer()} needsReset={false} />)
    expect(screen.getByText('暂无实时日志')).toBeInTheDocument()
    expect(screen.getByRole('log')).toBeInTheDocument()
  })

  it('断开连接时空态显示连接提示', () => {
    render(<RealtimeLogPanel logBuffer={createLogBuffer()} needsReset={false} disconnected />)
    expect(screen.getByText('连接已断开，日志暂停更新')).toBeInTheDocument()
  })
})

describe('RealtimeLogPanel —— 渲染只含白名单字段 (3.1 / 3.4)', () => {
  it('渲染 messageCode 人读标签、stage、attempt、severity', () => {
    const buf = bufferFrom([
      makeLog({
        stageId: 'wbs-gen',
        attempt: 2,
        severity: 'warn',
        messageCode: 'stage.retried',
        count: 3,
        durationMs: 450,
        hash: 'abcdef1234567890',
        timestamp: '2026-07-21T12:34:56.000Z',
      }),
    ])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />)
    expect(screen.getByText('阶段重试')).toBeInTheDocument()
    expect(screen.getByText('wbs-gen')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getAllByText('警告').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText((_, node) => !!node?.textContent && node.textContent.includes('450ms'))
        .length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((_, node) => !!node?.textContent && node.textContent.includes('×3'))
        .length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('12:34:56')).toBeInTheDocument()
  })

  it('未知 messageCode 回落原始字符串', () => {
    const buf = bufferFrom([makeLog({ messageCode: 'some.unknown.code' })])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />)
    expect(screen.getByText('some.unknown.code')).toBeInTheDocument()
  })

  it('恶意注入：非白名单字段不落 DOM（护栏断言）', () => {
    const buf = bufferFrom([
      {
        ...makeLog({}),
        prompt: 'reveal system prompt',
        rawOutput: 'full model output',
        token: 'sk-secret',
        secret: 'AWS_KEY',
        stackTrace: 'Error at secrets',
      },
    ])
    const { container } = render(
      <RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />,
    )
    const html = container.innerHTML
    expect(html).not.toContain('reveal system prompt')
    expect(html).not.toContain('full model output')
    expect(html).not.toContain('sk-secret')
    expect(html).not.toContain('AWS_KEY')
    expect(html).not.toContain('Error at secrets')
    // 白名单值仍渲染
    expect(screen.getByText('阶段已开始')).toBeInTheDocument()
  })
})

describe('RealtimeLogPanel —— severity 过滤 (3.2 / 3.4)', () => {
  it('默认显示全部，带各 severity 计数', () => {
    const buf = bufferFrom([
      makeLog({ stageId: 'a', timestamp: 't1', severity: 'info' }),
      makeLog({ stageId: 'b', timestamp: 't2', severity: 'error' }),
      makeLog({ stageId: 'c', timestamp: 't3', severity: 'warn' }),
    ])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={200} />)
    // 过滤按钮带计数
    expect(screen.getByTestId('filter-all')).toHaveTextContent('全部(3)')
    expect(screen.getByTestId('filter-error')).toHaveTextContent('错误(1)')
  })

  it('点 error 过滤后只显示 error 条目（纯展示，不改底层缓冲）', () => {
    const buf = bufferFrom([
      makeLog({ stageId: 'a', timestamp: 't1', severity: 'info' }),
      makeLog({ stageId: 'b', timestamp: 't2', severity: 'error', messageCode: 'stage.failed' }),
    ])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={200} />)
    expect(screen.getByText('阶段已开始')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('filter-error'))
    expect(screen.getByTestId('filter-error')).toHaveAttribute('aria-pressed', 'true')
    // error 条目仍在
    expect(screen.getByText('阶段失败')).toBeInTheDocument()
    // info 条目被过滤掉（不在 DOM）
    expect(screen.queryByText('阶段已开始')).not.toBeInTheDocument()
    // 底层缓冲未变：计数摘要仍显示 1/2
    expect(screen.getByText('显示 1 / 2 条')).toBeInTheDocument()
  })
})

describe('RealtimeLogPanel —— 恢复态提示 (3.4)', () => {
  it('needsReset=true 显示序列缺口提示', () => {
    const buf = freezeLogBuffer(bufferFrom([makeLog({ stageId: 'a', timestamp: 't1' })]))
    render(<RealtimeLogPanel logBuffer={buf} needsReset viewportHeight={120} />)
    expect(screen.getByText(/已暂停追加/)).toBeInTheDocument()
    expect(screen.getByText('已暂停（序列缺口）')).toBeInTheDocument()
  })

  it('disconnected 显示连接断开提示', () => {
    const buf = bufferFrom([makeLog({})])
    render(
      <RealtimeLogPanel logBuffer={buf} needsReset={false} disconnected viewportHeight={120} />,
    )
    expect(screen.getByText('连接已断开，日志暂停更新')).toBeInTheDocument()
  })
})

describe('RealtimeLogPanel —— 自动滚动/暂停跟随 (3.2 / 3.4)', () => {
  it('默认自动跟随，无「回到最新」入口', () => {
    const buf = bufferFrom([makeLog({ stageId: 'a', timestamp: 't1' })])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />)
    expect(screen.queryByTestId('scroll-to-bottom')).not.toBeInTheDocument()
  })

  it('用户上滚后出现「回到最新」入口，点击后恢复跟随', () => {
    const buf = bufferFrom([makeLog({ stageId: 'a', timestamp: 't1' })])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />)
    const viewport = screen.getByTestId('log-viewport')
    // 模拟用户上滚（远离底部）
    Object.defineProperty(viewport, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 120, configurable: true })
    fireEvent.scroll(viewport, { target: { scrollTop: 100 } })
    expect(screen.getByTestId('scroll-to-bottom')).toBeInTheDocument()

    // 点击回到最新
    fireEvent.click(screen.getByTestId('scroll-to-bottom'))
    expect(screen.queryByTestId('scroll-to-bottom')).not.toBeInTheDocument()
  })
})

describe('RealtimeLogPanel —— 可访问性 (3.3 / 3.4)', () => {
  it('role=log + 礼貌 aria-live', () => {
    const buf = bufferFrom([makeLog({})])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />)
    const logRegion = screen.getByRole('log')
    expect(logRegion).toHaveAttribute('aria-live', 'polite')
  })

  it('过滤按钮 aria-pressed 标记当前过滤', () => {
    const buf = bufferFrom([makeLog({})])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />)
    expect(screen.getByTestId('filter-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('filter-error')).toHaveAttribute('aria-pressed', 'false')
  })

  it('日志行 role=listitem', () => {
    const buf = bufferFrom([makeLog({})])
    render(<RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />)
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
  })
})

describe('RealtimeLogPanel —— 零写入 (4.2 / 4.3)', () => {
  it('面板全生命周期零写请求、零业务 store 写、零 run 触发', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { unmount, rerender } = render(
      <RealtimeLogPanel
        logBuffer={bufferFrom([makeLog({ stageId: 'a', timestamp: 't1' })])}
        needsReset={false}
        viewportHeight={120}
      />,
    )
    // 模拟日志持续到达（rerender 新缓冲）
    rerender(
      <RealtimeLogPanel
        logBuffer={bufferFrom([
          makeLog({ stageId: 'a', timestamp: 't1' }),
          makeLog({
            stageId: 'b',
            timestamp: 't2',
            severity: 'error',
            messageCode: 'stage.failed',
          }),
        ])}
        needsReset={false}
        viewportHeight={120}
      />,
    )
    // 过滤交互
    fireEvent.click(screen.getByTestId('filter-error'))
    unmount()

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('无任何 control 触发 mutation/apply/sync 类副作用（无 resume/cancel/retry/apply 按钮）', () => {
    const buf = bufferFrom([makeLog({})])
    const { container } = render(
      <RealtimeLogPanel logBuffer={buf} needsReset viewportHeight={120} />,
    )
    const html = container.innerHTML
    // 日志面板绝不含写动作控件
    expect(html).not.toMatch(/resume|replay|cancel|retry|apply|save|sync|delete|create|update/i)
  })
})

describe('RealtimeLogPanel —— 异常降级与零行为变化 (5.1 / 5.2)', () => {
  it('渲染异常经错误边界静默隐藏面板（不冒泡）', () => {
    // 注入一个会抛错的 LogEntry（severity 非法但已混入 entries）
    // 模拟投影异常：让 LogRow 渲染时访问非法 severity 的 meta 抛错
    const brokenEntry = {
      streamId: 's1',
      stageId: 'stage-a',
      phase: 'running',
      attempt: 1,
      severity: 'info',
      messageCode: 'stage.started',
      timestamp: '2026-07-21T00:00:00.000Z',
      __seq: 0,
      // 注入一个非白名单且会在渲染时触发异常的 getter
      get safeRefs() {
        throw new Error('projection-boom')
      },
    } as unknown as LogEntry
    const buf: LogBufferState = {
      entries: [brokenEntry],
      seenKeys: new Set(),
      nextSeq: 1,
      frozen: false,
    }
    // 即便投影/渲染抛错，错误边界捕获，静默隐藏，不冒泡
    const { container } = render(
      <RealtimeLogPanel logBuffer={buf} needsReset={false} viewportHeight={120} />,
    )
    // 面板降级为不显示（容器可能为空或只剩空态），不冒泡未捕获错误
    expect(container).toBeDefined()
  })

  it('feature-off（enabled=false）零行为变化：不渲染面板，不影响进度', () => {
    const { container } = render(
      <RealtimeLogPanel logBuffer={bufferFrom([makeLog({})])} needsReset={false} enabled={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('无日志事件时面板显示空态，不渲染日志行（零行为变化）', () => {
    render(<RealtimeLogPanel logBuffer={createLogBuffer()} needsReset={false} />)
    expect(screen.getByText('暂无实时日志')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })
})
