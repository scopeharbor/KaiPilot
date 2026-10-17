import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import NextTaskDetailRedirectPage from '@/app/(next)/next/projects/[id]/tasks/[taskId]/page'
import NextTaskRecycleBinRedirectPage from '@/app/(next)/next/projects/[id]/tasks/recycle-bin/page'

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

beforeEach(() => {
  mockRedirect.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('旧路由重定向同化测试 (Task 4.10)', () => {
  describe('任务详情路由同化: /next/projects/:id/tasks/:taskId', () => {
    test('访问 /next/projects/42/tasks/7 会被平滑定向至 /next/projects/42?focusTask=7 (普通对象 params)', async () => {
      await NextTaskDetailRedirectPage({
        params: { id: '42', taskId: '7' },
      })

      expect(mockRedirect).toHaveBeenCalledTimes(1)
      expect(mockRedirect).toHaveBeenCalledWith('/next/projects/42?focusTask=7')
    })

    test('访问 /next/projects/42/tasks/7 会被平滑定向至 /next/projects/42?focusTask=7 (Promise params 模式)', async () => {
      await NextTaskDetailRedirectPage({
        params: Promise.resolve({ id: '42', taskId: '7' }),
      })

      expect(mockRedirect).toHaveBeenCalledTimes(1)
      expect(mockRedirect).toHaveBeenCalledWith('/next/projects/42?focusTask=7')
    })
  })

  describe('回收站路由同化: /next/projects/:id/tasks/recycle-bin', () => {
    test('访问 /next/projects/42/tasks/recycle-bin 会被定向至 /next/projects/42?drawer=recycle-bin (普通对象 params)', async () => {
      await NextTaskRecycleBinRedirectPage({
        params: { id: '42' },
      })

      expect(mockRedirect).toHaveBeenCalledTimes(1)
      expect(mockRedirect).toHaveBeenCalledWith('/next/projects/42?drawer=recycle-bin')
    })

    test('访问 /next/projects/42/tasks/recycle-bin 会被定向至 /next/projects/42?drawer=recycle-bin (Promise params 模式)', async () => {
      await NextTaskRecycleBinRedirectPage({
        params: Promise.resolve({ id: '42' }),
      })

      expect(mockRedirect).toHaveBeenCalledTimes(1)
      expect(mockRedirect).toHaveBeenCalledWith('/next/projects/42?drawer=recycle-bin')
    })
  })
})
