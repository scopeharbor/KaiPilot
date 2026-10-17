'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import type { FormEvent } from 'react'
import { useState } from 'react'
import PermissionGuard from '@/components/PermissionGuard'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import {
  resourceKeys,
  resourcesApi,
  type CreateResourceInput,
  type ResourceType,
  type ResourceRole,
} from '@/lib/api/resources'

export default function NewResourcePage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const projectId = Number(params.id)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [resourceType, setResourceType] = useState<ResourceType>('human')
  const [role, setRole] = useState<ResourceRole>('member')
  const [dailyCapacityHours, setDailyCapacityHours] = useState('8')

  const create = useMutation({
    mutationFn: (input: CreateResourceInput) => resourcesApi.create(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceKeys.lists(projectId) })
      void queryClient.invalidateQueries({ queryKey: resourceKeys.all })
      router.push(`/projects/${projectId}/resources`)
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    create.mutate({
      name: name.trim(),
      email: email.trim() || null,
      resourceType,
      role,
      dailyCapacityHours: Number(dailyCapacityHours) || 8,
    })
  }

  return (
    <PermissionGuard
      require="resource:manage"
      fallback={<div className="p-6 text-muted-foreground">无权操作</div>}
    >
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push(`/projects/${projectId}/resources`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">添加资源</h1>
        </div>

        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">姓名 *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入姓名"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="可选"
                />
              </div>
              <div className="space-y-2">
                <Label>类型</Label>
                <Select
                  value={resourceType}
                  onValueChange={(v) => setResourceType(v as ResourceType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="human">人员</SelectItem>
                    <SelectItem value="material">物料</SelectItem>
                    <SelectItem value="equipment">设备</SelectItem>
                    <SelectItem value="budget">预算</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>角色</Label>
                <Select value={role} onValueChange={(v) => setRole(v as ResourceRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project_manager">项目经理</SelectItem>
                    <SelectItem value="team_lead">团队负责人</SelectItem>
                    <SelectItem value="member">成员</SelectItem>
                    <SelectItem value="viewer">观察者</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="hours">日产能（小时）</Label>
                <Input
                  id="hours"
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  value={dailyCapacityHours}
                  onChange={(e) => setDailyCapacityHours(e.target.value)}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? '创建中...' : '创建'}
                </Button>
                <Button variant="outline" onClick={() => router.back()}>
                  取消
                </Button>
              </div>
              {create.isError && (
                <p className="text-sm text-red-500">创建失败: {create.error?.message}</p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </PermissionGuard>
  )
}
