'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FlaskConical, Pause, Play, RotateCcw, ShieldCheck, Square } from 'lucide-react'
import type { AiM0EvaluationMode, AiM0EvaluationRun } from '@aiproj/types'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { aiM0EvaluationApi } from '@/lib/api/ai-m0-evaluation'
import {
  clearEvaluationRun,
  completeStep,
  createEvaluationRun,
  failStep,
  loadEvaluationRun,
  markStepRunning,
  nextRunnableStep,
  recoverEvaluationRun,
  saveEvaluationRun,
  summarizeEvaluationRun,
} from '@/lib/ai-m0/evaluation-run'
import { exportOutcomesCsv, exportRawJson, exportSummaryJson } from '@/lib/ai-m0/evaluation-export'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Progress } from '@/components/ui/Progress'

function now() {
  return new Date().toISOString()
}

export function EvaluationConsole() {
  const connections = useQuery({
    queryKey: ['ai-connections'],
    queryFn: aiConnectionsApi.list,
  })
  const [mode, setMode] = useState<AiM0EvaluationMode>('dry_run')
  const [dryRepetitions, setDryRepetitions] = useState(1)
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [run, setRunState] = useState<AiM0EvaluationRun | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = loadEvaluationRun()
    return saved ? recoverEvaluationRun(saved, now()) : null
  })
  const runRef = useRef(run)

  const setRun = useCallback((next: AiM0EvaluationRun | null) => {
    runRef.current = next
    setRunState(next)
    if (next) saveEvaluationRun(next)
    else clearEvaluationRun()
  }, [])

  const selectedConnection = connections.data?.find((item) => Number(item.id) === connectionId)
  const readyForReal =
    !!selectedConnection?.isActive &&
    !!selectedConnection.hasKey &&
    !!selectedConnection.lastTestedAt
  const summary = useMemo(() => (run ? summarizeEvaluationRun(run) : null), [run])
  const progress = summary && summary.total ? (summary.completed / summary.total) * 100 : 0

  useEffect(() => {
    if (connectionId || !connections.data?.length) return
    const latest = [...connections.data].reverse().find((item) => item.isActive)
    if (latest) setConnectionId(Number(latest.id))
  }, [connectionId, connections.data])

  const prepare = useCallback(async () => {
    setError(null)
    if (mode === 'real' && !readyForReal) {
      setError('真实评测需要选择已启用、已填写 API key 且测试成功的连接。')
      return
    }
    setPreparing(true)
    try {
      const plan = await aiM0EvaluationApi.plan(mode, dryRepetitions)
      setRun(
        createEvaluationRun({
          id: crypto.randomUUID(),
          mode,
          connectionId: connectionId ? String(connectionId) : null,
          inputSetHash: plan.inputSetHash,
          repetitions: plan.repetitions,
          steps: plan.steps,
          now: now(),
        }),
      )
    } catch (reason) {
      setError((reason as { message?: string }).message ?? '无法准备评测计划')
    } finally {
      setPreparing(false)
    }
  }, [connectionId, dryRepetitions, mode, readyForReal, setRun])

  const runLoop = useCallback(async () => {
    let current = runRef.current
    if (!current) return
    if (current.status === 'idle' || current.status === 'paused') {
      current = { ...current, status: 'running', updatedAt: now() }
      setRun(current)
    }
    while (current && current.status === 'running') {
      const step = nextRunnableStep(current)
      if (!step) {
        const hasFailures = current.steps.some((item) => item.status === 'failed')
        current = { ...current, status: hasFailures ? 'paused' : 'completed', updatedAt: now() }
        setRun(current)
        break
      }
      current = markStepRunning(current, step.id, now())
      setRun(current)
      try {
        const outcome = await aiM0EvaluationApi.execute({
          stepId: step.id,
          inputId: step.inputId,
          requestedStrategy: step.requestedStrategy,
          repetition: step.repetition,
          mode: current.mode,
          connectionId: current.connectionId ? Number(current.connectionId) : undefined,
        })
        current = completeStep(runRef.current ?? current, outcome, now())
      } catch (reason) {
        current = failStep(runRef.current ?? current, step.id, now())
        setError((reason as { message?: string }).message ?? `步骤 ${step.id} 失败`)
      }
      setRun(current)
      if (current.status === 'paused' || current.status === 'cancelled') break
    }
  }, [setRun])

  const requestPause = () => {
    if (!run) return
    setRun({ ...run, status: run.status === 'running' ? 'pausing' : 'paused', updatedAt: now() })
  }

  const cancel = () => {
    if (!run) return
    setRun({ ...run, status: 'cancelled', updatedAt: now() })
  }

  const retryFailures = () => {
    if (!run) return
    setRun({
      ...run,
      status: 'paused',
      updatedAt: now(),
      steps: run.steps.map((step) =>
        step.status === 'failed' ? { ...step, status: 'pending' } : step,
      ),
    })
  }

  const download = (kind: 'raw' | 'summary' | 'csv') => {
    if (!run) return
    const content =
      kind === 'raw'
        ? exportRawJson(run)
        : kind === 'summary'
          ? exportSummaryJson(run)
          : exportOutcomesCsv(run)
    const blob = new Blob([content], {
      type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
    })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `ai-m0-${kind}-${run.id}.${kind === 'csv' ? 'csv' : 'json'}`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return (
    <Card variant="outlined">
      <CardHeader className="border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-ai-bg px-2.5 py-1 text-xs font-medium text-ai">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              M0 自助评测
            </div>
            <CardTitle>先演练控制面，填入 key 后直接跑真实证据</CardTitle>
            <p className="mt-1 max-w-[72ch] text-sm text-gray-600">
              演练不调用外部 API；真实模式固定执行 12 条输入 × 20 次 × 3 策略，共 720
              次基础调用，重试会产生额外费用。
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-medium text-warning">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            M0 仍为 PENDING
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-[var(--card-pad)]">
        <div className="flex flex-wrap items-end gap-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-800">运行模式</legend>
            <div className="flex rounded-[var(--radius-md)] border border-border p-1">
              {(['dry_run', 'real'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  disabled={!!run && run.status !== 'completed' && run.status !== 'cancelled'}
                  className={`h-8 rounded-[var(--radius-sm)] px-3 text-sm font-medium focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
                    mode === value ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {value === 'dry_run' ? '开发演练' : '真实证据'}
                </button>
              ))}
            </div>
          </fieldset>

          {mode === 'dry_run' ? (
            <label className="space-y-2 text-sm font-medium text-gray-800">
              演练重复次数
              <select
                value={dryRepetitions}
                onChange={(event) => setDryRepetitions(Number(event.target.value))}
                className="block h-9 rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 text-sm text-gray-700 focus:outline-none focus:shadow-[var(--shadow-focus)]"
              >
                <option value={1}>1 次（36 步）</option>
                <option value={20}>20 次（720 步）</option>
              </select>
            </label>
          ) : (
            <label className="min-w-64 space-y-2 text-sm font-medium text-gray-800">
              真实连接
              <select
                value={connectionId ?? ''}
                onChange={(event) =>
                  setConnectionId(event.target.value ? Number(event.target.value) : null)
                }
                className="block h-9 w-full rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 text-sm text-gray-700 focus:outline-none focus:shadow-[var(--shadow-focus)]"
              >
                <option value="">请选择已测试连接</option>
                {connections.data?.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.displayName} · {connection.model}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!run || run.status === 'completed' || run.status === 'cancelled' ? (
            <Button onClick={prepare} loading={preparing}>
              准备评测计划
            </Button>
          ) : null}
        </div>

        {mode === 'real' && !readyForReal ? (
          <div className="rounded-[var(--radius-md)] border border-warning bg-warning-bg p-3 text-sm text-amber-900 dark:text-amber-100">
            填写 API key 后先在上方“AI 连接”区域测试连接。测试成功后这里会立即开放，无需重启。
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="rounded-[var(--radius-md)] border border-danger bg-danger-bg p-3 text-sm text-red-900 dark:text-red-100"
          >
            {error}
          </div>
        ) : null}

        {run && summary ? (
          <div className="space-y-4 border-t border-border pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {run.mode === 'dry_run' ? '开发演练 · 不可作为证据' : '真实证据评测'}
                </p>
                <p className="text-xs text-gray-500">
                  {summary.completed}/{summary.total} 已完成 · 状态 {run.status}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(run.status === 'idle' || run.status === 'paused') && (
                  <Button onClick={() => void runLoop()} size="sm">
                    <Play className="h-4 w-4" aria-hidden />
                    {run.status === 'idle' ? `确认开始 ${summary.total} 步` : '继续'}
                  </Button>
                )}
                {(run.status === 'running' || run.status === 'pausing') && (
                  <Button onClick={requestPause} variant="secondary" size="sm">
                    <Pause className="h-4 w-4" aria-hidden />
                    当前步骤后暂停
                  </Button>
                )}
                {summary.failed > 0 && run.status === 'paused' && (
                  <Button onClick={retryFailures} variant="secondary" size="sm">
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    重试失败项
                  </Button>
                )}
                {!['completed', 'cancelled'].includes(run.status) && (
                  <Button onClick={cancel} variant="ghost" size="sm">
                    <Square className="h-4 w-4" aria-hidden />
                    取消
                  </Button>
                )}
              </div>
            </div>
            <Progress value={progress} tone={run.mode === 'dry_run' ? 'ai' : 'primary'} />

            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-surface text-left text-xs text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">策略</th>
                    <th className="px-3 py-2 font-medium">运行</th>
                    <th className="px-3 py-2 font-medium">严格 / 修复 / 失败</th>
                    <th className="px-3 py-2 font-medium">可入库率</th>
                    <th className="px-3 py-2 font-medium">Marker</th>
                    <th className="px-3 py-2 font-medium">证据资格</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(['prompt', 'native', 'tool'] as const).map((strategy) => {
                    const item = summary.perStrategy[strategy]
                    return (
                      <tr key={strategy}>
                        <td className="px-3 py-2 font-mono text-xs uppercase text-gray-800">
                          {strategy}
                        </td>
                        <td className="px-3 py-2">{item.runs}</td>
                        <td className="px-3 py-2">
                          {item.strict} / {item.repaired} / {item.failed}
                        </td>
                        <td className="px-3 py-2">{(item.landableRate * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{(item.markerCoverage * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{item.evidenceEligible ? '合格' : '不可用'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium text-gray-600">导出当前检查点</span>
              <Button variant="secondary" size="sm" onClick={() => download('raw')}>
                <Download className="h-4 w-4" aria-hidden /> 原始 JSON
              </Button>
              <Button variant="secondary" size="sm" onClick={() => download('summary')}>
                <Download className="h-4 w-4" aria-hidden /> 汇总 JSON
              </Button>
              <Button variant="secondary" size="sm" onClick={() => download('csv')}>
                <Download className="h-4 w-4" aria-hidden /> CSV
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRun(null)}>
                清除本地运行
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
