// v3-copilot-memory-user-and-project 前端测试
// 任务 8.8 —— 逐条操作隔离性与溯源可达
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CopilotMemoryView, type MemoryEntry } from '../components/copilot/CopilotMemoryView'

const mockMemories: MemoryEntry[] = [
  {
    id: 'mem_001',
    scope: 'user' as const,
    summary: '团队规模为 5 人，编制锁死不扩招',
    tags: ['team_size', 'constraint'],
    confidence: 0.85,
    status: 'confirmed',
    validityTier: 'durable',
    observedAt: '2026-08-01T10:00:00.000Z',
    lastConfirmedAt: '2026-08-15T10:00:00.000Z',
    basisCount: 2,
  },
  {
    id: 'mem_002',
    scope: 'project' as const,
    summary: '项目使用 Scrum 方法论，双周迭代',
    tags: ['methodology'],
    confidence: 0.7,
    status: 'candidate',
    validityTier: 'medium',
    observedAt: '2026-08-10T10:00:00.000Z',
    basisCount: 1,
  },
  {
    id: 'mem_003',
    scope: 'organization' as const,
    summary: '组织统一使用中文术语表',
    tags: ['terminology'],
    confidence: 0.95,
    status: 'possibly_outdated',
    validityTier: 'long',
    observedAt: '2026-05-01T10:00:00.000Z',
    basisCount: 3,
  },
]

/** 逐条操作按钮位于「来源 · N 条对话」展开区内；点击操作前先展开该条目。 */
function expandEntry(): void {
  fireEvent.click(screen.getByText(/来源 · [0-9]+ 条对话/))
}

describe('CopilotMemoryView', () => {
  it('renders empty state when no memories', () => {
    render(<CopilotMemoryView memories={[]} />)
    expect(screen.getByText('Copilot 还没有记住任何内容。')).toBeInTheDocument()
  })

  it('renders memories grouped by scope', () => {
    render(<CopilotMemoryView memories={mockMemories} />)
    expect(screen.getByText('用户偏好（1）')).toBeInTheDocument()
    expect(screen.getByText('项目约定（1）')).toBeInTheDocument()
    expect(screen.getByText('组织约定（1）')).toBeInTheDocument()
  })

  it('shows inferred badge on all entries', () => {
    render(<CopilotMemoryView memories={mockMemories} />)
    const badges = screen.getAllByText('推断')
    expect(badges.length).toBe(3)
  })

  it('shows status labels', () => {
    render(<CopilotMemoryView memories={mockMemories} />)
    expect(screen.getByText('已确认')).toBeInTheDocument()
    expect(screen.getByText('待确认')).toBeInTheDocument()
    expect(screen.getByText('可能过期')).toBeInTheDocument()
  })

  it('shows confidence badges', () => {
    render(<CopilotMemoryView memories={mockMemories} />)
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()
    expect(screen.getByText('95%')).toBeInTheDocument()
  })

  it('shows tags', () => {
    render(<CopilotMemoryView memories={mockMemories} />)
    expect(screen.getByText('team_size')).toBeInTheDocument()
    expect(screen.getByText('constraint')).toBeInTheDocument()
    expect(screen.getByText('methodology')).toBeInTheDocument()
  })

  it('candidate shows confirm and ignore buttons', () => {
    const onConfirm = vi.fn()
    const onIgnore = vi.fn()
    render(
      <CopilotMemoryView memories={[mockMemories[1]!]} onConfirm={onConfirm} onIgnore={onIgnore} />,
    )
    expandEntry()
    expect(screen.getByText('确认')).toBeInTheDocument()
    expect(screen.getByText('忽略')).toBeInTheDocument()
  })

  it('confirmed entry shows edit, invalidate, and delete buttons', () => {
    const onEdit = vi.fn()
    const onInvalidate = vi.fn()
    const onDelete = vi.fn()
    render(
      <CopilotMemoryView
        memories={[mockMemories[0]!]}
        onEdit={onEdit}
        onInvalidate={onInvalidate}
        onDelete={onDelete}
      />,
    )
    expandEntry()
    expect(screen.getByText('编辑')).toBeInTheDocument()
    expect(screen.getByText('失效')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()
  })

  it('confirm callback is called with correct id', () => {
    const onConfirm = vi.fn()
    render(<CopilotMemoryView memories={[mockMemories[1]!]} onConfirm={onConfirm} />)
    expandEntry()
    fireEvent.click(screen.getByText('确认'))
    expect(onConfirm).toHaveBeenCalledWith('mem_002')
  })

  it('ignore callback is called with correct id', () => {
    const onIgnore = vi.fn()
    render(<CopilotMemoryView memories={[mockMemories[1]!]} onIgnore={onIgnore} />)
    expandEntry()
    fireEvent.click(screen.getByText('忽略'))
    expect(onIgnore).toHaveBeenCalledWith('mem_002')
  })

  it('delete requires confirmation', () => {
    const onDelete = vi.fn()
    render(<CopilotMemoryView memories={[mockMemories[0]!]} onDelete={onDelete} />)
    // First click shows confirmation
    expandEntry()
    fireEvent.click(screen.getByText('删除'))
    expect(screen.getByText('确认删除？不可恢复。')).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('delete confirmation calls onDelete', () => {
    const onDelete = vi.fn()
    render(<CopilotMemoryView memories={[mockMemories[0]!]} onDelete={onDelete} />)
    expandEntry()
    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('确认删除'))
    expect(onDelete).toHaveBeenCalledWith('mem_001')
  })

  it('expand shows basis traceability', () => {
    render(<CopilotMemoryView memories={[mockMemories[0]!]} />)
    // Click to expand
    const expandButton = screen.getByText(/来源 · 2 条对话/)
    fireEvent.click(expandButton)
    expect(screen.getByText(/观察于/)).toBeInTheDocument()
    expect(screen.getByText(/确认于/)).toBeInTheDocument()
  })

  it('loading state shows spinner', () => {
    render(<CopilotMemoryView loading={true} />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('each entry operates independently', () => {
    const onConfirm = vi.fn()
    render(<CopilotMemoryView memories={[mockMemories[1]!]} onConfirm={onConfirm} />)
    // Confirm one entry doesn't affect others
    expandEntry()
    fireEvent.click(screen.getByText('确认'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('mem_002')
  })

  it('validity tier labels are shown', () => {
    render(<CopilotMemoryView memories={mockMemories} />)
    expect(screen.getByText('持久')).toBeInTheDocument()
    expect(screen.getByText('中期')).toBeInTheDocument()
    expect(screen.getByText('长期')).toBeInTheDocument()
  })

  it('invalidated entries do not show action buttons', () => {
    const invalidatedMemory = {
      ...mockMemories[0]!,
      id: 'mem_invalidated',
      status: 'invalidated',
    }
    render(<CopilotMemoryView memories={[invalidatedMemory]} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByText('编辑')).not.toBeInTheDocument()
    expect(screen.queryByText('删除')).not.toBeInTheDocument()
  })
})
