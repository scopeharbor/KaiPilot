'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  Shield,
  Plus,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  RefreshCw,
} from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { RiskRegisterTable } from '@/components/views/risks/RiskRegisterTable'
import { RiskMatrix5x5 } from '@/components/views/risks/RiskMatrix5x5'
import { RiskDetailDrawer } from '@/components/views/risks/RiskDetailDrawer'
import { RiskAiSuggestionDrawer } from '@/components/views/risks/RiskAiSuggestionDrawer'
import { RiskCandidateList } from '@/components/views/risks/RiskCandidateList'
import {
  useRiskSummary,
  useReviewQueue,
  useEvaluateCandidates,
  useAcceptCandidate,
  useRejectCandidate,
} from '@/hooks/use-risks-v2'
import type { Risk } from '@/lib/api/risks'
import type { RiskSignalCandidate } from '@/lib/api/risks-v2'

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  loading,
}: {
  icon: React.FC<{ className?: string }>
  label: string
  value: string | number
  color: string
  loading?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-lg p-2 ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          {loading ? (
            <div className="space-y-1">
              <div className="h-7 w-16 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-12 bg-gray-100 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard icon={AlertTriangle} label="总风险数" value="" color="bg-gray-500" loading />
      <StatCard icon={AlertTriangle} label="高/严重风险" value="" color="bg-red-500" loading />
      <StatCard icon={Clock} label="逾期复查" value="" color="bg-amber-500" loading />
      <StatCard icon={CheckCircle} label="健康分" value="" color="bg-green-500" loading />
    </div>
  )
}

export default function ProjectRisksPage() {
  const params = useParams()
  const projectId = Number(params.id)
  const [view, setView] = useState<'workbench' | 'table' | 'matrix'>('workbench')
  const [selectedRisk, setSelectedRisk] = useState<Risk | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)
  const [candidates, setCandidates] = useState<RiskSignalCandidate[]>([])
  const [acceptTarget, setAcceptTarget] = useState<RiskSignalCandidate | null>(null)
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false)

  const {
    data: summaryRes,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useRiskSummary(projectId)
  const { data: reviewRes } = useReviewQueue(projectId)
  const evaluateMutation = useEvaluateCandidates(projectId)
  const acceptMutation = useAcceptCandidate(projectId)
  const rejectMutation = useRejectCandidate(projectId)
  const { toast } = useToast()

  const summary = summaryRes?.data
  const reviews = reviewRes?.data ?? []
  const isPendingAction =
    evaluateMutation.isPending || acceptMutation.isPending || rejectMutation.isPending

  const handleRiskClick = (risk: Risk) => {
    setSelectedRisk(risk)
    setDetailOpen(true)
  }

  const handleMatrixCellClick = (_probability: number, _impact: number) => {
    setView('matrix')
  }

  const handleEvaluateCandidates = async () => {
    const res = await evaluateMutation.mutateAsync()
    if (res?.data) setCandidates(res.data as unknown as RiskSignalCandidate[])
  }

  const handleAcceptClick = (candidate: RiskSignalCandidate) => {
    setAcceptTarget(candidate)
    setAcceptDialogOpen(true)
  }

  const handleAcceptConfirm = useCallback(async () => {
    if (!acceptTarget) return
    await acceptMutation.mutateAsync({ candidateId: acceptTarget.id })
    toast({
      variant: 'success',
      title: '已采纳风险候选',
      description: `${acceptTarget.recommendedAction.slice(0, 60)}…`,
    })
    setAcceptDialogOpen(false)
    setAcceptTarget(null)
    setCandidates((prev) => prev.filter((c) => c.id !== acceptTarget.id))
    refetchSummary()
  }, [acceptTarget, acceptMutation, toast, refetchSummary])

  const handleReject = async (candidate: RiskSignalCandidate) => {
    await rejectMutation.mutateAsync(candidate.id)
    setCandidates((prev) => prev.filter((c) => c.id !== candidate.id))
  }

  return (
    <div className="space-y-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-gray-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">风险工作台</h1>
            <p className="text-sm text-gray-500">项目风险评估、跟踪与应对</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 只读提示 */}
          <PermissionGuard
            require="risk:manage"
            fallback={<span className="text-xs text-gray-400 mr-2">只读模式</span>}
          >
            <span className="hidden" />
          </PermissionGuard>

          <PermissionGuard require="risk:manage">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEvaluateCandidates}
              disabled={isPendingAction}
            >
              <TrendingUp className="h-4 w-4 mr-1" />
              {evaluateMutation.isPending ? '评估中...' : '规则评估'}
            </Button>
          </PermissionGuard>
          <PermissionGuard require="risk:manage">
            <Button variant="outline" size="sm" onClick={() => setAiDrawerOpen(true)}>
              <Sparkles className="h-4 w-4 mr-1" />
              AI 建议
            </Button>
          </PermissionGuard>
          <PermissionGuard require="risk:manage">
            <Button size="sm" disabled={isPendingAction}>
              <Plus className="h-4 w-4 mr-1" />
              新建风险
            </Button>
          </PermissionGuard>
        </div>
      </div>

      {/* 错误状态 */}
      {summaryError && !summaryLoading && (
        <Card variant="outlined">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-danger" />
            <p className="text-sm text-gray-600 mb-3">加载风险摘要失败</p>
            <Button variant="outline" size="sm" onClick={() => refetchSummary()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 摘要统计卡片 */}
      {summaryLoading && !summaryError && <LoadingSkeleton />}

      {!summaryLoading && !summaryError && summary && (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={AlertTriangle}
              label="总风险数"
              value={summary.totalRisks}
              color="bg-gray-500"
            />
            <StatCard
              icon={AlertTriangle}
              label="高/严重风险"
              value={summary.highRiskCount + summary.criticalRiskCount}
              color="bg-red-500"
            />
            <StatCard
              icon={Clock}
              label="逾期复查"
              value={summary.overdueReviewCount}
              color="bg-amber-500"
            />
            <StatCard
              icon={CheckCircle}
              label="健康分"
              value={summary.healthScore ?? 'N/A'}
              color={
                summary.healthScore && summary.healthScore >= 60 ? 'bg-green-500' : 'bg-amber-500'
              }
            />
          </div>

          {/* 空风险状态 */}
          {summary.totalRisks === 0 && candidates.length === 0 && (
            <Card variant="outlined">
              <CardContent className="p-8 text-center">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 font-medium">暂无风险</p>
                <p className="text-sm text-gray-400 mt-1">使用规则评估或 AI 建议来识别项目风险</p>
              </CardContent>
            </Card>
          )}

          {/* Top 风险 */}
          {summary.totalRisks > 0 && summary.topRisks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top 风险</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {summary.topRisks.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-2 rounded hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleRiskClick(r as unknown as Risk)}
                    >
                      <span className="text-sm font-medium">{r.title}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          r.riskLevel === 'critical'
                            ? 'bg-red-100 text-red-700'
                            : r.riskLevel === 'high'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {r.riskLevel}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top 风险为空（但存在风险） */}
          {summary.totalRisks > 0 && summary.topRisks.length === 0 && (
            <Card variant="outlined">
              <CardContent className="p-6 text-center text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                <p>当前无高风险，项目风险状态良好</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* 视图切换 */}
      <Tabs value={view} onValueChange={(v) => setView(v as 'workbench' | 'table' | 'matrix')}>
        <TabsList>
          <TabsTrigger value="workbench">工作台</TabsTrigger>
          <TabsTrigger value="table">登记册</TabsTrigger>
          <TabsTrigger value="matrix">矩阵</TabsTrigger>
        </TabsList>

        <TabsContent value="workbench" className="mt-4 space-y-4">
          {/* 复查队列 */}
          {reviews.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">待复查风险 ({reviews.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {reviews.slice(0, 5).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-2 rounded hover:bg-gray-50"
                    >
                      <span className="text-sm">{r.title}</span>
                      <span className="text-xs text-gray-500">
                        {r.nextReviewAt
                          ? `下次复查: ${new Date(r.nextReviewAt).toLocaleDateString('zh-CN')}`
                          : '未设置'}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 规则候选列表 */}
          {candidates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">规则风险候选 ({candidates.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <RiskCandidateList
                  candidates={candidates}
                  onAccept={handleAcceptClick}
                  onReject={handleReject}
                  isPendingAction={isPendingAction}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="table" className="mt-4">
          <RiskRegisterTable projectId={projectId} onRiskClick={handleRiskClick} />
        </TabsContent>

        <TabsContent value="matrix" className="mt-4">
          <RiskMatrix5x5 projectId={projectId} onCellClick={handleMatrixCellClick} />
        </TabsContent>
      </Tabs>

      {/* 采纳候选确认对话框 */}
      <Dialog open={acceptDialogOpen} onOpenChange={setAcceptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认采纳风险候选</DialogTitle>
            <DialogDescription>
              采纳后系统将自动创建正式风险记录，请在确认前检查以下内容
            </DialogDescription>
          </DialogHeader>

          {acceptTarget && (
            <div className="space-y-3 py-2">
              <div>
                <span className="text-xs text-gray-500">建议行动</span>
                <p className="text-sm font-medium text-gray-800">
                  {acceptTarget.recommendedAction}
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>
                  严重度：
                  <Badge
                    variant={
                      acceptTarget.severity === 'critical' || acceptTarget.severity === 'high'
                        ? 'danger'
                        : 'warning'
                    }
                  >
                    {acceptTarget.severity}
                  </Badge>
                </span>
                <span>
                  规则：{acceptTarget.ruleId} v{acceptTarget.ruleVersion}
                </span>
                <span>置信度：{Math.round(acceptTarget.confidence * 100)}%</span>
              </div>
              {acceptTarget.evidence.length > 0 && (
                <div>
                  <span className="text-xs text-gray-500">证据项</span>
                  <ul className="list-disc list-inside text-xs text-gray-600 mt-1">
                    {acceptTarget.evidence.map((ev, idx) => (
                      <li key={idx}>
                        {ev.title}: {ev.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAcceptDialogOpen(false)
                setAcceptTarget(null)
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              onClick={handleAcceptConfirm}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? '采纳中...' : '确认采纳'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情抽屉 */}
      <RiskDetailDrawer
        risk={selectedRisk}
        projectId={projectId}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setSelectedRisk(null)
        }}
      />

      {/* AI 建议抽屉 */}
      <RiskAiSuggestionDrawer
        projectId={projectId}
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
      />
    </div>
  )
}
