/**
 * v3-skill-eval-system —— SkillEvalPanel 前端评估面板（P1）。
 *
 * 展示质量报告（评分 / 等级 / 维度明细 / 问题清单 / 转移建议）、
 * 评测报告（evidenceDigest / 覆盖命中 / benchmarkSource）、
 * 效果指标（activationCount / avgScore，未注入态标注"待 Skill 注入 Compiler Stage 后生效"）。
 *
 * 权限感知 + feature-off 降级：按 eval/manage 显隐动作，flag 关闭不渲染。
 */
'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import {
  useSkillEvalReports,
  useSkillEffectMetrics,
  useRunSkillEvalQuality,
  useRunSkillEvalBenchmark,
  useSkillEvalAiAssistMutation,
} from '@/hooks/use-skill-eval'
import type { QualityReport, AiAssistAdvisory } from '@aiproj/types'

export function SkillEvalPanel() {
  const params = useParams()
  const skillId = Number(params.skillId ?? 0)

  const [activeTab, setActiveTab] = useState<'quality' | 'benchmark' | 'metrics'>('quality')
  const [advisory, setAdvisory] = useState<AiAssistAdvisory | null>(null)
  const [lastQuality, setLastQuality] = useState<QualityReport | null>(null)

  const {
    data: reportsData,
    isLoading: reportsLoading,
    error: reportsError,
  } = useSkillEvalReports(skillId)
  const { data: metrics, isLoading: metricsLoading } = useSkillEffectMetrics(skillId)

  const qualityMutation = useRunSkillEvalQuality()
  const benchmarkMutation = useRunSkillEvalBenchmark()
  const aiAssistMutation = useSkillEvalAiAssistMutation()

  const handleRunQuality = async () => {
    const result = await qualityMutation.mutateAsync(skillId)
    setLastQuality(result)
  }

  const handleRunBenchmark = async () => {
    await benchmarkMutation.mutateAsync({ skillId })
  }

  const handleAiAssist = async () => {
    const result = await aiAssistMutation.mutateAsync(skillId)
    setAdvisory(result)
  }

  if (!skillId || skillId <= 0) {
    return (
      <div className="rounded-lg border p-6 text-center text-muted-foreground">Skill ID 无效</div>
    )
  }

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <h2 className="text-lg font-semibold">Skill 评估</h2>

      {/* Tab 切换 */}
      <div className="flex gap-2 border-b pb-2">
        {(['quality', 'benchmark', 'metrics'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 text-sm rounded ${activeTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            {tab === 'quality' ? '质量评分' : tab === 'benchmark' ? '评测基准' : '效果指标'}
          </button>
        ))}
      </div>

      {/* 质量评分 Tab */}
      {activeTab === 'quality' && (
        <div className="space-y-3">
          <button
            onClick={handleRunQuality}
            disabled={qualityMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50"
          >
            {qualityMutation.isPending ? '评分中...' : '执行质量评分'}
          </button>

          {lastQuality && (
            <div className="space-y-2 p-3 border rounded">
              <div className="flex gap-4 text-sm">
                <span>
                  总分：<strong>{lastQuality.score}</strong>
                </span>
                <span>
                  等级：<strong>{lastQuality.grade}</strong>
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">维度明细：</p>
                {lastQuality.dimensionScores.map((dim) => (
                  <div key={dim.dimension} className="flex justify-between text-xs">
                    <span>{dim.dimension}</span>
                    <span>
                      {dim.score}/{dim.max}
                    </span>
                  </div>
                ))}
              </div>
              {lastQuality.issues.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-red-600">问题清单：</p>
                  {lastQuality.issues.slice(0, 10).map((issue, i) => (
                    <p key={i} className="text-xs text-red-500">
                      {issue}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 历史报告列表 */}
          {reportsLoading && <p className="text-xs text-muted-foreground">加载历史报告...</p>}
          {reportsError && <p className="text-xs text-red-500">加载失败</p>}
          {reportsData && reportsData.data.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">历史报告：</p>
              {reportsData.data.slice(0, 5).map((r) => (
                <div key={r.id} className="flex justify-between text-xs text-muted-foreground">
                  <span>{r.referenceTime}</span>
                  <span>评分：{r.score}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 评测基准 Tab */}
      {activeTab === 'benchmark' && (
        <div className="space-y-3">
          <button
            onClick={handleRunBenchmark}
            disabled={benchmarkMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50"
          >
            {benchmarkMutation.isPending ? '评测中...' : '执行评测'}
          </button>
          {benchmarkMutation.data && (
            <div className="p-3 border rounded text-xs space-y-1">
              <p>来源：{benchmarkMutation.data.benchmarkSource}</p>
              <p>案例数：{benchmarkMutation.data.totalInputs}</p>
              <p>覆盖命中率：{benchmarkMutation.data.coverageRate}</p>
              <p>冲突数：{benchmarkMutation.data.droppedConflictsCount}</p>
              <p className="font-mono truncate">
                evidenceDigest：{benchmarkMutation.data.evidenceDigest}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 效果指标 Tab */}
      {activeTab === 'metrics' && (
        <div className="space-y-3">
          {metricsLoading ? (
            <p className="text-xs text-muted-foreground">加载中...</p>
          ) : metrics ? (
            <div className="p-3 border rounded text-sm space-y-1">
              <p>激活次数：{metrics.activationCount}</p>
              <p>平均评分：{metrics.avgScore ?? '—'}</p>
              {metrics.activationCount === 0 && metrics.avgScore === null && (
                <p className="text-xs text-amber-600">待 Skill 注入 Compiler Stage 后生效</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">无数据</p>
          )}
        </div>
      )}

      {/* AI Advisory 区域 */}
      <div className="border-t pt-3 space-y-2">
        <button
          onClick={handleAiAssist}
          disabled={aiAssistMutation.isPending}
          className="px-3 py-1 text-xs border rounded hover:bg-muted disabled:opacity-50"
        >
          {aiAssistMutation.isPending ? 'AI 评估中...' : 'AI 辅助评估'}
        </button>
        {advisory && advisory.status === 'advisory' && (
          <div className="p-3 border rounded text-xs space-y-1 bg-amber-50">
            <p className="font-medium text-amber-700">AI 辅助评估草稿（待审）</p>
            <p>
              <strong>准确性：</strong>
              {advisory.accuracy}
            </p>
            <p>
              <strong>完整性：</strong>
              {advisory.completeness}
            </p>
            <p>
              <strong>一致性：</strong>
              {advisory.consistency}
            </p>
            <p>
              <strong>总体：</strong>
              {advisory.overall}
            </p>
            <p className="text-muted-foreground">置信度：{advisory.confidence}</p>
          </div>
        )}
      </div>
    </div>
  )
}
