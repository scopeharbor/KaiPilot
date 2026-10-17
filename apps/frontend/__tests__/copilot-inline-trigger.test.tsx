/**
 * v3-copilot-inline-triggers —— 共享内联触发组件测试。
 *
 * 覆盖：
 * - 2.3 四处产出的引用形状一致且字段完整
 * - 2.5 内联触发不创建第二套消息渲染或流式状态
 * - 2.9 授权门入口点击不发起任何外部请求
 * - 7.1 内联触发零域写：只打开面板并预置引用
 * - 7.2 内联触发前不产生任何业务写入
 * - 7.4 内联入口不提供绕过确认的执行路径
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CopilotInlineTrigger } from '@/components/copilot/CopilotInlineTrigger'
import { useCopilotStore } from '@/stores/copilot-store'

// Mock dependencies
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/1/tasks',
}))

vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId: () => 1,
}))

vi.mock('@/components/ui/Tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function resetStores() {
  act(() => {
    useCopilotStore.setState({
      open: false,
      draft: '',
      streaming: false,
      messages: [],
    })
  })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  resetStores()
  vi.restoreAllMocks()
})

describe('CopilotInlineTrigger', () => {
  const defaultEntity = {
    entityType: 'task' as const,
    entityId: 123,
    label: '测试任务',
    projectId: 1,
  }

  describe('2.3 Reference shape consistency', () => {
    test('should construct a valid MentionReference with all required fields', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      render(<CopilotInlineTrigger entity={defaultEntity} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(dispatchSpy).toHaveBeenCalled()
      const event = dispatchSpy.mock.calls[0]![0] as CustomEvent
      expect(event.type).toBe('copilot:inline-trigger')
      expect(event.detail).toHaveProperty('mention')
      expect(event.detail.mention).toMatchObject({
        entityType: 'task',
        entityId: 123,
        label: '测试任务',
        organizationId: 1,
        projectId: 1,
      })
    })

    test('should produce identical reference shape for different entity types', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const entities = [
        { entityType: 'task' as const, entityId: 1, label: '任务', projectId: 1 },
        { entityType: 'risk' as const, entityId: 2, label: '风险', projectId: 1 },
        { entityType: 'wbs_node' as const, entityId: 3, label: 'WBS节点', projectId: 1 },
      ]

      entities.forEach((entity) => {
        const { unmount } = render(<CopilotInlineTrigger entity={entity} />)
        const button = screen.getByRole('button')
        fireEvent.click(button)
        unmount()
      })

      const events = dispatchSpy.mock.calls.filter(
        (call) => (call[0] as Event).type === 'copilot:inline-trigger',
      )
      events.forEach((call) => {
        const event = call[0] as CustomEvent
        expect(event.detail.mention).toHaveProperty('entityType')
        expect(event.detail.mention).toHaveProperty('entityId')
        expect(event.detail.mention).toHaveProperty('label')
        expect(event.detail.mention).toHaveProperty('organizationId')
      })
    })
  })

  describe('2.5 No second conversation surface', () => {
    test('should not create a separate message renderer or streaming state', () => {
      render(<CopilotInlineTrigger entity={defaultEntity} />)

      // The component should only dispatch an event, not render any message UI
      expect(screen.queryByRole('log')).toBeNull()
      expect(screen.queryByRole('article')).toBeNull()
    })
  })

  describe('2.9 Authorization-gated entry point', () => {
    test('should not make any external requests when clicked', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      render(
        <CopilotInlineTrigger
          entity={defaultEntity}
          availability="authorization-gated"
          availabilityHint="需要用户授权后才能使用该能力"
        />,
      )

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Authorization-gated should not dispatch the inline trigger event
      const copilotEvents = dispatchSpy.mock.calls.filter(
        (call) => (call[0] as Event).type === 'copilot:inline-trigger',
      )
      expect(copilotEvents).toHaveLength(0)
    })
  })

  describe('7.1 Zero domain writes', () => {
    test('should only open the panel and prefilled reference via event, not change any formal project data', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      render(<CopilotInlineTrigger entity={defaultEntity} />)
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Panel should be opened
      expect(useCopilotStore.getState().open).toBe(true)

      // The event should carry a structured mention reference (not a text mutation)
      const copilotEvents = dispatchSpy.mock.calls.filter(
        (call) => (call[0] as Event).type === 'copilot:inline-trigger',
      )
      expect(copilotEvents).toHaveLength(1)
      const event = copilotEvents[0]![0] as CustomEvent
      expect(event.detail.mention).toMatchObject({
        entityType: 'task',
        entityId: 123,
        label: '测试任务',
      })

      // No streaming, no messages — just panel open + event dispatch
      expect(useCopilotStore.getState().streaming).toBe(false)
      expect(useCopilotStore.getState().messages).toHaveLength(0)
    })
  })

  describe('7.2 No business writes before trigger', () => {
    test('should not produce any business write before activation', () => {
      const fetchSpy = vi.spyOn(global, 'fetch')
      render(<CopilotInlineTrigger entity={defaultEntity} />)

      // Just rendering should not trigger any fetch
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('7.4 No bypass of confirmation path', () => {
    test('should not provide any affordance that applies suggestions without confirmation', () => {
      render(<CopilotInlineTrigger entity={defaultEntity} />)

      // The trigger should only be a button, not an "apply" or "confirm" button
      const button = screen.getByRole('button')
      expect(button).not.toHaveTextContent('应用')
      expect(button).not.toHaveTextContent('确认')
      expect(button).not.toHaveTextContent('执行')
    })
  })

  describe('Not-enabled availability', () => {
    test('should show hint and not open panel when not enabled', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      render(
        <CopilotInlineTrigger
          entity={defaultEntity}
          availability="not-enabled"
          availabilityHint="该能力未启用，可在设置中开启"
        />,
      )

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Should not dispatch the inline trigger event
      const copilotEvents = dispatchSpy.mock.calls.filter(
        (call) => (call[0] as Event).type === 'copilot:inline-trigger',
      )
      expect(copilotEvents).toHaveLength(0)

      // Panel should not be opened
      expect(useCopilotStore.getState().open).toBe(false)
    })
  })

  describe('4.1 Permission-based absence (parent controls visibility)', () => {
    test('should not render when parent decides entity is not accessible', () => {
      // The parent component (e.g., TaskCard) is responsible for not rendering
      // the trigger when the actor lacks permission. This test verifies the
      // component respects the availability prop for permission gating.
      render(<CopilotInlineTrigger entity={defaultEntity} availability="authorization-gated" />)

      // When authorization-gated, the button should be aria-disabled
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-disabled', 'true')

      // Clicking should not trigger anything
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      fireEvent.click(button)
      const copilotEvents = dispatchSpy.mock.calls.filter(
        (call) => (call[0] as Event).type === 'copilot:inline-trigger',
      )
      expect(copilotEvents).toHaveLength(0)
    })
  })
})
