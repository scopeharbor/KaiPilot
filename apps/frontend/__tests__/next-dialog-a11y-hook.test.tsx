/**
 * 弹层无障碍底座 hook 测试（v3-next-track-dialog-a11y-closure · tasks 1.2）。
 *
 * 覆盖 8 例：Escape 关闭 / `canClose` 拒绝不关 / 焦点进容器 / 焦点归还触发元素 /
 * 非最上层不响应（LIFO）/ 无 ref 安全空转 / 卸载清理 / 缺失环境下空转。
 *
 * 环境说明：
 *   - 测试 setup 已把 `requestAnimationFrame` 换成 0ms 宏任务，焦点落点的「延迟 1 帧」用
 *     `flushFrame()` 冲刷；焦点归还是同步的，关闭后立即可断言。
 *   - mock 一律按用例新建（`vi.fn()` 实例不跨用例），无需 `restoreAllMocks`。
 *   - `typeof window === 'undefined'` 分支无法在 jsdom 里渲染验证：React DOM 提交阶段自身会读
 *     `window.event`（实测 `render`/`rerender` 均抛 TypeError）。该分支与环境能力守卫共用
 *     同一个 `isDomReady()`，故本文件以「摘掉 `HTMLElement.prototype.focus`」触发同一守卫。
 */
import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'

/** 冲刷「延迟 1 帧」的焦点落点调度（jsdom 下 rAF = 0ms 宏任务）。 */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

interface DialogProbeProps {
  onClose: () => void
  canClose?: () => boolean
  open?: boolean
  /** `null` = 容器不声明 tabindex，落点应退到第一个可聚焦后代。 */
  containerTabIndex?: number | null
  focusableChild?: boolean
  testId?: string
}

function DialogProbe({
  onClose,
  canClose,
  open = true,
  containerTabIndex = -1,
  focusableChild = false,
  testId = 'probe-dialog',
}: DialogProbeProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDialogA11y({ ref, open, onClose, canClose })
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="测试弹层"
      data-testid={testId}
      {...(containerTabIndex === null ? {} : { tabIndex: containerTabIndex })}
    >
      {focusableChild ? <button type="button">确认</button> : <p>纯信息弹层</p>}
    </div>
  )
}

/** 触发元素 + 受控弹层：验证「打开前记录焦点 / 关闭后归还」的真实调用链。 */
function TriggerProbe({ onDialogClose }: { onDialogClose: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref,
    open,
    onClose: () => {
      setOpen(false)
      onDialogClose()
    },
  })
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开弹层
      </button>
      {open ? (
        <div ref={ref} role="dialog" aria-modal="true" aria-label="触发式弹层" tabIndex={-1}>
          正文
        </div>
      ) : null}
    </>
  )
}

/** ref 始终挂空（调用方漏接 ref）：只验证 hook 不抛错、不抢占焦点。 */
function NoRefProbe({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDialogA11y({ ref, open: true, onClose })
  return (
    <div role="dialog" aria-modal="true" aria-label="无 ref 弹层">
      纯文本
    </div>
  )
}

describe('useDialogA11y', () => {
  it('Escape 关闭：keydown 冒泡到 document 即触发 onClose，其他按键不触发', async () => {
    const onClose = vi.fn()
    const { getByRole } = render(<DialogProbe onClose={onClose} focusableChild />)
    await flushFrame()

    fireEvent.keyDown(getByRole('button', { name: '确认' }), { key: 'Enter' })
    fireEvent.keyDown(getByRole('button', { name: '确认' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('canClose 拒绝时不关：守卫为假保持打开、输入不被提交；放行后再按 Escape 才关闭', async () => {
    const onClose = vi.fn()
    const canClose = vi.fn(() => false)
    const { rerender } = render(<DialogProbe onClose={onClose} canClose={canClose} />)
    await flushFrame()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(canClose).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    rerender(<DialogProbe onClose={onClose} canClose={() => true} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('焦点进容器：容器带 tabIndex=-1 时优先进容器，未声明 tabindex 时退到第一个可聚焦后代', async () => {
    const containerFirst = render(<DialogProbe onClose={vi.fn()} focusableChild />)
    await flushFrame()
    expect(document.activeElement).toBe(containerFirst.getByTestId('probe-dialog'))
    containerFirst.unmount()

    const childFirst = render(
      <DialogProbe onClose={vi.fn()} containerTabIndex={null} focusableChild />,
    )
    await flushFrame()
    expect(document.activeElement).toBe(childFirst.getByRole('button', { name: '确认' }))
    childFirst.unmount()

    // 无可聚焦元素时兜底落在容器本身（不得抛错）
    const plain = render(<DialogProbe onClose={vi.fn()} />)
    await flushFrame()
    expect(document.activeElement).toBe(plain.getByTestId('probe-dialog'))
  })

  it('焦点归还：Escape 关闭后 document.activeElement 回到触发按钮', async () => {
    const onDialogClose = vi.fn()
    const { getByRole } = render(<TriggerProbe onDialogClose={onDialogClose} />)
    const trigger = getByRole('button', { name: '打开弹层' })
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    await flushFrame()
    expect(document.activeElement).toBe(getByRole('dialog'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDialogClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })

  it('非最上层不响应：同页双层只关上层，上层卸载后下层恢复响应', async () => {
    const lowerClose = vi.fn()
    const upperClose = vi.fn()
    const { rerender } = render(
      <>
        <DialogProbe onClose={lowerClose} testId="probe-lower" />
        <DialogProbe onClose={upperClose} testId="probe-upper" />
      </>,
    )
    await flushFrame()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(upperClose).toHaveBeenCalledTimes(1)
    expect(lowerClose).not.toHaveBeenCalled()

    rerender(<DialogProbe onClose={lowerClose} testId="probe-lower" />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(lowerClose).toHaveBeenCalledTimes(1)
    expect(upperClose).toHaveBeenCalledTimes(1)
  })

  it('无 ref 安全空转：ref.current 为空时不抛错、不抢焦点，Escape 仍可关闭', async () => {
    const onClose = vi.fn()
    const activeBefore = document.activeElement
    render(<NoRefProbe onClose={onClose} />)
    await flushFrame()

    expect(document.activeElement).toBe(activeBefore)
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('卸载清理：监听与栈记录一并摘除，卸载后 Escape 不再触发', async () => {
    const firstClose = vi.fn()
    const secondClose = vi.fn()
    render(<DialogProbe onClose={firstClose} testId="probe-first" />)
    const second = render(<DialogProbe onClose={secondClose} testId="probe-second" />)
    await flushFrame()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(secondClose).toHaveBeenCalledTimes(1)
    expect(firstClose).not.toHaveBeenCalled()

    second.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(secondClose).toHaveBeenCalledTimes(1)
    expect(firstClose).toHaveBeenCalledTimes(1)
  })

  it('缺失环境下空转：不依赖 matchMedia，缺焦点能力时整体不响应且不抛错', async () => {
    const onClose = vi.fn()
    const originalMatchMedia = window.matchMedia
    const originalFocus = HTMLElement.prototype.focus
    let degraded = render(<NoRefProbe onClose={vi.fn()} />)

    try {
      // 1) 无 matchMedia：hook 不读该系统能力，Escape 与焦点落点照常
      Reflect.deleteProperty(window, 'matchMedia')
      degraded.unmount()
      degraded = render(<DialogProbe onClose={onClose} />)
      await flushFrame()
      expect(document.activeElement).toBe(degraded.getByTestId('probe-dialog'))
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)

      // 2) 缺焦点能力（环境降级）：不注册监听、不抢占焦点、不抛错
      degraded.unmount()
      const activeBefore = document.activeElement
      Reflect.deleteProperty(HTMLElement.prototype, 'focus')
      degraded = render(<DialogProbe onClose={onClose} />)
      await flushFrame()
      expect(document.activeElement).toBe(activeBefore)
      expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow()
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      degraded.unmount()
      HTMLElement.prototype.focus = originalFocus
      Object.defineProperty(window, 'matchMedia', {
        value: originalMatchMedia,
        configurable: true,
        writable: true,
      })
    }
  })
})
