/**
 * 2026-09-25 企业团队演练修复回归（前端纯逻辑与作用域）：
 * - 甘特行序按计划开始排、保持父子层级（接口默认创建时间倒序曾导致首屏空白）；
 * - 列表「归属层级」显示 WBS 工作包、默认按计划开始升序；
 * - 指派下拉带岗位 / 负载并按岗位分组、负载轻者在前；
 * - 实时事件按自身 type 派发（通知类监听者此前永远收不到）；
 * - 项目权限作用域把项目角色下放的权限并入 usePermissions。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { orderRowsByStart } from '@/lib/gantt/model-from-api'
import type { GanttRenderTask } from '@/lib/gantt/types'
import {
  LIST_DEFAULT_SORT,
  toTaskListFilters,
  withWbsLabels,
  type FormattedTaskRow,
} from '@/lib/next/lenses-list-adapter'
import { memberOptionLabel, sortMembersForAssign } from '@/lib/next/member-options'
import type { ProjectMember } from '@/lib/api/projects'
import { getRealtimeClient, resetRealtimeClient } from '@/lib/realtime/client'
import { ProjectPermissionScope, usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'

function row(id: number, startDay: number, parentId: number | null = null): GanttRenderTask {
  return {
    id,
    name: `任务${id}`,
    wbsCode: '',
    depth: parentId === null ? 0 : 1,
    parentId,
    kind: 'task',
    startDay,
    durationDays: 2,
    progress: 0,
    status: 'not_started',
  }
}

describe('甘特行序 orderRowsByStart', () => {
  test('按 startDay 升序（同日按 id），子行紧跟父行', () => {
    const ordered = orderRowsByStart([
      row(219, 200),
      row(13, 0),
      row(15, 10),
      row(14, 5),
      row(30, 12, 13),
      row(31, 1, 13),
    ])
    expect(ordered.map((t) => t.id)).toEqual([13, 31, 30, 14, 15, 219])
  })

  test('父链成环不丢行', () => {
    const ordered = orderRowsByStart([row(1, 0, 2), row(2, 0, 1), row(3, 0)])
    expect(ordered.map((t) => t.id).sort()).toEqual([1, 2, 3])
  })
})

describe('列表：归属层级与默认排序', () => {
  test('按 wbsNodeId 显示「编码 名称」，查不到则保留原值', () => {
    const rows = [
      { wbsLabel: '—', raw: { wbsNodeId: 5 } },
      { wbsLabel: '—', raw: { wbsNodeId: 99 } },
    ] as unknown as FormattedTaskRow[]
    const labelled = withWbsLabels(
      rows,
      new Map([[5, { code: '1.2.1.1', name: '账户服务需求梳理' }]]),
    )
    expect(labelled.map((r) => r.wbsLabel)).toEqual(['1.2.1.1 账户服务需求梳理', '—'])
  })

  test('未手动排序时默认计划开始升序', () => {
    expect(LIST_DEFAULT_SORT).toBe('+startDate')
    expect(toTaskListFilters({ sort: null, page: 1, perPage: 25 }).sort).toBe('+startDate')
    expect(
      toTaskListFilters({ sort: { field: 'endDate', direction: 'desc' }, page: 1, perPage: 25 })
        .sort,
    ).toBe('-endDate')
  })
})

function member(
  userId: number,
  fullName: string,
  primaryRoleHint: string | null,
  openTaskCount: number,
): ProjectMember {
  return {
    id: userId,
    projectId: 3,
    userId,
    projectRoleId: 13,
    isActive: true,
    user: {
      id: userId,
      fullName,
      email: `${userId}@x.test`,
      initials: fullName[0]!,
      isActive: true,
    },
    projectRole: { id: 13, name: 'Member', description: null, permissions: [], isSystem: true },
    workload: { openTaskCount, inProgressTaskCount: 0 },
    primaryRoleHint,
  }
}

describe('指派下拉成员选项', () => {
  test('标签含岗位与未完成数；无岗位提示时回退项目角色中文名', () => {
    expect(memberOptionLabel(member(1, '王浩然', '后端开发', 5))).toBe(
      '王浩然 · 后端开发 · 5 项未完成',
    )
    expect(memberOptionLabel(member(2, '许文静', null, 0))).toBe('许文静 · 成员 · 0 项未完成')
  })

  test('按岗位分组，同岗位负载轻者在前', () => {
    const sorted = sortMembersForAssign([
      member(1, '甲', '测试', 3),
      member(2, '乙', '后端开发', 7),
      member(3, '丙', '后端开发', 2),
    ])
    // 岗位按拼音：测试(ce) < 后端开发(hou)；后端组内负载 2 < 7
    expect(sorted.map((m) => m.userId)).toEqual([1, 3, 2])
  })
})

describe('实时事件按类型派发', () => {
  afterEach(() => resetRealtimeClient())

  test('realtime:event 同时派发给按 type 订阅的监听者', () => {
    const client = getRealtimeClient()
    const byType = vi.fn()
    const generic = vi.fn()
    client.on('notification:arrived', byType)
    client.on('realtime:event', generic)
    const event = {
      type: 'notification:arrived',
      projectId: 0,
      entityId: 0,
      actorId: 0,
      occurredAt: '',
    }
    client.handleServerEvent(event)
    expect(generic).toHaveBeenCalledWith(event)
    expect(byType).toHaveBeenCalledWith(event)
  })
})

describe('项目权限作用域', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useAuthStore.setState({ permissions: [] })
  })

  function Probe() {
    const { can } = usePermissions()
    return <span data-testid="probe">{can('task:assign') ? 'can-assign' : 'no-assign'}</span>
  }

  test('组织级只有成员权限，作用域内并入项目角色下放的 task:assign', async () => {
    useAuthStore.setState({ permissions: ['task:view', 'task:update:self'], accessToken: 't' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { permissions: ['task:view', 'task:update', 'task:assign'] } }),
      })),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Probe />
        <ProjectPermissionScope projectId={3}>
          <Probe />
        </ProjectPermissionScope>
      </QueryClientProvider>,
    )
    const probes = () => screen.getAllByTestId('probe').map((el) => el.textContent)
    await waitFor(() => expect(probes()).toEqual(['no-assign', 'can-assign']))
  })
})
