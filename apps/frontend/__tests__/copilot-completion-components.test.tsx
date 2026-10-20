/**
 * MentionCompletion 与 SlashCommandCompletion 组件测试。
 *
 * 覆盖：
 * - MentionCompletion 在 @ 触发时渲染候选（task 4.2/4.3）
 * - MentionCompletion 空状态（task 4.2）
 * - SlashCommandCompletion 分组渲染（task 4.4/4.5）
 * - SlashCommandCompletion「你可以这样问」（task 4.5）
 * - 键盘导航（task 4.6）
 * - 可访问性 aria 属性（task 4.6）
 * - Authorization-gated 命令显示 badge（task 4.7/4.8）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import * as React from 'react'
import { MentionCompletion } from '@/components/copilot/MentionCompletion'
import { SlashCommandCompletion } from '@/components/copilot/SlashCommandCompletion'
import type { CompletionMentionCandidate, CommandDescriptor } from '@aiproj/types'

// ===========================================================================
// 测试数据
// ===========================================================================

const mockMentionCandidates: CompletionMentionCandidate[] = [
  {
    kind: 'mention',
    entityType: 'task',
    entityId: 1042,
    label: '首页设计（T-1042）',
    summary: '完成首页 UI 设计稿',
    projectId: 100,
    sortKey: {
      relevanceTier: 'critical',
      impactSeverity: 90,
      stableTieBreak: 'test-001',
    },
  },
  {
    kind: 'mention',
    entityType: 'project',
    entityId: 200,
    label: '开项 Kaiplan',
    summary: 'AI-first 项目管理平台',
    sortKey: {
      relevanceTier: 'high',
      impactSeverity: 70,
      stableTieBreak: 'test-002',
    },
  },
]

const mockCommands: CommandDescriptor[] = [
  {
    id: 'intent.decompose-task',
    label: '拆解任务',
    sourceKind: 'intent-catalog',
    group: 'contextual',
    description: '将复杂任务拆解为可执行的子任务',
    requiredPermissions: ['task:create'],
    availabilityKind: 'available',
    fillText: '/拆解任务',
    routingKey: 'decompose-task',
  },
  {
    id: 'nav.dashboard',
    label: '仪表盘',
    sourceKind: 'registered-command',
    group: 'navigation',
    description: '跳转到项目仪表盘',
    requiredPermissions: [],
    availabilityKind: 'available',
    fillText: '/仪表盘',
    routingKey: 'nav.dashboard',
  },
  {
    id: 'command.web-search',
    label: '网络搜索',
    sourceKind: 'registered-command',
    group: 'search',
    description: '在互联网上搜索相关信息',
    requiredPermissions: [],
    availabilityKind: 'not-enabled',
    hint: '该能力未启用，可在设置中开启',
    fillText: '/网络搜索',
    routingKey: 'web-search',
  },
  {
    id: 'command.gitlab-sync',
    label: 'GitLab 同步',
    sourceKind: 'registered-command',
    group: 'contextual',
    description: '将项目变更同步到 GitLab 仓库',
    requiredPermissions: ['project:admin'],
    availabilityKind: 'authorization-gated',
    hint: '需要用户授权后才能使用该能力',
    fillText: '/GitLab 同步',
    routingKey: 'gitlab-sync',
  },
]

// ===========================================================================
// MentionCompletion 测试
// ===========================================================================

describe('MentionCompletion', () => {
  const mockOnSelect = vi.fn()
  const mockOnCancel = vi.fn()
  const mockQueryFn = vi.fn()
  const textareaRef = React.createRef<HTMLTextAreaElement>()

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryFn.mockResolvedValue(mockMentionCandidates)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('active=false 时不渲染', () => {
    render(
      <MentionCompletion
        active={false}
        prefix=""
        triggerOffset={0}
        onSelect={mockOnSelect}
        queryFn={mockQueryFn}
        onCancel={mockOnCancel}
        textareaRef={textareaRef}
      />,
    )

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('active=true 时渲染下拉列表', async () => {
    render(
      <MentionCompletion
        active={true}
        prefix="首"
        triggerOffset={5}
        onSelect={mockOnSelect}
        queryFn={mockQueryFn}
        onCancel={mockOnCancel}
        textareaRef={textareaRef}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeDefined()
    })
  })

  it('有候选时渲染候选列表', async () => {
    render(
      <MentionCompletion
        active={true}
        prefix="首"
        triggerOffset={5}
        onSelect={mockOnSelect}
        queryFn={mockQueryFn}
        onCancel={mockOnCancel}
        textareaRef={textareaRef}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('首页设计（T-1042）')).toBeDefined()
    })

    expect(screen.getByText('开项 Kaiplan')).toBeDefined()
  })

  it('空结果时显示"未找到匹配的实体"', async () => {
    mockQueryFn.mockResolvedValue([])

    render(
      <MentionCompletion
        active={true}
        prefix="zzz"
        triggerOffset={5}
        onSelect={mockOnSelect}
        queryFn={mockQueryFn}
        onCancel={mockOnCancel}
        textareaRef={textareaRef}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('未找到匹配的实体')).toBeDefined()
    })
  })

  it('选中候选时调用 onSelect', async () => {
    render(
      <MentionCompletion
        active={true}
        prefix="首"
        triggerOffset={5}
        onSelect={mockOnSelect}
        queryFn={mockQueryFn}
        onCancel={mockOnCancel}
        textareaRef={textareaRef}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('首页设计（T-1042）')).toBeDefined()
    })

    const firstOption = screen.getAllByRole('option')[0]!
    fireEvent.click(firstOption)

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'task',
        entityId: 1042,
        label: '首页设计（T-1042）',
      }),
    )
  })

  it('aria 属性正确', async () => {
    render(
      <MentionCompletion
        active={true}
        prefix="首"
        triggerOffset={5}
        onSelect={mockOnSelect}
        queryFn={mockQueryFn}
        onCancel={mockOnCancel}
        textareaRef={textareaRef}
      />,
    )

    await waitFor(() => {
      const listbox = screen.getByRole('listbox')
      expect(listbox).toBeDefined()
      expect(listbox.getAttribute('aria-label')).toBe('实体提及候选')
    })
  })

  it('Esc 键触发 onCancel', async () => {
    render(
      <MentionCompletion
        active={true}
        prefix="首"
        triggerOffset={5}
        onSelect={mockOnSelect}
        queryFn={mockQueryFn}
        onCancel={mockOnCancel}
        textareaRef={textareaRef}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeDefined()
    })

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(mockOnCancel).toHaveBeenCalled()
  })
})

// ===========================================================================
// SlashCommandCompletion 测试
// ===========================================================================

describe('SlashCommandCompletion', () => {
  const mockOnSelect = vi.fn()
  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('active=false 时不渲染', () => {
    render(
      <SlashCommandCompletion
        active={false}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('active=true 时渲染下拉列表', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    expect(screen.getByRole('listbox')).toBeDefined()
  })

  it('无前缀时显示"你可以这样问"', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    expect(screen.getByText('你可以这样问')).toBeDefined()
  })

  it('按前缀过滤命令', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix="拆"
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    expect(screen.getByText('拆解任务')).toBeDefined()
    // 仪表盘不应出现（不匹配"拆"）
    expect(screen.queryByText('仪表盘')).toBeNull()
  })

  it('命令按分组渲染', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    // 应有分组标题（通过 aria-label 检查）
    expect(screen.getByRole('group', { name: '快捷操作' })).toBeDefined()
    expect(screen.getByRole('group', { name: '跳转页面' })).toBeDefined()
  })

  it('not-enabled 命令显示"未启用" badge', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    expect(screen.getByText('未启用')).toBeDefined()
  })

  it('authorization-gated 命令显示"需授权" badge', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    expect(screen.getByText('需授权')).toBeDefined()
  })

  it('真正没有命令时显示"没有可用的命令"', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix="zzz不存在"
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    expect(screen.getByText('没有可用的命令')).toBeDefined()
  })

  it('选中命令时调用 onSelect', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix="拆"
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    const option = screen.getByText('拆解任务').closest('[role="option"]')!
    fireEvent.click(option)

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'intent.decompose-task',
        label: '拆解任务',
      }),
    )
  })

  it('键盘导航 ArrowUp/Down', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)

    // 初始第一个选中
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')

    // ArrowDown
    act(() => {
      fireEvent.keyDown(document, { key: 'ArrowDown' })
    })

    // 第二个应被选中
    const updatedOptions = screen.getAllByRole('option')
    expect(updatedOptions[1]!.getAttribute('aria-selected')).toBe('true')
  })

  it('Enter 键确认选择', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix="拆"
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    act(() => {
      fireEvent.keyDown(document, { key: 'Enter' })
    })

    expect(mockOnSelect).toHaveBeenCalled()
  })

  it('Esc 键触发 onCancel', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('aria 属性正确', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix=""
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeDefined()
    expect(listbox.getAttribute('aria-label')).toBe('斜杠命令候选')
  })

  it('每个命令选项有正确的 aria 属性', () => {
    render(
      <SlashCommandCompletion
        active={true}
        prefix="拆"
        commands={mockCommands}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />,
    )

    const options = screen.getAllByRole('option')
    for (const option of options) {
      expect(option.getAttribute('role')).toBe('option')
      expect(option.getAttribute('aria-selected')).toBeDefined()
    }
  })
})
