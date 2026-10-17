import { beforeEach, describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

function login(permissions: string[], isSuperAdmin = false) {
  useAuthStore.getState().setSession({
    user: { id: 1, email: 'a@b.com', fullName: '甲', isSuperAdmin, organizations: [] },
    accessToken: accessTokenWith(permissions),
    refreshToken: 'r',
  })
}

describe('components/PermissionGuard', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
  })

  test('有权限时渲染子内容', () => {
    login(['task:create'])
    render(
      <PermissionGuard require="task:create">
        <button>新建任务</button>
      </PermissionGuard>,
    )
    expect(screen.getByRole('button', { name: '新建任务' })).toBeInTheDocument()
  })

  test('无权限时隐藏（默认不渲染）', () => {
    login(['task:view'])
    render(
      <PermissionGuard require="task:create">
        <button>新建任务</button>
      </PermissionGuard>,
    )
    expect(screen.queryByRole('button', { name: '新建任务' })).not.toBeInTheDocument()
  })

  test('无权限时渲染 fallback 降级内容', () => {
    login(['task:view'])
    render(
      <PermissionGuard require="task:create" fallback={<span>无权限</span>}>
        <button>新建任务</button>
      </PermissionGuard>,
    )
    expect(screen.getByText('无权限')).toBeInTheDocument()
  })

  test('mode=any：具备任一权限即渲染', () => {
    login(['task:view'])
    render(
      <PermissionGuard require={['task:create', 'task:view']} mode="any">
        <span>可见</span>
      </PermissionGuard>,
    )
    expect(screen.getByText('可见')).toBeInTheDocument()
  })

  test('mode=all：缺一权限即隐藏', () => {
    login(['task:view'])
    render(
      <PermissionGuard require={['task:create', 'task:view']} mode="all">
        <span>可见</span>
      </PermissionGuard>,
    )
    expect(screen.queryByText('可见')).not.toBeInTheDocument()
  })

  test('系统管理员放行任意权限门控', () => {
    login([], true)
    render(
      <PermissionGuard require="org:manage">
        <span>管理入口</span>
      </PermissionGuard>,
    )
    expect(screen.getByText('管理入口')).toBeInTheDocument()
  })
})
