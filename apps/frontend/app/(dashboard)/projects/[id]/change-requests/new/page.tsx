'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import {
  changeRequestKeys,
  createChangeRequest,
  type ChangeRequestType,
  type ChangeRequestPriority,
  type ChangeRequestImpactSummary,
} from '@/lib/api/change-requests'

const TYPE_OPTIONS: { value: ChangeRequestType; label: string }[] = [
  { value: 'scope', label: '范围' },
  { value: 'schedule', label: '进度' },
  { value: 'cost', label: '成本' },
  { value: 'resource', label: '资源' },
  { value: 'quality', label: '质量' },
  { value: 'risk', label: '风险' },
  { value: 'other', label: '其他' },
]

const PRIORITY_OPTIONS: { value: ChangeRequestPriority; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
]

const IMPACT_FIELDS: { key: keyof ChangeRequestImpactSummary; label: string }[] = [
  { key: 'scope', label: '范围影响' },
  { key: 'schedule', label: '进度影响' },
  { key: 'resources', label: '资源影响' },
  { key: 'cost', label: '成本影响' },
  { key: 'risks', label: '风险' },
  { key: 'assumptions', label: '假设' },
]

export default function NewChangeRequestPage() {
  const projectId = Number(useParams().id)
  return (
    <PermissionGuard
      require="change_request:create"
      fallback={<Alert className="my-8">无权创建变更请求</Alert>}
    >
      <NewChangeRequestForm projectId={projectId} />
    </PermissionGuard>
  )
}

function NewChangeRequestForm({ projectId }: { projectId: number }) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [changeType, setChangeType] = useState<ChangeRequestType>('other')
  const [priority, setPriority] = useState<ChangeRequestPriority>('medium')
  const [impactSummary, setImpactSummary] = useState<ChangeRequestImpactSummary>({})

  const create = useMutation({
    mutationFn: () =>
      createChangeRequest(projectId, {
        title,
        description: description || undefined,
        changeType,
        priority,
        impactSummary: Object.values(impactSummary).some(Boolean) ? impactSummary : undefined,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: changeRequestKeys.all })
      router.push(`/projects/${projectId}/change-requests/${result.data.id}`)
    },
  })

  const updateImpact = (key: keyof ChangeRequestImpactSummary, value: string) => {
    setImpactSummary((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/change-requests`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回变更请求列表
      </Link>

      <h1 className="text-2xl font-bold">新建变更请求</h1>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">标题 *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="变更请求标题"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="详细描述变更内容"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">变更类型</label>
              <select
                value={changeType}
                onChange={(e) => setChangeType(e.target.value as ChangeRequestType)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">优先级</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as ChangeRequestPriority)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>影响摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {IMPACT_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="text-sm font-medium">{field.label}</label>
              <textarea
                value={impactSummary[field.key] ?? ''}
                onChange={(e) => updateImpact(field.key, e.target.value)}
                placeholder={`描述${field.label}`}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                rows={2}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {create.isError && (
        <Alert variant="danger">创建失败：{create.error?.message || '请检查输入'}</Alert>
      )}

      <div className="flex justify-end gap-2">
        <Link href={`/projects/${projectId}/change-requests`}>
          <Button variant="outline">取消</Button>
        </Link>
        <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>
          {create.isPending ? '创建中...' : '创建草稿'}
        </Button>
      </div>
    </div>
  )
}
