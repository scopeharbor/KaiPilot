'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Edit3,
  FileText,
  Loader2,
  RotateCw,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'

interface ReviewPageProps {
  params: Promise<{ id: string; versionId: string }>
}

export default function PeriodicReportReviewPage(props: ReviewPageProps) {
  const params = use(props.params)
  const router = useRouter()
  const projectId = Number(params.id)
  const versionId = Number(params.versionId)
  const [versionData, setVersionData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inaccessible, setInaccessible] = useState(false)

  useEffect(() => {
    async function fetchVersion() {
      try {
        // 通过 API 获取版本详情（使用 V2 版本来端点）
        const token = localStorage.getItem('accessToken')
        const orgId = localStorage.getItem('currentOrganizationId')
        const res = await fetch(`/api/v1/projects/${projectId}/reports/v2/versions/${versionId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-organization-id': orgId ?? '1',
          },
        })
        if (res.status === 404) {
          setInaccessible(true)
          setLoading(false)
          return
        }
        if (!res.ok) {
          setError('无法加载报表信息')
          setLoading(false)
          return
        }
        const body = await res.json()
        setVersionData(body.data)
        setLoading(false)
      } catch {
        setError('网络错误，请稍后重试')
        setLoading(false)
      }
    }
    void fetchVersion()
  }, [projectId, versionId])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">加载报表审阅...</p>
        </div>
      </div>
    )
  }

  if (inaccessible) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={AlertTriangle}
              title="目标不可访问"
              description="该报表审阅页面暂时无法访问，可能是因为您没有项目权限或报表已被删除。"
              action={
                <Button onClick={() => router.push(`/projects/${projectId}/reports-v2`)}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回报表工作台
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={AlertTriangle}
              title="加载失败"
              description={error}
              action={
                <Button onClick={() => window.location.reload()}>
                  <RotateCw className="mr-2 h-4 w-4" />
                  重试
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  const draft = versionData?.aiDraft
    ? ((typeof versionData.aiDraft === 'string'
        ? JSON.parse(versionData.aiDraft as string)
        : versionData.aiDraft) as Record<string, unknown>)
    : null
  const reviewStatus = (versionData?.aiReviewStatus as string) ?? 'unknown'
  const statusLabel: Record<string, { label: string; icon: typeof Clock; color: string }> = {
    pending_review: { label: '待审核', icon: Clock, color: 'text-amber-500' },
    confirmed: { label: '已确认', icon: CheckCircle, color: 'text-green-500' },
    rejected: { label: '已退回', icon: XCircle, color: 'text-red-500' },
    editing: { label: '编辑中', icon: Edit3, color: 'text-blue-500' },
  }
  const statusInfo = statusLabel[reviewStatus] ?? {
    label: reviewStatus,
    icon: Clock,
    color: 'text-muted-foreground',
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 导航 */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/projects/${projectId}/reports-v2`)}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回
        </Button>
      </div>

      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{(versionData?.title as string) ?? 'AI 周期报表'}</h1>
          <p className="text-sm text-muted-foreground">版本 #{versionId}</p>
        </div>
        <Badge variant="outline" className={statusInfo.color}>
          <statusInfo.icon className="mr-1 h-3 w-3" />
          {statusInfo.label}
        </Badge>
      </div>

      {/* 草稿内容 */}
      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle>AI 草稿</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Section title="管理摘要" content={draft.executiveSummary as string} />
            {Array.isArray(draft.highlights) && draft.highlights.length > 0 && (
              <Section title="亮点" content={(draft.highlights as string[]).join('\n')} isList />
            )}
            <Section title="进度叙述" content={draft.progressNarrative as string} />
            <Section title="风险与问题" content={draft.riskAndIssues as string} />
            <Section title="资源说明" content={draft.resourceNotes as string} />
            <Section title="变更说明" content={draft.changeNotes as string} />
            {Array.isArray(draft.suggestedActions) && draft.suggestedActions.length > 0 && (
              <Section
                title="建议行动"
                content={(draft.suggestedActions as string[]).join('\n')}
                isList
              />
            )}
            <Section title="数据限制" content={draft.dataWarningsNarrative as string} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={FileText}
          title="无草稿内容"
          description="该版本暂无可用的 AI 草稿内容。"
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 章节组件
// ---------------------------------------------------------------------------

function Section({ title, content, isList }: { title: string; content: string; isList?: boolean }) {
  if (!content || content === '暂无可用数据。') return null
  return (
    <div>
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      {isList ? (
        <ul className="list-disc list-inside text-sm text-muted-foreground">
          {content
            .split('\n')
            .filter(Boolean)
            .map((item, i) => (
              <li key={i}>{item}</li>
            ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{content}</p>
      )}
    </div>
  )
}
