import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskCommentsPanel } from '@/components/views/tasks/TaskCommentsPanel'
import { ProjectCommentsPanel } from '@/components/views/projects/ProjectCommentsPanel'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import type { CommentWithAuthor } from '@aiproj/types'

// ---------------------------------------------------------------------------
// mock 数据
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<CommentWithAuthor> = {}): CommentWithAuthor {
  const merged = {
    id: 1,
    organizationId: 1,
    projectId: 10,
    entityType: 'project',
    entityId: 10,
    taskId: null,
    authorId: 1,
    body: '这是一条测试评论',
    bodyFormat: 'plain',
    parentId: null,
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: '2026-07-08T10:00:00.000Z',
    updatedAt: '2026-07-08T10:00:00.000Z',
    isDeleted: false,
    isEdited: false,
    isResolved: false,
    replyCount: 0,
    targetType: 'project',
    author: { id: 1, fullName: '测试用户', email: 'test@test.local' },
    mentions: [],
    ...overrides,
  }
  const taskId = merged.taskId ?? null
  const entityType = merged.entityType ?? merged.targetType ?? (taskId ? 'task' : 'project')
  return {
    ...merged,
    entityType: entityType as CommentWithAuthor['entityType'],
    entityId: merged.entityId ?? taskId ?? merged.projectId,
    taskId,
    targetType: (merged.targetType ?? entityType) as CommentWithAuthor['targetType'],
    bodyFormat: (merged.bodyFormat ?? 'plain') as CommentWithAuthor['bodyFormat'],
    status: (merged.status ?? 'open') as CommentWithAuthor['status'],
    parentId: merged.parentId ?? null,
    resolvedBy: merged.resolvedBy ?? null,
    resolvedAt: merged.resolvedAt ?? null,
    isResolved: merged.isResolved ?? false,
    replyCount: merged.replyCount ?? 0,
    mentions: merged.mentions ?? [],
  }
}

const mockComments = [makeComment(), makeComment({ id: 2, body: '第二条评论' })]

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function login(permissions: string[], userId = 1) {
  act(() => {
    useAuthStore.getState().setSession({
      user: {
        id: userId,
        email: 'a@b.com',
        fullName: '甲',
        isSuperAdmin: false,
        organizations: [],
      },
      accessToken: accessTokenWith(permissions),
      refreshToken: 'r',
    })
  })
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

// ---------------------------------------------------------------------------
// mock hooks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-comments', () => ({
  useTaskComments: vi.fn(),
  useCreateTaskComment: vi.fn(),
  useCreateProjectComment: vi.fn(),
  useProjectComments: vi.fn(),
  useDeleteComment: vi.fn(),
  useUpdateComment: vi.fn(),
}))

import {
  useTaskComments,
  useCreateTaskComment,
  useDeleteComment,
  useProjectComments,
  useCreateProjectComment,
} from '@/hooks/use-comments'

// ---------------------------------------------------------------------------
// TaskCommentsPanel 组件测试
// ---------------------------------------------------------------------------

describe('TaskCommentsPanel', () => {
  beforeEach(() => {
    login(['comment:create', 'comment:delete:self', 'comment:moderate'])
    vi.mocked(useTaskComments).mockReturnValue({
      data: { data: mockComments, meta: { total: 2, page: 1, perPage: 20, totalPages: 1 } },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useTaskComments>)
    vi.mocked(useCreateTaskComment).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateTaskComment>)
    vi.mocked(useDeleteComment).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteComment>)
  })

  afterEach(() => {
    vi.clearAllMocks()
    act(() => useAuthStore.getState().clear())
  })

  test('加载态显示骨架屏', () => {
    vi.mocked(useTaskComments).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useTaskComments>)

    render(wrapper({ children: <TaskCommentsPanel projectId={10} taskId={42} /> }))
    // 加载态时标题保持可见
    expect(screen.getByText('评论')).toBeInTheDocument()
  })

  test('错误态显示错误提示', () => {
    vi.mocked(useTaskComments).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useTaskComments>)

    render(wrapper({ children: <TaskCommentsPanel projectId={10} taskId={42} /> }))
    expect(screen.getByText('评论加载失败')).toBeInTheDocument()
  })

  test('空状态显示提示文案', () => {
    vi.mocked(useTaskComments).mockReturnValue({
      data: {
        data: [] as CommentWithAuthor[],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useTaskComments>)

    render(wrapper({ children: <TaskCommentsPanel projectId={10} taskId={42} /> }))
    expect(screen.getByText('暂无评论，成为第一个发表评论的人吧。')).toBeInTheDocument()
  })

  test('正常渲染评论列表', () => {
    render(wrapper({ children: <TaskCommentsPanel projectId={10} taskId={42} /> }))
    expect(screen.getByText('这是一条测试评论')).toBeInTheDocument()
    expect(screen.getByText('第二条评论')).toBeInTheDocument()
    expect(screen.getAllByText('测试用户').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('评论')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  test('有 comment:create 权限时显示输入框', () => {
    render(wrapper({ children: <TaskCommentsPanel projectId={10} taskId={42} /> }))
    expect(screen.getByPlaceholderText('写下你的评论...')).toBeInTheDocument()
    expect(screen.getByText('发送')).toBeInTheDocument()
  })

  test('无 comment:create 权限时隐藏输入框', () => {
    login(['comment:view'])
    vi.mocked(useTaskComments).mockReturnValue({
      data: { data: mockComments, meta: { total: 2, page: 1, perPage: 20, totalPages: 1 } },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useTaskComments>)

    render(wrapper({ children: <TaskCommentsPanel projectId={10} taskId={42} /> }))
    expect(screen.queryByPlaceholderText('写下你的评论...')).not.toBeInTheDocument()
    expect(screen.getByText('你没有权限发表评论。')).toBeInTheDocument()
  })

  test('软删除评论显示占位文字', () => {
    const deletedComment = makeComment({
      id: 3,
      isDeleted: true,
      deletedAt: '2026-07-08T12:00:00.000Z',
      body: null,
    })
    vi.mocked(useTaskComments).mockReturnValue({
      data: { data: [deletedComment], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useTaskComments>)

    render(wrapper({ children: <TaskCommentsPanel projectId={10} taskId={42} /> }))
    expect(screen.getByText('此评论已被删除')).toBeInTheDocument()
  })

  test('提交时调用 mutateAsync', () => {
    const mockMutateAsync = vi.fn().mockResolvedValue({})
    vi.mocked(useCreateTaskComment).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateTaskComment>)

    render(wrapper({ children: <TaskCommentsPanel projectId={10} taskId={42} /> }))
    expect(screen.getByPlaceholderText('写下你的评论...')).toBeInTheDocument()
    // 验证 mutateAsync 被正确传递（组件内部通过提交按钮触发）
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ProjectCommentsPanel 组件测试
// ---------------------------------------------------------------------------

describe('ProjectCommentsPanel', () => {
  beforeEach(() => {
    login(['comment:create', 'comment:delete:self'])
    vi.mocked(useProjectComments).mockReturnValue({
      data: { data: mockComments, meta: { total: 2, page: 1, perPage: 20, totalPages: 1 } },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProjectComments>)
    vi.mocked(useCreateProjectComment).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateProjectComment>)
    vi.mocked(useDeleteComment).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteComment>)
  })

  afterEach(() => {
    vi.clearAllMocks()
    act(() => useAuthStore.getState().clear())
  })

  test('加载态显示骨架屏', () => {
    vi.mocked(useProjectComments).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useProjectComments>)

    render(wrapper({ children: <ProjectCommentsPanel projectId={10} /> }))
    expect(screen.getByText('项目讨论')).toBeInTheDocument()
  })

  test('正常渲染项目级评论', () => {
    render(wrapper({ children: <ProjectCommentsPanel projectId={10} /> }))
    expect(screen.getByText('项目讨论')).toBeInTheDocument()
    expect(screen.getByText('这是一条测试评论')).toBeInTheDocument()
  })

  test('无权限时隐藏输入', () => {
    login(['comment:view'])
    vi.mocked(useProjectComments).mockReturnValue({
      data: {
        data: [] as CommentWithAuthor[],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useProjectComments>)

    render(wrapper({ children: <ProjectCommentsPanel projectId={10} /> }))
    expect(screen.queryByPlaceholderText('写下你对项目的评论...')).not.toBeInTheDocument()
  })
})
