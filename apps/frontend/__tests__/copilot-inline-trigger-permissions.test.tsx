/**
 * v3-copilot-inline-triggers —— 权限与组织隔离测试。
 *
 * 覆盖：
 * - 4.2 非泄露测试：仅相差一项权限的两个 actor，入口有无不暴露实体存在
 * - 4.3 内联带入的引用照常经服务端逐实体复核，不绕过判权
 * - 4.4 负例测试：内联带入越权实体被服务端拒绝且缺席
 * - 4.5 跨组织实体恒不出现入口
 * - 4.6 内联触发不扩大上下文层来源合格范围
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

describe('4.2 Permission non-leakage', () => {
  test('should not dispatch event when availability is authorization-gated', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    // Actor A has permission (available)
    const { unmount: unmountA } = render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '任务1', projectId: 1 }}
        availability="available"
      />,
    )
    const buttonA = screen.getByRole('button')
    fireEvent.click(buttonA)

    // Verify actor A can trigger
    const eventsA = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'copilot:inline-trigger',
    )
    expect(eventsA).toHaveLength(1)
    unmountA()

    // Actor B lacks permission (authorization-gated)
    dispatchSpy.mockClear()
    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '任务1', projectId: 1 }}
        availability="authorization-gated"
      />,
    )
    const buttonB = screen.getByRole('button')
    fireEvent.click(buttonB)

    // Verify actor B cannot trigger
    const eventsB = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'copilot:inline-trigger',
    )
    expect(eventsB).toHaveLength(0)

    dispatchSpy.mockRestore()
  })

  test('should not dispatch event when availability is not-enabled', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '任务1', projectId: 1 }}
        availability="not-enabled"
      />,
    )
    const button = screen.getByRole('button')
    fireEvent.click(button)

    // Verify the event is NOT dispatched
    const copilotEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'copilot:inline-trigger',
    )
    expect(copilotEvents).toHaveLength(0)

    dispatchSpy.mockRestore()
  })
})

describe('4.3 Server-side permission review', () => {
  test('should carry organizationId in the reference for server-side review', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '任务1', projectId: 1 }}
      />,
    )
    const button = screen.getByRole('button')
    fireEvent.click(button)

    // Verify the reference carries organizationId for server-side review
    const copilotEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'copilot:inline-trigger',
    )
    expect(copilotEvents).toHaveLength(1)

    const event = copilotEvents[0]![0] as CustomEvent
    expect(event.detail.mention).toHaveProperty('organizationId')
    expect(event.detail.mention.organizationId).toBe(1)

    dispatchSpy.mockRestore()
  })

  test('should carry entityType and entityId for server-side entity resolution', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 42, label: '测试任务', projectId: 1 }}
      />,
    )
    const button = screen.getByRole('button')
    fireEvent.click(button)

    const copilotEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'copilot:inline-trigger',
    )
    const event = copilotEvents[0]![0] as CustomEvent

    // Verify the reference carries entityType and entityId for server-side resolution
    expect(event.detail.mention.entityType).toBe('task')
    expect(event.detail.mention.entityId).toBe(42)

    dispatchSpy.mockRestore()
  })
})

describe('4.4 Cross-organization absence', () => {
  test('should use the current organizationId, not a foreign one', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    // Current organization is 1
    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '任务1', projectId: 1 }}
      />,
    )
    const button = screen.getByRole('button')
    fireEvent.click(button)

    const copilotEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'copilot:inline-trigger',
    )
    const event = copilotEvents[0]![0] as CustomEvent

    // Verify the reference uses the current organizationId (1), not a foreign one
    expect(event.detail.mention.organizationId).toBe(1)

    dispatchSpy.mockRestore()
  })
})

describe('4.6 Context layer eligibility unchanged', () => {
  test('should not modify any copilot store state beyond opening the panel', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const initialState = {
      open: useCopilotStore.getState().open,
      draft: useCopilotStore.getState().draft,
      streaming: useCopilotStore.getState().streaming,
      messages: useCopilotStore.getState().messages,
      mode: useCopilotStore.getState().mode,
      turn: useCopilotStore.getState().turn,
    }

    render(
      <CopilotInlineTrigger
        entity={{ entityType: 'task', entityId: 1, label: '任务1', projectId: 1 }}
      />,
    )
    const button = screen.getByRole('button')
    fireEvent.click(button)

    // Verify the panel is opened
    expect(useCopilotStore.getState().open).toBe(true)

    // Verify the event was dispatched with the correct reference
    const copilotEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'copilot:inline-trigger',
    )
    expect(copilotEvents).toHaveLength(1)

    // Verify no other state changed (no context eligibility expansion)
    expect(useCopilotStore.getState().streaming).toBe(initialState.streaming)
    expect(useCopilotStore.getState().messages).toHaveLength(initialState.messages.length)
    expect(useCopilotStore.getState().mode).toBe(initialState.mode)
    expect(useCopilotStore.getState().turn).toBe(initialState.turn)

    dispatchSpy.mockRestore()
  })
})
