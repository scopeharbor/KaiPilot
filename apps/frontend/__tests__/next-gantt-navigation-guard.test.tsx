/**
 * v3-ui-next-gantt-lens tasks 3.5 —— 双通道未保存离开拦截守卫与模态框测试。
 *
 * 覆盖（spec「放弃试算回滚与未保存离开守卫拦截」+ design D8 三层架构）：
 * - 通道一 beforeunload：未保存变更存在时 preventDefault，无变更时不拦截；
 * - 通道二-2 全局 <a> 捕获：内部链接点击被原地拦截弹出 `data-what-if-leave-dialog`，
 *   router.push 不触发；控制键（metaKey）与新标签页（target=_blank）放行；
 * - 通道二-1 镜头切换：requestLensSwitch 在未保存变更时原位阻断返回 false，
 *   放弃并离开后执行 onLensSelect 放行切换；
 * - 通道二-3 popstate：后退被 history.pushState 抵消并弹模态框；
 * - 模态框两选项：「留在当前页面」保留沙盒毫发无损；「放弃并离开」销毁 session 后放行。
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useGanttNavigationGuard } from '@/hooks/use-gantt-navigation-guard'
import { WorkspaceGanttLeaveDialog } from '@/components/next/gantt/WorkspaceGanttLeaveDialog'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import type { GanttRenderTask } from '@/lib/gantt/types'
import type { ProjectSpaceLensId } from '@/components/next/project-space/LensSwitcher'

const { routerPush, routerBack } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerBack: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, back: routerBack }),
}))

const TASKS: readonly GanttRenderTask[] = [
  {
    id: 1,
    name: '支付网关联调',
    wbsCode: '2.1',
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay: 0,
    durationDays: 5,
    progress: 0,
    status: 'in_progress',
  },
]

function makeUnsavedChange() {
  useWhatIfSessionStore.getState().enterSession(TASKS, [], null, 'v1')
  useWhatIfSessionStore.getState().executeCommand({
    kind: 'move-task',
    taskId: 1,
    newStartDate: '2026-01-10',
  })
}

function discard() {
  useWhatIfSessionStore.getState().discardSession()
}

function GuardHarness({ onLensSelect }: { onLensSelect?: (lensId: ProjectSpaceLensId) => void }) {
  const guard = useGanttNavigationGuard({ onLensSelect })
  const session = useWhatIfSessionStore((s) => s.session)
  return (
    <div>
      <a data-testid="internal-link" href="/next">
        回首页
      </a>
      <a data-testid="external-link" href="https://example.com/out">
        外链
      </a>
      <a data-testid="blank-link" href="/next/blank" target="_blank">
        新标签页
      </a>
      <button data-testid="switch-lens" onClick={() => guard.requestLensSwitch('kanban')}>
        切到看板
      </button>
      <button data-testid="stay-btn" onClick={guard.stay}>
        留在当前页面（直接调用）
      </button>
      <span data-testid="status">{session.status}</span>
      <span data-testid="has-unsaved">{String(session.hasUnsavedChanges)}</span>
      <span data-testid="pending-label">{guard.pendingLabel ?? '无'}</span>
      {guard.dialogOpen ? (
        <WorkspaceGanttLeaveDialog
          open
          navigationLabel={guard.pendingLabel}
          onStay={guard.stay}
          onDiscardAndLeave={guard.discardAndLeave}
        />
      ) : null}
    </div>
  )
}

function dialog() {
  return document.querySelector('[data-what-if-leave-dialog]')
}

describe('useGanttNavigationGuard / WorkspaceGanttLeaveDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    routerPush.mockClear()
    routerBack.mockClear()
    discard()
    // 历史栈归一：撤销测试内 pushState 的影响
    window.history.replaceState(null, '', window.location.href)
  })

  test('通道一：beforeunload 仅在未保存变更时触发原生拦截', () => {
    render(<GuardHarness onLensSelect={() => undefined} />)

    // 无变更：不拦截
    const idleEvent = new Event('beforeunload', { cancelable: true })
    const idleSpy = vi.spyOn(idleEvent, 'preventDefault')
    window.dispatchEvent(idleEvent)
    expect(idleSpy).not.toHaveBeenCalled()

    // 制造未保存变更：拦截
    act(() => makeUnsavedChange())
    const blockingEvent = new Event('beforeunload', { cancelable: true })
    const blockingSpy = vi.spyOn(blockingEvent, 'preventDefault')
    window.dispatchEvent(blockingEvent)
    expect(blockingSpy).toHaveBeenCalled()

    // 放弃后：不再拦截
    act(() => discard())
    const afterDiscardEvent = new Event('beforeunload', { cancelable: true })
    const afterDiscardSpy = vi.spyOn(afterDiscardEvent, 'preventDefault')
    window.dispatchEvent(afterDiscardEvent)
    expect(afterDiscardSpy).not.toHaveBeenCalled()
  })

  test('通道二-2：内部链接点击被拦截弹出模态框，沙盒与路由均不受影响', () => {
    render(<GuardHarness onLensSelect={() => undefined} />)
    act(() => makeUnsavedChange())

    fireEvent.click(screen.getByTestId('internal-link'))
    expect(dialog()).not.toBeNull()
    expect(screen.getByTestId('pending-label').textContent).toContain('/next')
    // 链接导航被 preventDefault：router 未介入
    expect(routerPush).not.toHaveBeenCalled()
    // 沙盒数据原样保留
    expect(screen.getByTestId('status').textContent).toBe('active')
    expect(screen.getByTestId('has-unsaved').textContent).toBe('true')
  })

  test('模态框「留在当前页面」：关闭模态框，沙盒毫发无损', () => {
    render(<GuardHarness onLensSelect={() => undefined} />)
    act(() => makeUnsavedChange())
    fireEvent.click(screen.getByTestId('internal-link'))
    expect(dialog()).not.toBeNull()

    fireEvent.click(document.querySelector('[data-leave-dialog-stay]')!)
    expect(dialog()).toBeNull()
    expect(screen.getByTestId('status').textContent).toBe('active')
    expect(screen.getByTestId('has-unsaved').textContent).toBe('true')
    expect(routerPush).not.toHaveBeenCalled()
  })

  test('模态框「放弃并离开」：销毁 session 后放行 router.push', () => {
    render(<GuardHarness onLensSelect={() => undefined} />)
    act(() => makeUnsavedChange())
    fireEvent.click(screen.getByTestId('internal-link'))
    expect(dialog()).not.toBeNull()

    fireEvent.click(document.querySelector('[data-leave-dialog-discard]')!)
    expect(dialog()).toBeNull()
    expect(screen.getByTestId('status').textContent).toBe('idle')
    expect(screen.getByTestId('has-unsaved').textContent).toBe('false')
    expect(routerPush).toHaveBeenCalledWith('/next')
  })

  test('外链同样拦截并展示目标地址', () => {
    render(<GuardHarness onLensSelect={() => undefined} />)
    act(() => makeUnsavedChange())
    fireEvent.click(screen.getByTestId('external-link'))
    expect(dialog()).not.toBeNull()
    expect(screen.getByTestId('pending-label').textContent).toContain('https://example.com/out')
  })

  test('控制键组合与新标签页链接放行（不弹模态框）', () => {
    render(<GuardHarness onLensSelect={() => undefined} />)
    act(() => makeUnsavedChange())

    fireEvent.click(screen.getByTestId('internal-link'), { metaKey: true })
    expect(dialog()).toBeNull()

    fireEvent.click(screen.getByTestId('blank-link'))
    expect(dialog()).toBeNull()
  })

  test('通道二-1：镜头切换受控拦截——阻断时弹模态框并暂存目标镜头', () => {
    const onLensSelect = vi.fn()
    render(<GuardHarness onLensSelect={onLensSelect} />)
    act(() => makeUnsavedChange())

    fireEvent.click(screen.getByTestId('switch-lens'))
    expect(dialog()).not.toBeNull()
    expect(screen.getByTestId('pending-label').textContent).toBe('看板')
    expect(onLensSelect).not.toHaveBeenCalled()

    // 放弃并离开 → 销毁 session 后放行镜头切换
    fireEvent.click(document.querySelector('[data-leave-dialog-discard]')!)
    expect(screen.getByTestId('status').textContent).toBe('idle')
    expect(onLensSelect).toHaveBeenCalledWith('kanban')
  })

  test('通道二-1：无未保存变更时 requestLensSwitch 直接放行；留在当前页面不放行切换', () => {
    const onLensSelect = vi.fn()
    render(<GuardHarness onLensSelect={onLensSelect} />)

    // 无变更：直接放行，无模态框
    fireEvent.click(screen.getByTestId('switch-lens'))
    expect(dialog()).toBeNull()
    expect(onLensSelect).not.toHaveBeenCalled()

    // 有变更：阻断 → 选择「留在当前页面」→ 不放行切换，沙盒保留
    act(() => makeUnsavedChange())
    fireEvent.click(screen.getByTestId('switch-lens'))
    expect(dialog()).not.toBeNull()
    fireEvent.click(document.querySelector('[data-leave-dialog-stay]')!)
    expect(dialog()).toBeNull()
    expect(onLensSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('status').textContent).toBe('active')
  })

  test('通道二-3：popstate 后退被 pushState 抵消并弹出模态框', () => {
    render(<GuardHarness onLensSelect={() => undefined} />)
    act(() => makeUnsavedChange())

    const lengthBefore = window.history.length
    fireEvent(window, new Event('popstate'))
    expect(dialog()).not.toBeNull()
    // 抵消回退：当前 URL 被重新压栈
    expect(window.history.length).toBe(lengthBefore + 1)
    expect(screen.getByTestId('pending-label').textContent).toBe('上一页')

    // 放弃并离开：销毁 session 后放行回退
    fireEvent.click(document.querySelector('[data-leave-dialog-discard]')!)
    expect(screen.getByTestId('status').textContent).toBe('idle')
    expect(dialog()).toBeNull()
  })

  test('无 pending 导航时直接调用 stay 幂等安全', () => {
    render(<GuardHarness onLensSelect={() => undefined} />)
    act(() => makeUnsavedChange())
    fireEvent.click(screen.getByTestId('stay-btn'))
    expect(dialog()).toBeNull()
    expect(screen.getByTestId('status').textContent).toBe('active')
    expect(routerPush).not.toHaveBeenCalled()
  })
})
