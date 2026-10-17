import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { useCopilotStore } from '@/stores/copilot-store'
import { CopilotSidebarPanel } from '@/components/copilot/CopilotSidebarPanel'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/Dialog'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/Sheet'
import { Toaster, toast } from '@/components/ui/Toast'
import { CommandPaletteProvider } from '@/components/layout/CommandPalette'

/**
 * Copilot 面板的层级与焦点互斥（任务 3.10）＋ 拖拽调宽的布局隔离（任务 3.11）。
 *
 * 3.10 的关键不是「面板自己好看」，而是它**不能压住**模态/任务详情抽屉/通知/命令面板，
 * 且这些浮层打开时 `Esc` 只关最上层——面板的 Esc 处理器靠 `defaultPrevented` 让位
 * （Radix `DismissableLayer` 在 capture 阶段 `preventDefault`，故顺序天然正确）。
 *
 * 3.11 的关键是**内容列不参与面板宽度重排**：面板是 `fixed` 覆盖层、AppShell 的 `main`
 * 不绑定面板宽度、甘特视图不订阅 copilot store，因此 1000 任务甘特在拖拽时零重渲染；
 * 加上 rAF 节流（帧内多次 move 只提交一次、且提交最新位置）即无抖动来源。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: '1' }),
  usePathname: () => '/projects/1',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ canAny: () => true, can: () => true, canAll: () => true }),
}))

vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({ data: { data: [] }, isLoading: false }),
}))

/** vitest 的 cwd 即 apps/frontend（与 empty-state-assets.test.tsx 同一读取范式）。 */
const FRONTEND_ROOT = process.cwd()

function readFrontendFile(relative: string): string {
  return readFileSync(path.join(FRONTEND_ROOT, relative), 'utf8')
}

const GLOBALS_CSS = readFrontendFile(path.join('app', 'globals.css'))

/** 读取 z-index 设计令牌的数值（层级断言以令牌为准，不写死数字）。 */
function zToken(name: string): number {
  const match = GLOBALS_CSS.match(new RegExp(`--z-${name}:\\s*(\\d+)`))
  expect(match, `globals.css 缺少 --z-${name}`).toBeTruthy()
  return Number(match![1])
}

function resetCopilot() {
  act(() => {
    useCopilotStore.setState({
      open: false,
      form: 'drawer',
      width: 400,
      draft: '',
      streaming: false,
      streamPhase: 'idle',
      messages: [],
      demoActions: [],
      demoAssumptions: [],
      streamError: null,
    })
  })
  localStorage.clear()
  sessionStorage.clear()
}

function openPanel() {
  act(() => {
    useCopilotStore.setState({ open: true, form: 'drawer' })
  })
}

/** 在当前焦点元素上按 Esc——复现真实事件流（capture 先于 bubble）。 */
function pressEscapeAtFocus() {
  const target = (document.activeElement as HTMLElement | null) ?? document.body
  fireEvent.keyDown(target, { key: 'Escape' })
}

beforeEach(() => {
  resetCopilot()
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
})

afterEach(() => {
  resetCopilot()
  vi.restoreAllMocks()
})

describe('层级与焦点交互（任务 3.10）', () => {
  test('面板 z 值高于顶栏与下拉、低于模态/通知/命令面板（令牌顺序）', () => {
    const dropdown = zToken('dropdown')
    const sticky = zToken('sticky')
    const modalBackdrop = zToken('modal-backdrop')
    const modal = zToken('modal')
    const toastZ = zToken('toast')
    const palette = zToken('command-palette')

    // 抽屉态 = calc(--z-sticky + 1)
    const drawerZ = sticky + 1
    expect(drawerZ).toBeGreaterThan(dropdown)
    expect(drawerZ).toBeGreaterThan(sticky)
    expect(drawerZ).toBeLessThan(modalBackdrop)
    expect(modalBackdrop).toBeLessThan(modal)
    expect(modal).toBeLessThan(toastZ)
    expect(toastZ).toBeLessThan(palette)

    openPanel()
    render(<CopilotSidebarPanel />)
    const panel = document.querySelector('[data-copilot-panel]') as HTMLElement
    expect(panel.className).toContain('z-[calc(var(--z-sticky)+1)]')
    // 全屏专注态提升到模态层（仍低于通知与命令面板）
    act(() => {
      useCopilotStore.getState().setForm('fullscreen')
    })
    expect((document.querySelector('[data-copilot-panel]') as HTMLElement).className).toContain(
      'z-[var(--z-modal)]',
    )
  })

  test('任务详情抽屉（Sheet）覆盖面板，Esc 只关抽屉、面板保持打开', () => {
    function Harness() {
      const [sheetOpen, setSheetOpen] = React.useState(true)
      return (
        <>
          <CopilotSidebarPanel />
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent>
              <SheetTitle>任务详情</SheetTitle>
              <button type="button">抽屉内按钮</button>
            </SheetContent>
          </Sheet>
        </>
      )
    }
    openPanel()
    render(<Harness />)

    const sheet = screen.getByText('任务详情').closest('[class]') as HTMLElement
    expect(sheet).toBeTruthy()
    // Sheet 走 --z-modal，高于面板抽屉层
    expect(document.body.innerHTML).toContain('z-[var(--z-modal)]')

    pressEscapeAtFocus()
    expect(screen.queryByText('任务详情')).not.toBeInTheDocument()
    expect(useCopilotStore.getState().open).toBe(true)

    // 抽屉关闭后，Esc 才轮到面板
    pressEscapeAtFocus()
    expect(useCopilotStore.getState().open).toBe(false)
  })

  test('模态对话框打开时 Esc 只关模态，且不劫持面板内焦点', () => {
    function Harness() {
      const [dialogOpen, setDialogOpen] = React.useState(true)
      return (
        <>
          <CopilotSidebarPanel />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogTitle>确认变更</DialogTitle>
              <button type="button">模态内按钮</button>
            </DialogContent>
          </Dialog>
        </>
      )
    }
    openPanel()
    render(<Harness />)

    expect(screen.getByText('确认变更')).toBeInTheDocument()
    pressEscapeAtFocus()
    expect(screen.queryByText('确认变更')).not.toBeInTheDocument()
    expect(useCopilotStore.getState().open).toBe(true)
  })

  test('面板焦点陷阱不劫持其它浮层内的 Tab', () => {
    function Harness() {
      return (
        <>
          <CopilotSidebarPanel />
          <Dialog open onOpenChange={() => {}}>
            <DialogContent>
              <DialogTitle>层级测试</DialogTitle>
              <button type="button">模态内按钮</button>
            </DialogContent>
          </Dialog>
        </>
      )
    }
    openPanel()
    render(<Harness />)

    const dialogButton = screen.getByText('模态内按钮') as HTMLButtonElement
    act(() => {
      dialogButton.focus()
    })
    expect(document.activeElement).toBe(dialogButton)

    // 面板的 Tab 陷阱只在焦点位于面板首/末元素时接管，浮层内 Tab 不被拉回面板
    fireEvent.keyDown(dialogButton, { key: 'Tab' })
    expect(document.activeElement).toBe(dialogButton)
    const panel = document.querySelector('[data-copilot-panel]') as HTMLElement
    expect(panel.contains(document.activeElement)).toBe(false)
  })

  test('通知气泡层级高于面板，且不夺取焦点、不关闭面板', () => {
    openPanel()
    render(
      <>
        <CopilotSidebarPanel />
        <Toaster />
      </>,
    )
    const panel = document.querySelector('[data-copilot-panel]') as HTMLElement
    const input = screen.getByLabelText('AI Copilot 输入框') as HTMLTextAreaElement
    act(() => {
      input.focus()
    })

    act(() => {
      toast({ variant: 'info', title: '通知气泡', description: '不应抢焦点' })
    })

    expect(screen.getByText('通知气泡')).toBeInTheDocument()
    // Radix Toast Viewport 渲染为 <ol>，z 值走 --z-toast（高于面板抽屉层）
    const viewport = document.querySelector('ol') as HTMLElement | null
    expect(viewport, 'Toast viewport 未渲染').toBeTruthy()
    expect(viewport!.className).toContain('z-[var(--z-toast)]')
    // 面板仍打开、焦点未被通知夺走
    expect(useCopilotStore.getState().open).toBe(true)
    expect(panel.contains(document.activeElement)).toBe(true)
  })

  test('命令面板覆盖面板，Esc 逐层关闭（先命令面板、后 Copilot）', () => {
    openPanel()
    // CommandPalette 的命令清单经 release-trust feature gate 查询发布信任摘要
    // （v3-release-trust-and-evidence-center），测试 harness 需提供 QueryClient。
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommandPaletteProvider>
          <CopilotSidebarPanel />
        </CommandPaletteProvider>
      </QueryClientProvider>,
    )

    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    const paletteDialog = document.querySelector('[role="dialog"]') as HTMLElement | null
    expect(paletteDialog, '命令面板未打开').toBeTruthy()
    expect(paletteDialog!.className).toContain('z-[var(--z-command-palette)]')
    expect(useCopilotStore.getState().open).toBe(true)

    pressEscapeAtFocus()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useCopilotStore.getState().open).toBe(true)

    pressEscapeAtFocus()
    expect(useCopilotStore.getState().open).toBe(false)
  })
})

describe('拖拽调宽的布局隔离与节流（任务 3.11）', () => {
  /**
   * 拖拽：按下把手 → 若干 pointermove → 抬起。rAF 由调用方控制冲刷。
   * jsdom 无 `PointerEvent` 构造器，故用带 `clientX` 的 MouseEvent 派发 pointer 事件名
   * （React 只按事件名匹配，不做 instanceof 校验）。
   */
  function beginDrag(startClientX: number) {
    const handle = document.querySelector('[data-copilot-resize-handle]') as HTMLElement
    expect(handle).toBeTruthy()
    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: startClientX, bubbles: true }))
    })
  }

  function movePointer(clientX: number) {
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX, bubbles: true }))
    })
  }

  function endDrag() {
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
  }

  test('帧内多次 pointermove 只提交一次宽度，且落在最新位置', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    openPanel()
    render(<CopilotSidebarPanel />)
    expect(useCopilotStore.getState().width).toBe(400)

    beginDrag(1000)
    for (let i = 1; i <= 20; i += 1) {
      movePointer(1000 - i * 2) // 逐步左拖 → 宽度递增
    }
    // 一帧内 20 次 move 只排一次 rAF；未冲刷前宽度不变（不是逐事件重排）
    expect(frames.length).toBe(1)
    expect(useCopilotStore.getState().width).toBe(400)

    act(() => {
      frames.splice(0).forEach((cb) => cb(0))
    })
    // 提交最新位置（400 + 40），而非帧内首次位置（402）
    expect(useCopilotStore.getState().width).toBe(440)

    // 抬起时补提最后一次 move，不遗留陈旧一帧
    movePointer(940)
    endDrag()
    expect(useCopilotStore.getState().width).toBe(460)
    // 抬起已取消待提交帧；即使残留回调被冲刷也不会回写旧宽度（pending 已清空）
    act(() => {
      frames.splice(0).forEach((cb) => cb(0))
    })
    expect(useCopilotStore.getState().width).toBe(460)
  })

  test('1000 任务量级视图在拖拽全程零重渲染（面板为 fixed 覆盖层）', () => {
    let heavyRenders = 0
    function HeavyTaskRows({ count }: { count: number }) {
      heavyRenders += 1
      return (
        <div data-heavy-rows>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} data-heavy-row>{`任务 ${i + 1}`}</div>
          ))}
        </div>
      )
    }

    openPanel()
    render(
      <>
        <HeavyTaskRows count={1000} />
        <CopilotSidebarPanel />
      </>,
    )
    expect(document.querySelectorAll('[data-heavy-row]').length).toBe(1000)
    const rendersAfterMount = heavyRenders

    beginDrag(1000)
    for (let i = 1; i <= 10; i += 1) {
      movePointer(1000 - i * 5)
    }
    endDrag()

    expect(useCopilotStore.getState().width).toBeGreaterThan(400)
    // 面板宽度变化不触发内容列重渲染（fixed 覆盖层，不参与文档流）
    expect(heavyRenders).toBe(rendersAfterMount)
    const panel = document.querySelector('[data-copilot-panel]') as HTMLElement
    expect(panel.className).toContain('fixed')
    // 宽度是布局属性：容器不得带过渡
    expect(panel.className).not.toContain('transition')
  })

  test('内容列与甘特视图均不绑定面板宽度（重排源头静态封堵）', () => {
    const appShell = readFrontendFile(path.join('components', 'layout', 'AppShell.tsx'))
    // AppShell 的 main 不读面板宽度变量，否则宽度变化会重排内容列
    expect(appShell).not.toContain('--copilot-panel-width')

    const ganttRoot = path.join(FRONTEND_ROOT, 'components', 'views', 'gantt')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue
        const source = readFileSync(full, 'utf8')
        if (source.includes('copilot-store') || source.includes('--copilot-panel-width')) {
          offenders.push(path.relative(FRONTEND_ROOT, full))
        }
      }
    }
    walk(ganttRoot)
    // 甘特视图不订阅 copilot store → 面板宽度变化不可能触发甘特重渲染
    expect(offenders).toEqual([])
  })
})
