'use client'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet'
import { Badge } from '@/components/ui/Badge'
import { Alert } from '@/components/ui/Alert'
import type { CommandCenterFreshnessState, HealthDiagnosisCommandCenterFacts } from '@aiproj/types'
import { COMMAND_CENTER_REASON_CODES } from '@aiproj/types'

/**
 * HealthEvidenceDrawer —— 只读健康诊断证据抽屉（§5.9，design D7）。
 *
 * 背景：健康诊断专用审查页面不存在，本 change 不补写路径；指挥中心对
 * health-evidence 目标统一打开此页内只读抽屉，展示证据快照与新鲜度，
 * **不提供生成/刷新/确认控件**——那些动作只属于既有健康诊断流程。
 */

export interface HealthEvidenceDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  /** 来自指挥中心投影的已确认诊断摘要；null 表示无可用证据。 */
  diagnosis: HealthDiagnosisCommandCenterFacts | null
  freshness: CommandCenterFreshnessState | null
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '提示',
}

export function HealthEvidenceDrawer({
  open,
  onOpenChange,
  projectId,
  diagnosis,
  freshness,
}: HealthEvidenceDrawerProps) {
  const hasDiagnosis = diagnosis !== null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" aria-describedby={undefined} data-testid="health-evidence-drawer">
        <SheetHeader>
          <SheetTitle>健康诊断证据</SheetTitle>
          <SheetDescription>
            项目 #{projectId} · 只读证据视图（不含生成、刷新或确认操作）
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-6">
          {!hasDiagnosis && (
            <Alert variant="info" title="暂无已确认的健康诊断证据">
              当前没有可见的已确认诊断快照。生成或确认诊断请前往既有的项目健康诊断流程；
              本页面不提供这些操作。
            </Alert>
          )}

          {hasDiagnosis && (
            <>
              <dl
                className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
                aria-label="诊断元数据"
              >
                <dt className="text-gray-500">诊断编号</dt>
                <dd className="font-medium">#{diagnosis.diagnosisId}</dd>
                <dt className="text-gray-500">证据类别</dt>
                <dd>
                  <Badge>已确认诊断</Badge>
                </dd>
                <dt className="text-gray-500">新鲜度</dt>
                <dd>
                  {freshness === 'stale' ? (
                    <Badge variant="warning">
                      {COMMAND_CENTER_REASON_CODES.HEALTH_DIAGNOSIS_STALE}
                    </Badge>
                  ) : (
                    <Badge variant="success">当前有效</Badge>
                  )}
                </dd>
                <dt className="text-gray-500">确认时间</dt>
                <dd>{diagnosis.confirmedAt ?? '—'}</dd>
              </dl>

              {diagnosis.overallScore !== null && (
                <div className="text-sm">
                  <span className="text-gray-500">综合评分：</span>
                  <span className="font-semibold">{diagnosis.overallScore}</span>
                  {diagnosis.overallLabel && (
                    <span className="ml-2 text-gray-500">{diagnosis.overallLabel}</span>
                  )}
                </div>
              )}

              <section aria-label="维度得分">
                <h3 className="mb-2 text-sm font-medium text-gray-700">维度得分</h3>
                <ul className="flex flex-col divide-y divide-border">
                  {diagnosis.dimensionScores.map((ds) => (
                    <li
                      key={ds.dimension}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span>{ds.dimension}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{ds.score}</span>
                        <span className="text-xs text-gray-500">
                          {SEVERITY_LABEL[ds.severity] ?? ds.severity}
                        </span>
                      </span>
                    </li>
                  ))}
                  {diagnosis.dimensionScores.length === 0 && (
                    <li className="py-2 text-sm text-gray-400">该诊断未包含可见的维度证据</li>
                  )}
                </ul>
              </section>

              <p className="text-xs leading-5 text-gray-400">
                以上内容为既有诊断快照的只读投影；处理入口请使用对应注意力项的
                「前往处理」导航，由目标工作台重新执行权限与新鲜度校验。
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
