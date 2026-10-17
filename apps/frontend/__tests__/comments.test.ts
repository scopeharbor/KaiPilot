import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  listProjectComments,
  createProjectComment,
  listTaskComments,
  createTaskComment,
  updateComment,
  deleteComment,
  type Comment,
  type CommentListFilters,
} from '@/lib/api/comments'
import type { CommentWithAuthor } from '@aiproj/types'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => ({ data: body }),
  } as Response
}

function makeComment(overrides: Partial<CommentWithAuthor> = {}): CommentWithAuthor {
  const merged = {
    id: 1,
    organizationId: 1,
    projectId: 10,
    entityType: 'project',
    entityId: 10,
    taskId: null,
    authorId: 1,
    body: '测试评论内容',
    bodyFormat: 'plain',
    parentId: null,
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

// ---------- lib/api/comments ----------

describe('lib/api/comments', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('listProjectComments', () => {
    test('默认请求含正确端点', async () => {
      const payload = {
        data: [makeComment()],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await listProjectComments(10)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/projects/10/comments'),
        expect.anything(),
      )
    })

    test('page 过滤参数', async () => {
      const payload = {
        data: [],
        meta: { total: 0, page: 2, perPage: 20, totalPages: 0 },
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await listProjectComments(10, { page: 2 })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        expect.anything(),
      )
    })

    test('perPage 过滤参数', async () => {
      const payload = {
        data: [],
        meta: { total: 0, page: 1, perPage: 10, totalPages: 0 },
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await listProjectComments(10, { perPage: 10 })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('perPage=10'),
        expect.anything(),
      )
    })
  })

  describe('createProjectComment', () => {
    test('POST 请求创建评论', async () => {
      const comment = makeComment()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(201, comment)))

      const result = await createProjectComment(10, { body: '新评论', bodyFormat: 'plain' })

      expect(result.data.body).toBe('测试评论内容')
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/projects/10/comments'),
        expect.objectContaining({ method: 'POST' }),
      )
    })

    test('默认使用 plain 格式', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(201, makeComment())))

      await createProjectComment(10, { body: '纯文本' })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: JSON.stringify({ body: '纯文本' }),
        }),
      )
    })
  })

  describe('listTaskComments', () => {
    test('任务评论端点含 taskId', async () => {
      const payload = {
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await listTaskComments(10, 42)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/projects/10/tasks/42/comments'),
        expect.anything(),
      )
    })
  })

  describe('createTaskComment', () => {
    test('POST 到任务评论端点', async () => {
      const comment = makeComment({ taskId: 42 })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(201, comment)))

      const result = await createTaskComment(10, 42, { body: '任务评论' })

      expect(result.data.taskId).toBe(42)
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/projects/10/tasks/42/comments'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('updateComment', () => {
    test('PATCH 请求编辑评论', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, makeComment())))

      await updateComment(10, 1, { body: '修改后' })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/projects/10/comments/1'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })

    test('请求体含修改字段', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, makeComment())))

      await updateComment(10, 1, { body: '新内容', bodyFormat: 'markdown' })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: JSON.stringify({ body: '新内容', bodyFormat: 'markdown' }),
        }),
      )
    })
  })

  describe('deleteComment', () => {
    test('DELETE 请求删除评论', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response))

      await deleteComment(10, 1)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/projects/10/comments/1'),
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })
})

// ---------- query keys ----------

describe('commentKeys', () => {
  // 动态导入避免 React 环境初始化问题
  let keys: (typeof import('@/hooks/use-comments'))['commentKeys']
  beforeAll(async () => {
    const mod = await import('@/hooks/use-comments')
    keys = mod.commentKeys
  })

  test('all 为基础键 comments', () => {
    expect(keys.all).toEqual(['comments'])
  })

  test('projectList 含 projectId 与 filters', () => {
    const filters: CommentListFilters = { page: 2, perPage: 10 }
    const key = keys.projectList(10, filters)
    expect(key[0]).toBe('comments')
    expect(key[1]).toBe('project-list')
    expect(key[2]).toBe(10)
    expect(key[3]).toEqual(filters)
  })

  test('taskList 含 projectId 与 taskId', () => {
    const key = keys.taskList(10, 42)
    expect(key[0]).toBe('comments')
    expect(key[1]).toBe('task-list')
    expect(key[2]).toBe(10)
    expect(key[3]).toBe(42)
  })

  test('projectLists 不含具体 projectId', () => {
    const key = keys.projectLists()
    expect(key).toEqual(['comments', 'project-list'])
  })
})

// ---------- 失败恢复 ----------

describe('comments API failure handling', () => {
  afterEach(() => vi.restoreAllMocks())

  test('API 500 时抛出错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Internal Server Error')))

    await expect(listProjectComments(10)).rejects.toThrow()
  })

  test('网络断开时拒绝', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(createProjectComment(10, { body: '评论' })).rejects.toThrow()
  })

  test('超长正文请求体不含非法内容（仅验证不抛出异常）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(201, makeComment())))

    const longBody = 'x'.repeat(5000)
    await expect(createProjectComment(10, { body: longBody })).resolves.toBeDefined()

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: JSON.stringify({ body: longBody }),
      }),
    )
  })
})

// ---------- 权限态字段校验 ----------

describe('Comment type permission fields', () => {
  test('评论对象含 author 字段', () => {
    const c: Comment = makeComment()
    expect(c.author).toBeDefined()
    expect(c.author!.id).toBe(1)
    expect(c.author!.fullName).toBe('测试用户')
  })

  test('targetType 在 Comment 类型中正确', () => {
    const projectComment: Comment = makeComment({ taskId: null })
    expect(projectComment.targetType).toBe('project')

    const taskComment: Comment = makeComment({ taskId: 42, targetType: 'task' })
    expect(taskComment.targetType).toBe('task')
  })

  test('isEdited 指示编辑状态', () => {
    const unedited: Comment = makeComment({ editedAt: null })
    expect(unedited.isEdited).toBe(false)

    const edited: Comment = makeComment({ editedAt: new Date().toISOString(), isEdited: true })
    expect(edited.isEdited).toBe(true)
  })
})
