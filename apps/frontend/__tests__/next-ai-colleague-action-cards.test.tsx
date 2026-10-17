/**
 * 写操作两阶段确认与错误防御卡片测试（v3-ui-next-ai-colleague W3 / tasks 3.7）：
 *
 * - ActionPreviewCard：变更 Diff 红绿对比渲染、联动任务与警告/冲突容器；
 * - 确认闭环：点击「确认应用」→ 发起 confirm 请求 → 成功后切换「已成功应用」绿标
 *   （含提交耗时与影响任务数），并触发任务缓存失效（taskKeys.lists(projectId)）；
 * - 放弃闭环：点击「放弃取消」→ 本地销毁置灰，零 confirm 请求发出；
 * - 409 SCHEDULE_STALE 冲突：卡内嵌冷红冲突槽（data-status="conflict"）、
 *   提交按钮锁定、重新演练回调；
 * - AiErrorCard：403 权限拒绝（data-error="forbidden"）、中性 404（RL-05）、
 *   409 冲突（data-error="conflict"）、超时与 5xx 重试呈现。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import {
  ActionPreviewCard,
  type ActionPreviewDiff,
  type ScheduleConflictItem,
} from '@/components/next/ai/cards/ActionPreviewCard'
import { AiErrorCard } from '@/components/next/ai/cards/AiErrorCard'
import { taskKeys } from '@/lib/api/tasks'

// 网络层 Mock（design D6：严禁真实后端/跨网络通信）
vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
  apiFetchEnvelope: vi.fn(),
  apiRawFetch: vi.fn(),
}))

import { apiFetchEnvelope } from '@/lib/api-client'

const mockApiFetchEnvelope = vi.mocked(apiFetchEnvelope)

/** 与后端 ScheduleChange 同构的 Diff 样本：核心任务移 5 天 + 下游联动移 5 天。 */
function previewDiff(): ActionPreviewDiff {
  return {
    changes: [
      {
        taskId: 12,
        taskName: '核心引擎重构',
        before: { startDate: '2026-09-10', endDate: '2026-09-20', durationDays: 9 },
        after: { startDate: '2026-09-15', endDate: '2026-09-25', durationDays: 9 },
        reason: 'direct_move',
        dependencyIds: [],
      },
      {
        taskId: 34,
        taskName: '联调验证',
        before: { startDate: '2026-09-20', endDate: '2026-09-25', durationDays: 4 },
        after: { startDate: '2026-09-25', endDate: '2026-09-30', durationDays: 4 },
        reason: 'dependency',
        dependencyIds: [12],
      },
    ],
    conflicts: [],
    warnings: ['该项目存在里程碑依赖，延后可能影响里程碑验收'],
    affectedTaskIds: [12, 34],
  }
}

beforeEach(() => {
  mockApiFetchEnvelope.mockReset()
})

describe('ActionPreviewCard · Diff 预览呈现', () => {
  test('渲染写操作警示标头、红绿对比日期与诚实微标', () => {
    const { container } = render(
      <ActionPreviewCard toolName="update_task_schedule" diff={previewDiff()} phase="preview" />,
    )

    expect(container.querySelector('[data-card="action-preview"]')).not.toBeNull()
    expect(container.querySelector('[data-preview-warning-tag]')).toHaveTextContent(
      '写操作待确认 · 人工审查',
    )
    expect(container.querySelector('[data-rule-match-badge]')).toHaveTextContent(
      '⚡ 快捷规则匹配 · update_task_schedule',
    )
    expect(screen.getByText('#12 · 核心引擎重构')).toBeInTheDocument()
    expect(screen.getByText('直接移动')).toBeInTheDocument()

    // 原日期删除线 + 目标日期天青色高亮
    const beforeStart = container.querySelector('[data-preview-before-start]')
    expect(beforeStart).toHaveTextContent('2026-09-10')
    expect(beforeStart).toHaveClass('line-through')
    const afterStart = container.querySelector('[data-preview-after-start]')
    expect(afterStart).toHaveTextContent('2026-09-15')
    expect(afterStart).toHaveClass('text-[var(--nx-accent)]')
    expect(container.querySelector('[data-preview-before-end]')).toHaveTextContent('2026-09-20')
    expect(container.querySelector('[data-preview-after-end]')).toHaveTextContent('2026-09-25')

    // 变更幅度：5 天
    expect(screen.getByText('变更幅度：推迟 5 天')).toBeInTheDocument()
  })

  test('渲染下游联动受影响任务与琥珀色警告/冲突容器', () => {
    const diff = previewDiff()
    diff.conflicts = [
      {
        taskId: 34,
        taskName: '联调验证',
        code: 'INBOUND_DEPENDENCY',
        message: '上游任务延后导致本任务无法按原计划开始',
        dependencyIds: [12],
      } satisfies ScheduleConflictItem,
    ]
    const { container } = render(
      <ActionPreviewCard toolName="update_task_schedule" diff={diff} phase="preview" />,
    )

    expect(container.querySelector('[data-preview-linked]')).toHaveTextContent(
      '下游联动受影响任务（1）',
    )
    expect(container.querySelector('[data-preview-linked-list]')).toHaveTextContent(
      '#34 · 联调验证',
    )
    // 联动任务同样推迟 5 天
    expect(container.querySelector('[data-preview-linked-shift]')).toHaveTextContent('推迟 5 天')

    expect(container.querySelector('[data-preview-warnings]')).toHaveTextContent('调度警告')
    expect(container.querySelector('[data-preview-warnings]')).toHaveTextContent(
      '该项目存在里程碑依赖，延后可能影响里程碑验收',
    )
    expect(container.querySelector('[data-preview-conflicts]')).toHaveTextContent('排程冲突提示')
    expect(container.querySelector('[data-preview-conflicts]')).toHaveTextContent(
      '上游任务延后导致本任务无法按原计划开始',
    )
  })

  test('缺省 Diff 结构不崩溃', () => {
    const { container } = render(
      <ActionPreviewCard
        toolName="update_task_schedule"
        diff={{ changes: [], conflicts: [], warnings: [], affectedTaskIds: [] }}
        phase="preview"
      />,
    )
    expect(container.querySelector('[data-preview-empty]')).toHaveTextContent(
      '该预览未包含任务变更明细',
    )
  })
})

describe('ActionPreviewCard · 确认闭环（confirm → 成功 → 缓存失效）', () => {
  test('点击「确认应用」发起 confirm、成功后绿标并失效任务缓存', async () => {
    mockApiFetchEnvelope.mockResolvedValueOnce({
      data: { committed: true },
      meta: { toolName: 'update_task_schedule', committed: true, durationMs: 126 },
    })

    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { container, rerender } = render(
      <ActionPreviewCard
        toolName="update_task_schedule"
        diff={previewDiff()}
        phase="preview"
        onConfirm={async () => {
          // W2/W4 接线：以 previewToken 发起 confirm（网络层已 Mock）
          await apiFetchEnvelope('/api/v1/ai/tools/confirm', {
            method: 'POST',
            body: JSON.stringify({
              toolName: 'update_task_schedule',
              previewToken: 'a'.repeat(64),
              parameters: { projectId: 42, taskId: 12, startDate: '2026-09-15', operation: 'move' },
            }),
          })
          // W4：确认成功后失效任务列表缓存，驱动工作面就地刷新
          await queryClient.invalidateQueries({ queryKey: taskKeys.lists(42) })
          // 上层将卡片切换为已生效绿标
          act(() => {
            rerender(
              <ActionPreviewCard
                toolName="update_task_schedule"
                diff={previewDiff()}
                phase="committed"
                committedMeta={{ durationMs: 126, affectedCount: 2 }}
              />,
            )
          })
        }}
      />,
    )

    fireEvent.click(container.querySelector('[data-preview-confirm]') as HTMLButtonElement)

    // 在途防重点：committing 阶段按钮禁用（上层将执行状态置为 executing）
    act(() => {
      rerender(
        <ActionPreviewCard
          toolName="update_task_schedule"
          diff={previewDiff()}
          phase="committing"
        />,
      )
    })
    expect(container.querySelector('[data-preview-confirm]')).toBeDisabled()
    expect(container.querySelector('[data-preview-cancel]')).toBeDisabled()
    expect(screen.getByText('提交中…')).toBeInTheDocument()

    await waitFor(() => {
      // 提交成功 → 已生效绿标 + 提交耗时 + 影响任务数
      expect(container.querySelector('[data-preview-committed]')).toHaveTextContent('已成功应用')
      expect(container.querySelector('[data-preview-committed]')).toHaveTextContent(
        '提交耗时 126ms',
      )
      expect(container.querySelector('[data-preview-committed]')).toHaveTextContent('影响 2 项任务')
      // 任务缓存已失效（taskKeys.lists(42)）
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['tasks', 'list', 42] }),
      )
    })

    // confirm 端点载荷契约：toolName + previewToken + parameters
    expect(mockApiFetchEnvelope).toHaveBeenCalledWith(
      '/api/v1/ai/tools/confirm',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('previewToken'),
      }),
    )
    expect(mockApiFetchEnvelope.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('"toolName":"update_task_schedule"'),
      }),
    )
  })
})

describe('ActionPreviewCard · 放弃闭环（本地销毁零请求）', () => {
  test('点击「放弃取消」置灰为已放弃且不发任何 confirm 请求', () => {
    const onCancel = vi.fn()
    const { container, rerender } = render(
      <ActionPreviewCard
        toolName="update_task_schedule"
        diff={previewDiff()}
        phase="preview"
        onCancel={onCancel}
      />,
    )

    fireEvent.click(container.querySelector('[data-preview-cancel]') as HTMLButtonElement)
    expect(onCancel).toHaveBeenCalledTimes(1)
    // 绝对零网络写请求（RL-01）
    expect(mockApiFetchEnvelope).not.toHaveBeenCalled()

    // 上层完成本地销毁（store.cancelPendingAction）后切为已放弃中性灰标
    rerender(
      <ActionPreviewCard toolName="update_task_schedule" diff={previewDiff()} phase="cancelled" />,
    )
    expect(container.querySelector('[data-card="action-preview"]')).toHaveAttribute(
      'data-status',
      'cancelled',
    )
    const cancelled = container.querySelector('[data-preview-cancelled]')
    expect(cancelled).toHaveTextContent('已由用户放弃操作 · 未发起任何写请求')
    // 确认/取消按钮均不再呈现
    expect(container.querySelector('[data-preview-confirm]')).toBeNull()
  })

  test('cancelNote 作废说明覆盖默认放弃文案（旧预览被新操作取代场景，修补1）', () => {
    const { container, rerender } = render(
      <ActionPreviewCard toolName="update_task_schedule" diff={previewDiff()} phase="preview" />,
    )
    rerender(
      <ActionPreviewCard
        toolName="update_task_schedule"
        diff={previewDiff()}
        phase="cancelled"
        cancelNote="该预览已被新操作取代，已自动作废"
      />,
    )
    const cancelled = container.querySelector('[data-preview-cancelled]')
    expect(cancelled).toHaveTextContent('该预览已被新操作取代，已自动作废')
    expect(cancelled).not.toHaveTextContent('已由用户放弃操作')
    // 失效卡片无确认入口（决策锁定）
    expect(container.querySelector('[data-preview-confirm]')).toBeNull()
    expect(container.querySelector('[data-preview-cancel]')).toBeNull()
  })
})

describe('ActionPreviewCard · 409 冲突防御', () => {
  test('确认遭遇 SCHEDULE_STALE 时呈现冲突态并锁定提交按钮', async () => {
    mockApiFetchEnvelope.mockRejectedValueOnce(
      Object.assign(new Error('SCHEDULE_STALE'), { status: 409, code: 'SCHEDULE_STALE' }),
    )

    const onRetry = vi.fn()
    const { container, rerender } = render(
      <ActionPreviewCard
        toolName="update_task_schedule"
        diff={previewDiff()}
        phase="preview"
        onConfirm={async () => {
          try {
            await apiFetchEnvelope('/api/v1/ai/tools/confirm', {
              method: 'POST',
              body: JSON.stringify({
                toolName: 'update_task_schedule',
                previewToken: 'b'.repeat(64),
              }),
            })
          } catch {
            // 上层捕获 409，严禁假成功：切换冲突告警态
            act(() => {
              rerender(
                <ActionPreviewCard
                  toolName="update_task_schedule"
                  diff={previewDiff()}
                  phase="conflict"
                  conflictCode="SCHEDULE_STALE"
                  onRetry={onRetry}
                />,
              )
            })
          }
        }}
      />,
    )

    fireEvent.click(container.querySelector('[data-preview-confirm]') as HTMLButtonElement)

    await waitFor(() => {
      expect(container.querySelector('[data-card="action-preview"]')).toHaveAttribute(
        'data-status',
        'conflict',
      )
    })
    const banner = container.querySelector('[data-conflict-banner]')
    expect(banner).toHaveTextContent('排程数据已被他人并发修改或预览已过期（版本冲突 409）')
    expect(banner).toHaveTextContent('错误码 SCHEDULE_STALE')
    // 提交按钮锁定：冲突态下不呈现任何确认入口
    expect(container.querySelector('[data-preview-confirm]')).toBeNull()

    fireEvent.click(container.querySelector('[data-preview-retry]') as HTMLButtonElement)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('冲突态提供「放弃取消」：本地清现场、零请求（修补4c 两按钮可用）', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ActionPreviewCard
        toolName="update_task_schedule"
        diff={previewDiff()}
        phase="conflict"
        conflictCode="SCHEDULE_STALE"
        onCancel={onCancel}
      />,
    )

    expect(container.querySelector('[data-preview-confirm]')).toBeNull()
    const cancelButton = container.querySelector('[data-preview-cancel]') as HTMLButtonElement
    expect(cancelButton).not.toBeNull()
    fireEvent.click(cancelButton)
    expect(onCancel).toHaveBeenCalledTimes(1)
    // 放弃为纯本地动作：零 confirm 请求
    expect(mockApiFetchEnvelope).not.toHaveBeenCalled()
  })
})

describe('AiErrorCard · 权限/404/冲突/网络错误呈现', () => {
  test('403 权限拒绝横幅与管理员申请指引', () => {
    const { container } = render(<AiErrorCard toolName="update_task_schedule" status={403} />)
    expect(container.querySelector('[data-card="error"]')).toHaveAttribute(
      'data-error',
      'forbidden',
    )
    expect(container.querySelector('[data-rule-match-badge]')).toHaveTextContent(
      '⚡ 快捷规则匹配 · update_task_schedule',
    )
    expect(screen.getByText('权限不足 · 操作被拒绝')).toBeInTheDocument()
    expect(screen.getByText(/你缺少执行此操作所需的权限（需具备相应操作授权）/)).toBeInTheDocument()
    expect(screen.getByText(/请联系组织管理员开通相应权限/)).toBeInTheDocument()
    // 权限拒绝不提供重试按钮
    expect(container.querySelector('[data-error-retry]')).toBeNull()
  })

  test('404 中立回显（RL-05）：绝不泄露跨租户信息', () => {
    const { container } = render(
      <AiErrorCard
        toolName="get_project_summary"
        status={404}
        code="PROJECT_NOT_FOUND"
        message="该项目属于其他组织，禁止访问"
      />,
    )
    expect(container.querySelector('[data-card="error"]')).toHaveAttribute(
      'data-error',
      'not_found',
    )
    expect(screen.getByText('未找到指定的项目资源')).toBeInTheDocument()
    // 中性文案，严格屏蔽后端原始消息与跨组织暗示
    expect(screen.queryByText('该项目属于其他组织，禁止访问')).toBeNull()
    expect(screen.queryByText('PROJECT_NOT_FOUND')).toBeNull()
  })

  test('409 冲突呈现冷红警示与重新演练回调', () => {
    const onRetry = vi.fn()
    const { container } = render(
      <AiErrorCard status={409} code="SCHEDULE_STALE" onRetry={onRetry} />,
    )
    expect(container.querySelector('[data-card="error"]')).toHaveAttribute('data-error', 'conflict')
    expect(container.querySelector('[data-card="error"]')).toHaveAttribute(
      'data-status',
      'conflict',
    )
    expect(
      screen.getByText('排程数据已被他人并发修改或预览已过期（版本冲突 409）'),
    ).toBeInTheDocument()
    expect(screen.getByText(/错误码 SCHEDULE_STALE/)).toBeInTheDocument()

    fireEvent.click(container.querySelector('[data-error-retry]') as HTMLButtonElement)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('超时与 5xx：告警 + 重试按钮', () => {
    const onRetryTimeout = vi.fn()
    const { container: timeoutContainer } = render(
      <AiErrorCard status={504} onRetry={onRetryTimeout} />,
    )
    expect(timeoutContainer.querySelector('[data-card="error"]')).toHaveAttribute(
      'data-error',
      'timeout',
    )
    expect(screen.getByText('网络连接超时')).toBeInTheDocument()
    fireEvent.click(timeoutContainer.querySelector('[data-error-retry]') as HTMLButtonElement)
    expect(onRetryTimeout).toHaveBeenCalledTimes(1)

    const { container: serverContainer } = render(<AiErrorCard status={500} onRetry={vi.fn()} />)
    expect(serverContainer.querySelector('[data-card="error"]')).toHaveAttribute(
      'data-error',
      'server_error',
    )
    expect(screen.getByText('服务暂时不可用（HTTP 500）')).toBeInTheDocument()
    expect(screen.getByText('重试')).toBeInTheDocument()
  })

  test('显式 kind 优先于 status 推导，未知异常不崩溃', () => {
    const { container } = render(<AiErrorCard kind="forbidden" status={404} />)
    expect(container.querySelector('[data-card="error"]')).toHaveAttribute(
      'data-error',
      'forbidden',
    )

    const { container: unknownContainer } = render(
      <AiErrorCard status={null} message="自定义服务异常" onRetry={vi.fn()} />,
    )
    expect(unknownContainer.querySelector('[data-card="error"]')).toHaveAttribute(
      'data-error',
      'unknown',
    )
    expect(screen.getByText('自定义服务异常')).toBeInTheDocument()
  })
})
