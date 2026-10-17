'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { BarChart3, FileText, Loader2 } from 'lucide-react'
import type { V2PreviewRequest, V2ReportTemplateId } from '@aiproj/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useV2CreateVersion,
  useV2ListVersions,
  useV2Preview,
  useV2Templates,
} from '@/hooks/use-reports-v2'

export default function ProjectReportsV2Page() {
  const params = useParams()
  const projectId = Number(params.id)
  const [selectedTemplate, setSelectedTemplate] = useState<V2ReportTemplateId>('progress')
  const [enableAi, setEnableAi] = useState(false)
  const [previewReq, setPreviewReq] = useState<V2PreviewRequest | null>(null)

  // Queries
  const templatesQuery = useV2Templates(projectId)
  const previewQuery = useV2Preview(projectId, previewReq)
  const versionsQuery = useV2ListVersions(projectId)
  const createVersion = useV2CreateVersion(projectId)

  // 选择模板并预览
  function handlePreview() {
    setPreviewReq({
      templateId: selectedTemplate,
      enableAiDraft: enableAi,
    })
  }

  // 确认生成
  async function handleGenerate() {
    if (!previewReq || previewQuery.data?.data.blocking) return
    await createVersion.mutateAsync({
      templateId: previewReq.templateId,
      enableAiDraft: previewReq.enableAiDraft,
      previewSnapshotHash: 'v2-preview',
    })
  }

  const templates = templatesQuery.data?.data ?? []
  const preview = previewQuery.data?.data ?? null
  const versions = versionsQuery.data?.data ?? []
  const isBlocking = preview?.blocking ?? false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">报表工作台（V2）</h1>
        <p className="text-muted-foreground text-sm">选择模板并生成专业项目报表</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* 左侧：模板目录与生成参数 */}
        <div className="space-y-4">
          {/* 模板列表 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">模板目录</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {templatesQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : templates.length === 0 ? (
                <EmptyState icon={FileText} title="暂无可用模板" description="暂无可用报表模板" />
              ) : (
                templates.map((t) => (
                  <button
                    key={t.templateId}
                    onClick={() => setSelectedTemplate(t.templateId)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedTemplate === t.templateId
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{t.description}</div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* 参数区 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">生成参数</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enableAi}
                  onChange={(e) => setEnableAi(e.target.checked)}
                  className="rounded"
                />
                <span>启用 AI 草稿</span>
              </label>

              <div className="flex gap-2">
                <Button
                  onClick={handlePreview}
                  disabled={previewQuery.isFetching}
                  variant="secondary"
                >
                  {previewQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  预览
                </Button>
                <Button onClick={handleGenerate} disabled={isBlocking || createVersion.isPending}>
                  {createVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  生成
                </Button>
              </div>

              {isBlocking && (
                <div role="alert" className="text-sm text-danger">
                  存在阻塞警告，无法生成。请检查必需数据源可用性。
                </div>
              )}

              {createVersion.isError && (
                <div role="alert" className="text-sm text-danger">
                  生成失败：{String(createVersion.error)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧：预览与版本 */}
        <div className="space-y-4">
          {/* 预览区 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">预览</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {previewQuery.isFetching ? (
                <Skeleton className="h-60 w-full" />
              ) : preview ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{preview.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {preview.exportFormats.join(', ')}
                    </span>
                  </div>

                  {preview.warnings.length > 0 && (
                    <div className="text-sm space-y-1">
                      <p className="font-medium text-warning">警告：</p>
                      {preview.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span
                            className={`shrink-0 px-1 py-0.5 rounded ${
                              w.level === 'critical'
                                ? 'bg-danger/10 text-danger'
                                : w.level === 'warning'
                                  ? 'bg-warning/10 text-warning'
                                  : 'bg-info/10 text-info'
                            }`}
                          >
                            {w.code}
                          </span>
                          <span>{w.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    AI 草稿：{preview.aiEnabled ? '已启用' : '未启用'}
                    {preview.blocking && <span className="ml-2 text-danger">（阻塞）</span>}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  title="选择模板"
                  description="选择模板并点击预览查看结果"
                />
              )}
            </CardContent>
          </Card>

          {/* 版本列表 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">版本历史</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {versionsQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : versions.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">暂无版本记录</div>
              ) : (
                <div className="space-y-2">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between text-sm p-2 rounded-md hover:bg-muted"
                    >
                      <div>
                        <span className="font-medium">{v.title}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{v.templateId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            v.aiReviewStatus === 'confirmed'
                              ? 'bg-success/10 text-success'
                              : v.aiReviewStatus === 'pending_review'
                                ? 'bg-warning/10 text-warning'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {v.aiReviewStatus === 'confirmed'
                            ? '已确认'
                            : v.aiReviewStatus === 'pending_review'
                              ? '待审核'
                              : v.aiReviewStatus}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
