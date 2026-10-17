import { describe, expect, it } from 'vitest'
import { normalizeWbsNode, type WbsNode } from '@/lib/api/wbs'

const base: WbsNode = {
  id: 1,
  projectId: 3,
  parentId: null,
  path: '1',
  code: '1',
  name: '根',
  depth: 0,
  isLeaf: false,
  collapsed: false,
  displayOrder: 0,
  taskId: null,
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: null,
}

describe('normalizeWbsNode', () => {
  it('PG bigint 字符串 id 归一为数字，与数字外键可全等比较', () => {
    const node = normalizeWbsNode({
      ...base,
      id: '7' as unknown as number,
      projectId: '3' as unknown as number,
      parentId: 1,
      taskId: '42' as unknown as number,
      task: {
        id: '42' as unknown as number,
        name: '任务',
        status: 'not_started',
        startDate: null,
        endDate: null,
      },
    })
    expect(node.id).toBe(7)
    expect(node.projectId).toBe(3)
    expect(node.parentId).toBe(1)
    expect(node.taskId).toBe(42)
    expect(node.task?.id).toBe(42)
  })

  it('null / 缺省外键保持 null，数字 id 原样保留', () => {
    const node = normalizeWbsNode({ ...base, taskId: undefined as unknown as null })
    expect(node.id).toBe(1)
    expect(node.parentId).toBeNull()
    expect(node.taskId).toBeNull()
    expect(node.task).toBeUndefined()
  })
})
