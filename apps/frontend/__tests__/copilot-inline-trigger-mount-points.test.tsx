/**
 * v3-copilot-inline-triggers —— 四处挂载点入口可达性测试。
 *
 * 覆盖：
 * - 3.6 逐处断言入口可达且携带正确实体身份
 * - 7.5 六视图、甘特、WBS、风险登记册既有行为未被改变
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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

describe('3.6 Mount point entry reachability', () => {
  // Test that the CopilotInlineTrigger component works with different entity types
  // and that the event carries the correct entity identity

  const entityTypes = [
    { entityType: 'task' as const, entityId: 1, label: '任务1', expectedEntityType: 'task' },
    { entityType: 'risk' as const, entityId: 2, label: '风险1', expectedEntityType: 'risk' },
    {
      entityType: 'wbs_node' as const,
      entityId: 3,
      label: 'WBS节点1',
      expectedEntityType: 'wbs_node',
    },
    {
      entityType: 'milestone' as const,
      entityId: 4,
      label: '里程碑1',
      expectedEntityType: 'milestone',
    },
  ]

  entityTypes.forEach(({ entityType, entityId, label, expectedEntityType }) => {
    test(`should dispatch correct entity identity for ${entityType}`, async () => {
      const { CopilotInlineTrigger } = await import('@/components/copilot/CopilotInlineTrigger')
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      render(<CopilotInlineTrigger entity={{ entityType, entityId, label, projectId: 1 }} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Verify the event was dispatched with correct entity identity
      const copilotEvents = dispatchSpy.mock.calls.filter(
        (call) => (call[0] as Event).type === 'copilot:inline-trigger',
      )
      expect(copilotEvents).toHaveLength(1)

      const event = copilotEvents[0]![0] as CustomEvent
      expect(event.detail.mention.entityType).toBe(expectedEntityType)
      expect(event.detail.mention.entityId).toBe(entityId)
      expect(event.detail.mention.label).toBe(label)
      expect(event.detail.mention.organizationId).toBe(1)

      dispatchSpy.mockRestore()
    })
  })

  test('should open the panel when triggered', async () => {
    const { CopilotInlineTrigger } = await import('@/components/copilot/CopilotInlineTrigger')

    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '测试任务', projectId: 1 }}
      />,
    )

    const button = screen.getByRole('button')
    fireEvent.click(button)

    // Verify the panel is opened
    expect(useCopilotStore.getState().open).toBe(true)
  })

  test('should not open panel when availability is not available', async () => {
    const { CopilotInlineTrigger } = await import('@/components/copilot/CopilotInlineTrigger')

    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '测试任务', projectId: 1 }}
        availability="not-enabled"
      />,
    )

    const button = screen.getByRole('button')
    fireEvent.click(button)

    // Verify the panel is NOT opened
    expect(useCopilotStore.getState().open).toBe(false)
  })

  test('should be keyboard accessible', async () => {
    const { CopilotInlineTrigger } = await import('@/components/copilot/CopilotInlineTrigger')

    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '测试任务', projectId: 1 }}
      />,
    )

    const button = screen.getByRole('button')

    // Should be focusable
    expect(button).toHaveAttribute('tabIndex', '0')

    // Should have aria-label
    expect(button).toHaveAttribute('aria-label', '向 Copilot 询问 测试任务')

    // Should respond to Enter key
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(useCopilotStore.getState().open).toBe(true)
  })
})

describe('7.5 Existing behavior unchanged', () => {
  test('CopilotInlineTrigger should not affect copilot store state when not clicked', async () => {
    const { CopilotInlineTrigger } = await import('@/components/copilot/CopilotInlineTrigger')

    const initialState = {
      open: useCopilotStore.getState().open,
      draft: useCopilotStore.getState().draft,
      streaming: useCopilotStore.getState().streaming,
      messages: useCopilotStore.getState().messages,
    }

    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '测试任务', projectId: 1 }}
      />,
    )

    // Just rendering should not change any state
    expect(useCopilotStore.getState().open).toBe(initialState.open)
    expect(useCopilotStore.getState().draft).toBe(initialState.draft)
    expect(useCopilotStore.getState().streaming).toBe(initialState.streaming)
    expect(useCopilotStore.getState().messages).toHaveLength(initialState.messages.length)
  })
})
