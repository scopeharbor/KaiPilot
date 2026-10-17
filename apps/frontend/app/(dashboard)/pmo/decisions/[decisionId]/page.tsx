'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertCircle, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useCheckReadinessOnce,
  useCreateDecisionHandoff,
  useDecisionCase,
  useDecisionComparison,
  useDecisionHandoffs,
  useDecisionOptions,
  useDecisionOutcomes,
  useDecisionPositions,
  useDecisionSnapshots,
  useRecordDecisionPosition,
  useRefreshDecisionEvidence,
  useSubmitDecisionOutcome,
} from '@/hooks/use-decision-workbench'
import { requestAiNarrative, type AiNarrativeView } from '@/lib/api/decision-workbench'
import { usePermissions } from '@/hooks/use-permissions'
import type { PmoDecisionOutcomeAction } from '@aiproj/types'

/**
 * /pmo/decisions/[decisionId] —— 决策议题详情（tasks 10.3–10.7）。
 *
 * - lifecycle header：scope/owner/revision/supersession；终态只读
 * - evidence 面板：逐来源 available/stale/forbidden/unavailable/truncated 文本态
 *   （非 color-only），不渲染隐藏值/零值伪装
 * - 2–5 方案与确定性对比：无 winner 分数，not-comparable 显式
 * - readiness + 显式确认对话框（fingerprint 绑定）；blocking 时禁用终态按钮
 * - 立场/异议记录；outcome 历史；handoff 区明确「决策 ≠ 执行」
 */

const SOURCE_STATE_LABELS: Record<string, string> = {
  available: '可用',
  stale: '已过期',
  forbidden: '权限受限',
  unavailable: '不可用',
  truncated: '已截断',
}

const OUTCOME_ACTION_LABELS: Record<string, string> = {
  approve: '批准',
  reject: '否决',
  defer: '延后',
  'request-more-evidence': '要求补充证据',
  supersede: '由新议题取代',
}

export default function PmoDecisionDetailPage() {
  const params = useParams<{ decisionId: string }>()
  const decisionId = Number(params.decisionId)
  const { canAny } = usePermissions()
  const canManage = canAny(['pmo_decision:manage'])
  const canDecide = canAny(['pmo_decision:decide'])
  const canRequestAi = canAny(['pmo_decision:request_ai'])

  const caseQuery = useDecisionCase(Number.isFinite(decisionId) ? decisionId : null)
  const optionsQuery = useDecisionOptions(Number.isFinite(decisionId) ? decisionId : null)
  const positionsQuery = useDecisionPositions(Number.isFinite(decisionId) ? decisionId : null)
  const snapshotsQuery = useDecisionSnapshots(Number.isFinite(decisionId) ? decisionId : null)
  const comparisonQuery = useDecisionComparison(
    Number.isFinite(decisionId) ? decisionId : null,
    caseQuery.data?.revision ?? null,
  )
  const outcomesQuery = useDecisionOutcomes(Number.isFinite(decisionId) ? decisionId : null)
  const handoffsQuery = useDecisionHandoffs(Number.isFinite(decisionId) ? decisionId : null)

  const refreshEvidence = useRefreshDecisionEvidence(decisionId)
  const recordPosition = useRecordDecisionPosition(decisionId)
  const submitOutcome = useSubmitDecisionOutcome(decisionId)
  const createHandoff = useCreateDecisionHandoff(decisionId)
  const checkReadiness = useCheckReadinessOnce()

  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<PmoDecisionOutcomeAction | null>(null)
  const [rationaleDraft, setRationaleDraft] = useState('')
  const [readinessPacket, setReadinessPacket] = useState<Awaited<
    ReturnType<typeof checkReadiness.mutateAsync>
  > | null>(null)
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null)
  const [aiView, setAiView] = useState<AiNarrativeView | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const decision = caseQuery.data
  const isTerminal =
    decision !== undefined && ['decided', 'deferred', 'superseded'].includes(decision.status)
  const latestSnapshot = useMemo(() => snapshotsQuery.data?.[0] ?? null, [snapshotsQuery.data])
  const hasBlocking = (readinessPacket?.blockingFindings.length ?? 0) > 0

  if (caseQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (caseQuery.isError || !decision) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>决策议题不存在或无权访问。</AlertDescription>
        </Alert>
      </div>
    )
  }

  async function openConfirm(action: PmoDecisionOutcomeAction): Promise<void> {
    setDecisionError(null)
    try {
      const packet = await checkReadiness.mutateAsync({ decisionId })
      setReadinessPacket(packet)
      setConfirmAction(packet.ready || action === 'request-more-evidence' ? action : null)
      if (!packet.ready && action !== 'request-more-evidence') {
        setDecisionError('存在 blocking finding，无法进入结论；请刷新证据或补齐方案。')
      }
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'readiness 检查失败')
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" aria-label={`决策议题 ${decision.title}`}>
      {/* ── Lifecycle header（task 10.3）── */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{decision.title}</h1>
          <span
            className="rounded-full border border-gray-300 px-3 py-0.5 text-sm"
            data-status={decision.status}
          >
            {decision.status}
          </span>
          <span className="text-xs text-gray-400">修订 r{decision.revision}</span>
          {isTerminal && <span className="text-xs text-gray-500">终态只读</span>}
        </div>
        <p className="text-sm text-gray-600">{decision.decisionQuestion}</p>
        {decision.scopeSummary && (
          <p className="text-sm text-gray-400">范围：{decision.scopeSummary}</p>
        )}
        {decision.supersededByCaseId && (
          <Alert variant="warning" className="max-w-xl">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              本议题已被议题 #{decision.supersededByCaseId} 取代。
            </AlertDescription>
          </Alert>
        )}
      </header>

      {/* ── Evidence / freshness 面板（task 10.4）── */}
      <Card aria-label="证据与新鲜度">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">证据快照</CardTitle>
          {canManage && !isTerminal && (
            <Button
              size="sm"
              variant="outline"
              disabled={refreshEvidence.isPending}
              onClick={async () => {
                setDecisionError(null)
                try {
                  await refreshEvidence.mutateAsync()
                } catch (error) {
                  setDecisionError(error instanceof Error ? error.message : '证据刷新失败')
                }
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
              刷新证据
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {latestSnapshot === null ? (
            <p className="text-sm text-gray-500">尚无证据快照——请先「刷新证据」。</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
                <span>hash：{latestSnapshot.snapshotHash}</span>
                <span>整体状态：{latestSnapshot.readiness}</span>
                {latestSnapshot.truncated && <span>结果按预算截断</span>}
              </div>
              <ul className="space-y-1" aria-live="polite">
                {(latestSnapshot.sourceStates ?? []).map((sourceState) => (
                  <li
                    key={sourceState.source}
                    className="text-sm"
                    data-source-state={sourceState.state}
                  >
                    <span className="font-mono text-xs">{sourceState.source}</span>
                    {' —— '}
                    <span>{SOURCE_STATE_LABELS[sourceState.state] ?? sourceState.state}</span>
                    {sourceState.required && (
                      <span className="ml-1 text-xs text-gray-400">（必需）</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── 方案与对比（task 10.5）── */}
      <Card aria-label="候选方案对比">
        <CardHeader>
          <CardTitle className="text-base">候选方案（2–5 个）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(optionsQuery.data ?? []).map((option) => (
              <li key={option.id} className="rounded-lg border border-gray-200 p-3">
                <div className="font-medium">{option.label}</div>
                {option.assumptions.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-gray-500">
                    {option.assumptions.map((assumption) => (
                      <li key={assumption}>假设：{assumption}</li>
                    ))}
                  </ul>
                )}
                {option.constraints.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-gray-500">
                    {option.constraints.map((constraint) => (
                      <li key={constraint}>约束：{constraint}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {comparisonQuery.data && comparisonQuery.data.cells.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="确定性方案对比">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-1 pr-3">度量</th>
                    <th className="py-1 pr-3">基线值</th>
                    <th className="py-1 pr-3">对照值</th>
                    <th className="py-1 pr-3">Δ</th>
                    <th className="py-1">lens</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonQuery.data.cells.slice(0, 20).map((cell) => (
                    <tr
                      key={`${cell.lensId}:${cell.measureRef}`}
                      className="border-b last:border-0"
                    >
                      <td className="py-1 pr-3 font-mono text-xs">{cell.measureRef}</td>
                      <td className="py-1 pr-3">{cell.comparable ? cell.baselineValue : '—'}</td>
                      <td className="py-1 pr-3">{cell.comparable ? cell.candidateValue : '—'}</td>
                      <td className="py-1 pr-3">
                        {cell.comparable ? cell.delta : 'not-comparable'}
                      </td>
                      <td className="py-1 text-xs text-gray-400">{cell.lensId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-gray-400">
                对比仅投影权威事实（lens 版本{' '}
                {comparisonQuery.data.lensVersions.map((v) => v.version).join('、')}）；
                不生成总分或 winner。
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 立场 / 异议 ── */}
      <Card aria-label="参与者立场">
        <CardHeader>
          <CardTitle className="text-base">参与者立场</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isTerminal && (
            <div className="flex flex-wrap gap-2">
              {(['support', 'oppose', 'abstain'] as const).map((stance) => (
                <Button
                  key={stance}
                  size="sm"
                  variant="outline"
                  disabled={!canDecide && !canManage ? false : recordPosition.isPending}
                  onClick={async () => {
                    setDecisionError(null)
                    try {
                      await recordPosition.mutateAsync({ stance })
                    } catch (error) {
                      setDecisionError(error instanceof Error ? error.message : '立场记录失败')
                    }
                  }}
                >
                  {stance === 'support' ? '支持' : stance === 'oppose' ? '反对（异议）' : '弃权'}
                </Button>
              ))}
            </div>
          )}
          <ul className="space-y-1 text-sm">
            {(positionsQuery.data ?? []).map((position) => (
              <li key={position.id} data-stance={position.stance}>
                参与者 #{position.participantId}：
                {position.stance === 'support'
                  ? '支持'
                  : position.stance === 'oppose'
                    ? '反对'
                    : '弃权'}
                {position.notePreview && (
                  <span className="text-gray-500">（{position.notePreview}…）</span>
                )}
              </li>
            ))}
            {(positionsQuery.data ?? []).length === 0 && (
              <li className="text-gray-400">暂无立场记录。</li>
            )}
          </ul>
        </CardContent>
      </Card>

      {/* ── 结论区（显式人类动作）── */}
      {decisionError && (
        <Alert variant="danger" role="alert">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{decisionError}</AlertDescription>
        </Alert>
      )}
      {canDecide && !isTerminal && (
        <Card aria-label="记录结论">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              记录人工结论
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">
              结论只能由当前登录用户显式提交；AI / 插件 / 后台任务不可代为决定。 提交前将执行
              readiness 检查并绑定证据版本。
            </p>
            <div className="flex flex-wrap gap-2">
              {(['approve', 'reject', 'defer', 'supersede'] as const).map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={action === 'approve' ? 'primary' : 'outline'}
                  disabled={checkReadiness.isPending}
                  onClick={() => void openConfirm(action)}
                >
                  {OUTCOME_ACTION_LABELS[action]}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={checkReadiness.isPending}
                onClick={() => void openConfirm('request-more-evidence')}
              >
                要求补充证据
              </Button>
            </div>
            {readinessPacket && (
              <ul className="space-y-1 text-sm" aria-live="polite">
                {readinessPacket.blockingFindings.map((finding) => (
                  <li key={finding.code} className="text-red-700">
                    阻塞：{finding.message}
                  </li>
                ))}
                {readinessPacket.warnings.map((warning) => (
                  <li key={warning.code} className="text-gray-600">
                    警告：{warning.message}
                  </li>
                ))}
                {readinessPacket.ready && (
                  <li className="text-green-700">
                    就绪：指纹 {readinessPacket.fingerprint?.fingerprint}
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* 显式确认对话框 */}
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent aria-label="确认结论">
          <DialogHeader>
            <DialogTitle>
              确认{confirmAction ? OUTCOME_ACTION_LABELS[confirmAction] : ''}？
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">
            决策 ≠ 执行：结论不会直接修改项目/任务/资源等业务数据。
          </p>
          <Input
            placeholder="结论文本（可选，≤2000 字）"
            maxLength={2000}
            value={rationaleDraft}
            onChange={(event) => setRationaleDraft(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              取消
            </Button>
            <Button
              disabled={
                confirmAction === null ||
                submitOutcome.isPending ||
                (!hasBlocking &&
                  readinessPacket?.ready === false &&
                  confirmAction !== 'request-more-evidence')
              }
              onClick={async () => {
                if (confirmAction === null) return
                setDecisionError(null)
                try {
                  await submitOutcome.mutateAsync({
                    action: confirmAction,
                    selectedOptionId:
                      confirmAction === 'approve'
                        ? (comparisonQuery.data?.baselineOptionId ?? null)
                        : null,
                    reviewFingerprint: readinessPacket?.fingerprint?.fingerprint ?? '',
                    rationale: rationaleDraft.trim() || undefined,
                  })
                  setConfirmAction(null)
                  setRationaleDraft('')
                  setReadinessPacket(null)
                } catch (error) {
                  setDecisionError(error instanceof Error ? error.message : '结论提交失败')
                }
              }}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Outcome history + handoff 区（task 10.7）── */}
      <Card aria-label="结论历史与交接">
        <CardHeader>
          <CardTitle className="text-base">结论历史与受控交接</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-1 text-sm">
            {(outcomesQuery.data ?? []).map((outcome) => (
              <li key={outcome.id} className="text-gray-600">
                {new Date(outcome.createdAt).toLocaleString('zh-CN')} ——{' '}
                {OUTCOME_ACTION_LABELS[outcome.action] ?? outcome.action}
                {outcome.selectedOptionId && `（方案 #${outcome.selectedOptionId}）`}
                ，by #{outcome.actorId}
              </li>
            ))}
            {(outcomesQuery.data ?? []).length === 0 && (
              <li className="text-gray-400">暂无结论。</li>
            )}
          </ul>

          {isTerminal && canManage && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                交接只创建指向既有下游工作台的引用；下游仍需其自身的预览与显式确认。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={createHandoff.isPending}
                  onClick={async () => {
                    setHandoffMessage(null)
                    try {
                      const receipt = await createHandoff.mutateAsync({
                        target: 'navigation',
                        idempotencyKey: `nav-${Date.now()}`,
                      })
                      setHandoffMessage(
                        `交接回执 #${receipt.id}：${receipt.pendingTargetRef ?? ''}`,
                      )
                    } catch (error) {
                      setHandoffMessage(error instanceof Error ? error.message : '交接创建失败')
                    }
                  }}
                >
                  创建导航交接
                </Button>
              </div>
              {handoffMessage && <p className="text-xs text-teal-700">{handoffMessage}</p>}
              <ul className="space-y-1 text-xs">
                {(handoffsQuery.data ?? []).map((receipt) => (
                  <li key={receipt.id} data-handoff-status={receipt.status}>
                    回执 #{receipt.id} · {receipt.target} ·{' '}
                    {receipt.status === 'pending'
                      ? '待下游处理'
                      : receipt.status === 'replayed'
                        ? '幂等重放'
                        : '失败'}
                    {receipt.pendingTargetRef && (
                      <a
                        className="ml-2 inline-flex items-center gap-1 text-teal-700 underline"
                        href={receipt.pendingTargetRef}
                      >
                        打开下游 <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 可选 AI/插件 lens 区（task 10.8）── */}
      {canRequestAi && (
        <Card aria-label="AI 草稿与插件建议">
          <CardHeader>
            <CardTitle className="text-base">可选 advisory lens（草稿性质）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">
              以下内容由 AI/插件生成，仅作草稿参考；不参与证据摘要、方案排序、 readiness
              判定、结论或交接，任何失败均局部隔离。
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={aiLoading}
              onClick={async () => {
                setAiLoading(true)
                try {
                  setAiView(
                    await requestAiNarrative(decision!.organizationId, Number(decision!.id)),
                  )
                } catch {
                  setAiView(null)
                } finally {
                  setAiLoading(false)
                }
              }}
            >
              请求 AI 对比摘要（草稿）
            </Button>
            {aiView && (
              <div
                className="rounded-lg border border-dashed border-gray-300 p-3"
                data-ai-status={aiView.status}
              >
                <p className="text-xs text-gray-400">
                  AI 草稿 · provider：{aiView.provider} · hash：{aiView.outputHash}
                  {aiView.status !== 'ok' && ' · 已回退确定性摘要'}
                </p>
                {aiView.finding && (
                  <p className="text-xs text-gray-500">提示：{aiView.finding.message}</p>
                )}
                {aiView.narrative && <p className="mt-1 text-sm">{aiView.narrative}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
