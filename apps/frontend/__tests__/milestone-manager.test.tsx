import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Milestone } from '@/lib/api/milestones'

const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
const refetch = vi.fn()
let permissions = new Set<string>()
let milestones: Milestone[] = []
let loading = false
let failed = false

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: (permission: string) => permissions.has(permission) }),
}))

vi.mock('@/hooks/use-milestones', () => ({
  useMilestones: () => ({
    data: {
      data: milestones,
      meta: { total: milestones.length, page: 1, perPage: 50, totalPages: 1 },
    },
    isLoading: loading,
    isError: failed,
    refetch,
  }),
  useCreateMilestone: () => ({ mutateAsync: create, isPending: false }),
  useUpdateMilestone: () => ({ mutateAsync: update, isPending: false }),
  useDeleteMilestone: () => ({ mutate: remove, isPending: false }),
}))

function milestone(): Milestone {
  return {
    id: 10,
    projectId: 7,
    name: '需求冻结',
    description: null,
    status: 'at_risk',
    storedStatus: 'planned',
    plannedDate: '2026-07-20',
    autoCalculated: true,
    displayOrder: 0,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: null,
  }
}

async function renderManager() {
  const { MilestoneManager } = await import('@/components/views/gantt/milestones/MilestoneManager')
  render(<MilestoneManager projectId={7} />)
}

describe('MilestoneManager', () => {
  beforeEach(() => {
    permissions = new Set(['milestone:view'])
    milestones = [milestone()]
    loading = false
    failed = false
    create.mockReset()
    update.mockReset()
    remove.mockReset()
    refetch.mockReset()
  })

  it('无查看权限时不显示入口', async () => {
    permissions.clear()
    await renderManager()
    expect(screen.queryByRole('button', { name: '里程碑' })).not.toBeInTheDocument()
  })

  it('只读角色可查看状态与日期，但没有写入口', async () => {
    await renderManager()
    fireEvent.click(screen.getByRole('button', { name: '里程碑' }))

    expect(await screen.findByText('需求冻结')).toBeInTheDocument()
    expect(screen.getByText('有风险')).toBeInTheDocument()
    expect(screen.getByText('当前角色为只读，仅可查看里程碑。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建里程碑' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('编辑里程碑')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('删除里程碑')).not.toBeInTheDocument()
  })

  it('有写权限时显示新建、编辑与删除入口', async () => {
    permissions = new Set([
      'milestone:view',
      'milestone:create',
      'milestone:update',
      'milestone:delete',
    ])
    await renderManager()
    fireEvent.click(screen.getByRole('button', { name: '里程碑' }))

    expect(await screen.findByRole('button', { name: '新建里程碑' })).toBeInTheDocument()
    expect(screen.getByLabelText('编辑里程碑')).toBeInTheDocument()
    expect(screen.getByLabelText('删除里程碑')).toBeInTheDocument()
  })

  it('加载失败提供局部重试，不拖垮抽屉', async () => {
    failed = true
    await renderManager()
    fireEvent.click(screen.getByRole('button', { name: '里程碑' }))
    expect(await screen.findByText('里程碑加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refetch).toHaveBeenCalled()
  })
})
