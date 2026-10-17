'use client'

import React, { useState, useCallback, useRef } from 'react'
import {
  useOcrDocumentJobs,
  useOcrDocumentJobDetail,
  useOcrDocumentCandidates,
  useOcrDocumentExtractions,
  useOcrDocumentJobCreate,
  useOcrDocumentJobRetry,
  useOcrDocumentJobConfirm,
} from '@/hooks/use-ocr-document'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog'

interface OcrDocumentUploadPanelProps {
  projectId: number
  readOnly?: boolean
  /**
   * 以已有项目附件为来源发起 OCR。面板自身只提供文件上传入口，
   * 附件来源由嵌入方（如附件详情页）传入，故用 prop 而非内部 state。
   */
  sourceAttachmentId?: number | null
}

const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  normalizing: '归一化中',
  processing: '处理中',
  reviewable: '可审查',
  failed: '失败',
  canceled: '已取消',
}
const STATUS_VARIANTS: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  queued: 'neutral',
  normalizing: 'info',
  processing: 'info',
  reviewable: 'success',
  failed: 'danger',
  canceled: 'warning',
}

export default function OcrDocumentUploadPanel({
  projectId,
  readOnly = false,
  sourceAttachmentId = null,
}: OcrDocumentUploadPanelProps) {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [promptHint, setPromptHint] = useState('')
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [modelId, setModelId] = useState<number | null>(null)
  const [pageLimit, setPageLimit] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Queries
  const { data: jobsData, isLoading: jobsLoading } = useOcrDocumentJobs(projectId)
  const { data: jobDetail, isLoading: jobLoading } = useOcrDocumentJobDetail(
    projectId,
    selectedJobId ?? 0,
    selectedJobId !== null,
  )
  const { data: candidatesData } = useOcrDocumentCandidates(
    projectId,
    selectedJobId ?? 0,
    selectedJobId !== null,
  )
  const { data: extractionsData } = useOcrDocumentExtractions(
    projectId,
    selectedJobId ?? 0,
    selectedJobId !== null,
  )

  // Mutations
  const createMutation = useOcrDocumentJobCreate(projectId)
  const retryMutation = useOcrDocumentJobRetry(projectId, selectedJobId ?? 0)
  const confirmMutation = useOcrDocumentJobConfirm(projectId, selectedJobId ?? 0)

  // Local state
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<(number | string)[]>([])
  const [reviewNote, setReviewNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setUploadFile(file)
  }, [])

  const handleCreate = async () => {
    if (!uploadFile && !sourceAttachmentId) return
    try {
      await createMutation.mutateAsync({
        file: uploadFile ?? undefined,
        sourceAttachmentId: sourceAttachmentId ?? undefined,
        connectionId: connectionId ?? undefined,
        modelId: modelId ?? undefined,
        promptHint: promptHint || undefined,
        pageLimit: pageLimit ?? undefined,
      })
      setShowCreateDialog(false)
      setUploadFile(null)
      setPromptHint('')
    } catch {
      // handled by mutation
    }
  }

  const handleRetry = async () => {
    if (!selectedJobId) return
    try {
      await retryMutation.mutateAsync({})
    } catch {
      // handled by mutation
    }
  }

  const handleConfirm = async () => {
    if (!selectedJobId || selectedCandidateIds.length === 0) return
    try {
      await confirmMutation.mutateAsync({
        candidateIds: selectedCandidateIds,
        reviewNote: reviewNote || null,
      })
      setSelectedCandidateIds([])
      setReviewNote('')
      setConfirmed(false)
    } catch {
      // handled by mutation
    }
  }

  const toggleCandidate = (candidateId: number | string) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateId) ? prev.filter((id) => id !== candidateId) : [...prev, candidateId],
    )
  }

  // Permission gate
  if (readOnly) {
    return (
      <Alert className="mt-4">
        <AlertDescription>
          您当前为只读访问。OCR 文档作业需要 file:manage 和 ai:trigger 权限。
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">OCR 文档作业</h3>
        <Button onClick={() => setShowCreateDialog(true)} disabled={readOnly}>
          新建 OCR 作业
        </Button>
      </div>

      {/* 创建对话框 */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建 OCR 文档作业</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* 文件上传 */}
            <div>
              <label className="text-sm font-medium">上传文件</label>
              <p className="text-xs text-muted-foreground mb-1">
                支持 PNG / JPEG / WebP / PDF（最大 20MB）
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                accept={SUPPORTED_TYPES.join(',')}
                onChange={handleFileSelect}
              />
              {uploadFile && (
                <p className="text-xs text-muted-foreground mt-1">
                  已选择：{uploadFile.name}（{(uploadFile.size / 1024).toFixed(1)} KB）
                </p>
              )}
            </div>

            {/* 提示词 */}
            <div>
              <label className="text-sm font-medium">提示词（可选）</label>
              <Textarea
                value={promptHint}
                onChange={(e) => setPromptHint(e.target.value)}
                placeholder="例如：提取所有中文文字"
                className="mt-1"
                rows={2}
                maxLength={500}
              />
            </div>

            {/* 模型选择 */}
            <div>
              <label className="text-sm font-medium">AI 连接 ID（可选）</label>
              <Input
                type="number"
                value={connectionId ?? ''}
                onChange={(e) => setConnectionId(e.target.value ? Number(e.target.value) : null)}
                placeholder="留空使用默认"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">模型 ID（可选）</label>
              <Input
                type="number"
                value={modelId ?? ''}
                onChange={(e) => setModelId(e.target.value ? Number(e.target.value) : null)}
                placeholder="留空使用默认"
                className="mt-1"
              />
            </div>

            {/* 页面限制（PDF 专用） */}
            <div>
              <label className="text-sm font-medium">页面限制（可选，仅 PDF）</label>
              <p className="text-xs text-muted-foreground mb-1">
                限制 OCR 处理的最大页数（1-50），超出部分将记录为跳过页
              </p>
              <Input
                type="number"
                min={1}
                max={50}
                value={pageLimit ?? ''}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null
                  setPageLimit(v && v > 0 ? Math.min(v, 50) : null)
                }}
                placeholder="不限制"
                className="mt-1"
              />
              {uploadFile && uploadFile.type === 'application/pdf' && (
                <p className="text-xs text-muted-foreground mt-1">
                  对于 PDF 文件，建议设置页面上限以避免意外的高成本。
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                disabled={createMutation.isPending}
              >
                取消
              </Button>
              <Button onClick={handleCreate} disabled={!uploadFile || createMutation.isPending}>
                {createMutation.isPending ? '创建中...' : '创建'}
              </Button>
            </div>

            {createMutation.isError && (
              <Alert variant="danger">
                <AlertDescription>
                  {createMutation.error instanceof Error
                    ? createMutation.error.message
                    : '创建失败'}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 作业列表 */}
      {jobsLoading && (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {jobsData && jobsData.data.length === 0 && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground text-center py-8">
            暂无 OCR 文档作业。点击「新建 OCR 作业」开始。
          </p>
        </Card>
      )}

      {jobsData && jobsData.data.length > 0 && (
        <div className="space-y-3">
          {jobsData.data.map((job) => (
            <Card
              key={job.id}
              className={`p-4 cursor-pointer transition-colors hover:border-primary/50 ${
                selectedJobId === Number(job.id) ? 'border-primary ring-1 ring-primary' : ''
              }`}
              onClick={() => setSelectedJobId(Number(job.id))}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium truncate max-w-[300px]">
                    {job.sourceFileName ?? '未知文件'}
                  </span>
                  <Badge variant={STATUS_VARIANTS[job.status] ?? 'neutral'}>
                    {STATUS_LABELS[job.status] ?? job.status}
                  </Badge>
                  {job.provider && (
                    <span className="text-xs text-muted-foreground">
                      {job.provider}/{job.model}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {job.status === 'processing' ? (
                    <span>
                      已处理 {job.succeededPages}/{job.pageCount} 页
                    </span>
                  ) : job.status === 'reviewable' ? (
                    <span>
                      {job.succeededPages}/{job.pageCount} 页可审查
                    </span>
                  ) : null}
                  <span>{job.sourceKind === 'upload' ? '上传' : '附件'}</span>
                  <span>{new Date(job.createdAt as string).toLocaleString('zh-CN')}</span>
                </div>
              </div>
              {job.warningCodes.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {job.warningCodes.map((code) => (
                    <Badge key={code} variant="warning" className="text-xs">
                      {code}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* 作业详情 */}
      {selectedJobId && jobLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {selectedJobId && jobDetail && (
        <div className="space-y-4 pl-2 border-l-2 border-primary/30">
          {/* 作业摘要 */}
          <Card className="p-4">
            <h4 className="font-medium mb-3">作业详情</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">状态：</span>
                <Badge variant={STATUS_VARIANTS[jobDetail.data.status] ?? 'neutral'}>
                  {STATUS_LABELS[jobDetail.data.status] ?? jobDetail.data.status}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">页数：</span>
                {jobDetail.data.succeededPages}/{jobDetail.data.pageCount} 成功
                {jobDetail.data.failedPages > 0 && (
                  <Badge variant="warning" className="ml-1">
                    {jobDetail.data.failedPages} 失败
                  </Badge>
                )}
              </div>
              {jobDetail.data.provider && (
                <div>
                  <span className="text-muted-foreground">模型：</span>
                  {jobDetail.data.provider}/{jobDetail.data.model}
                </div>
              )}
              {jobDetail.data.costSummary && (
                <div>
                  <span className="text-muted-foreground">Token：</span>
                  {jobDetail.data.costSummary.totalTokens.toLocaleString()}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-3">
              {['reviewable', 'failed'].includes(jobDetail.data.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetry}
                  disabled={retryMutation.isPending || readOnly}
                >
                  {retryMutation.isPending ? '重试中...' : '重新执行'}
                </Button>
              )}
            </div>
          </Card>

          {/* 页面/候选文本 */}
          {candidatesData && candidatesData.data.length > 0 && (
            <Card className="p-4">
              <h4 className="font-medium mb-3">提取文本（{candidatesData.data.length} 页）</h4>
              <div className="space-y-2">
                {candidatesData.data.map((candidate, idx) => (
                  <div
                    key={candidate.id}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedCandidateIds.includes(candidate.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    } ${candidate.status === 'failed' ? 'opacity-60' : ''}`}
                    onClick={() => {
                      if (candidate.status !== 'failed') {
                        toggleCandidate(candidate.id)
                      }
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">第 {idx + 1} 页</span>
                      <div className="flex items-center gap-2">
                        {candidate.confidenceScore !== null &&
                          candidate.confidenceScore !== undefined && (
                            <Badge
                              variant={
                                candidate.confidenceScore >= 0.8
                                  ? 'success'
                                  : candidate.confidenceScore >= 0.5
                                    ? 'warning'
                                    : 'danger'
                              }
                            >
                              置信度 {Math.round(candidate.confidenceScore * 100)}%
                            </Badge>
                          )}
                        {candidate.provider && (
                          <span className="text-xs text-muted-foreground">
                            {candidate.provider}/{candidate.model}
                          </span>
                        )}
                        {candidate.status === 'failed' && <Badge variant="danger">提取失败</Badge>}
                        <Checkbox
                          checked={selectedCandidateIds.includes(candidate.id)}
                          disabled={candidate.status === 'failed'}
                        />
                      </div>
                    </div>
                    <pre className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
                      {candidate.extractedText ?? '（无文本）'}
                    </pre>
                    {candidate.warnings.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {candidate.warnings.map((w, wi) => (
                          <Badge key={wi} variant="warning" className="text-xs">
                            {w.code}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 无候选提示 */}
          {candidatesData &&
            candidatesData.data.length === 0 &&
            jobDetail.data.status === 'reviewable' && (
              <Card className="p-4">
                <p className="text-sm text-muted-foreground text-center py-4">
                  暂无 OCR 候选数据。请重新运行作业。
                </p>
              </Card>
            )}

          {/* 确认操作 */}
          {jobDetail.data.status === 'reviewable' &&
            candidatesData &&
            candidatesData.data.length > 0 && (
              <Card className="p-4">
                <h4 className="font-medium mb-3">确认操作</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">审查备注（可选）</label>
                    <Textarea
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="添加审查备注..."
                      className="mt-1"
                      rows={2}
                      maxLength={1000}
                      disabled={readOnly}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="confirm-ocr-doc"
                      checked={confirmed}
                      onCheckedChange={(v) => setConfirmed(v === true)}
                      disabled={selectedCandidateIds.length === 0 || readOnly}
                    />
                    <label htmlFor="confirm-ocr-doc" className="text-sm">
                      我确认要保存选中的 OCR 提取文本。此操作不会自动修改任何项目数据。
                    </label>
                  </div>
                  <Button
                    onClick={handleConfirm}
                    disabled={
                      !confirmed ||
                      selectedCandidateIds.length === 0 ||
                      confirmMutation.isPending ||
                      readOnly
                    }
                    className="w-full"
                  >
                    {confirmMutation.isPending
                      ? '保存中...'
                      : `确认保存（${selectedCandidateIds.length} 页）`}
                  </Button>
                </div>

                {confirmMutation.isError && (
                  <Alert variant="danger" className="mt-3">
                    <AlertDescription>
                      {confirmMutation.error instanceof Error
                        ? confirmMutation.error.message
                        : '保存失败'}
                    </AlertDescription>
                  </Alert>
                )}

                {confirmMutation.isSuccess && (
                  <Alert className="mt-3 border-green-500">
                    <AlertDescription>确认保存成功！</AlertDescription>
                  </Alert>
                )}
              </Card>
            )}

          {/* 已接受提取历史 */}
          {extractionsData && extractionsData.data.length > 0 && (
            <Card className="p-4">
              <h4 className="font-medium mb-3">已接受的提取记录</h4>
              <div className="space-y-2">
                {extractionsData.data.map((ext) => (
                  <div
                    key={ext.id}
                    className="flex items-center justify-between p-2 border rounded text-sm"
                  >
                    <div>
                      <Badge variant={ext.status === 'active' ? 'success' : 'neutral'}>
                        {ext.status === 'active' ? '当前' : '已替代'}
                      </Badge>
                      <span className="ml-2 text-muted-foreground">审查者 #{ext.reviewerId}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(ext.createdAt as string).toLocaleString('zh-CN')}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
