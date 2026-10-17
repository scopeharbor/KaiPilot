'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import PermissionGuard from '@/components/PermissionGuard'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { usersApi } from '@/lib/api-client'

export default function AdminUsersPage() {
  return (
    <PermissionGuard
      require="system:admin"
      fallback={<Alert className="my-8">无权访问用户管理</Alert>}
    >
      <AdminUsersContent />
    </PermissionGuard>
  )
}

function AdminUsersContent() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const users = useQuery({
    queryKey: ['users', { search }],
    queryFn: () => usersApi.list({ search: search || undefined }),
  })
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      usersApi.update(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div className="space-y-6 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-800 text-balance">用户管理</h1>
          <p className="text-sm text-gray-500">查看系统用户并管理账号启用状态。</p>
        </div>
        <Input
          className="sm:max-w-80"
          aria-label="搜索用户"
          placeholder="按姓名或邮箱搜索"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </header>

      {users.isLoading ? <UsersTableSkeleton /> : null}
      {users.isError ? <Alert variant="danger" title="用户加载失败" /> : null}
      {users.data && users.data.data.length === 0 ? (
        <EmptyState
          title={search ? '没有匹配的用户' : '暂无用户'}
          description={search ? '尝试使用其他姓名或邮箱搜索。' : '用户创建后会显示在这里。'}
        />
      ) : null}
      {users.data && users.data.data.length > 0 ? (
        <Card variant="outlined" className="overflow-x-auto">
          <Table>
            <TableCaption>用户列表</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>身份</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.data.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium text-gray-800">
                    {user.fullName || '未设置姓名'}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {user.isSuperAdmin ? (
                      <Badge variant="ai">
                        <ShieldCheck aria-hidden />
                        超级管理员
                      </Badge>
                    ) : (
                      <Badge>普通用户</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? 'success' : 'neutral'}>
                      {user.isActive ? '已启用' : '已禁用'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={`管理 ${user.email}`}
                          disabled={toggle.isPending}
                          loading={toggle.isPending}
                        >
                          <MoreHorizontal aria-hidden />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => toggle.mutate({ id: user.id, isActive: !user.isActive })}
                        >
                          {user.isActive ? '禁用账号' : '启用账号'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  )
}

function UsersTableSkeleton() {
  return (
    <Card variant="outlined" className="space-y-3 p-[var(--card-pad)]" aria-label="正在加载用户">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </Card>
  )
}
