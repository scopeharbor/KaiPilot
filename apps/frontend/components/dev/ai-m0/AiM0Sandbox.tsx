'use client'

/**
 * ai-structured-output-poc / M0 —— 沙箱容器（抛弃型 UI）。
 *
 * 挂控制面板（策略 P/N/T + 评测输入选择 + 温度）+ 生成按钮 + SSE 事件流面板 +
 * DraftReviewPanel（红线 1 硬保：确认按钮 stub，不入库）。
 *
 * 与 `/dev/gantt-m0` 类似的抛弃型定位：达标后本容器移除，
 * 只留 `lib/ai-m0/*`（schema/sse-buffer/measure）与 DraftReviewPanel 骨架进主线。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AI_M0_STRATEGIES, type AiM0Strategy } from '@aiproj/types'
import { applySseEvent, initialSseBufferState, parseSseFrames } from '@/lib/ai-m0/sse-buffer'
import { parseDraft } from '@/lib/ai-m0/schema'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { aiM0EvaluationApi } from '@/lib/api/ai-m0-evaluation'
import {
  clearStreamCheckpoint,
  loadStreamCheckpoint,
  saveStreamCheckpoint,
  streamRequestFingerprint,
} from '@/lib/ai-m0/stream-checkpoint'
import { ConnectionsManager } from '@/components/ai/ConnectionsManager'
import { DraftReviewPanel } from './DraftReviewPanel'
import { EvaluationConsole } from './EvaluationConsole'

const DEFAULT_SENTENCE = '搭建一个企业内部的 OA 审批系统，需要支持请假、报销、印章三类流程。'

interface EventLog {
  ts: number
  kind: 'chunk' | 'error' | 'done' | 'info'
  message: string
}

export function AiM0Sandbox() {
  const [sentence, setSentence] = useState<string>(DEFAULT_SENTENCE)
  const [strategy, setStrategy] = useState<AiM0Strategy>('prompt')
  const [temperature, setTemperature] = useState<number>(0.2)
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [busy, setBusy] = useState<boolean>(false)
  const connections = useQuery({ queryKey: ['ai-connections'], queryFn: aiConnectionsApi.list })
  const [logs, setLogs] = useState<EventLog[]>([])
  const [rawText, setRawText] = useState<string>('')
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null)
  const [parseError, setParseError] = useState<string[] | null>(null)

  useEffect(() => {
    if (connectionId || !connections.data?.length) return
    const latest = [...connections.data].reverse().find((item) => item.isActive)
    if (latest) setConnectionId(Number(latest.id))
  }, [connectionId, connections.data])

  const draft = useMemo(() => {
    if (!rawText) return null
    try {
      const raw = JSON.parse(rawText)
      const parsed = parseDraft(raw)
      if (parsed.ok) return parsed.value
      setParseError(parsed.issues)
      return null
    } catch (err) {
      setParseError([`JSON.parse 失败：${(err as Error).message}`])
      return null
    }
  }, [rawText])

  const runStream = useCallback(async () => {
    setBusy(true)
    setLogs([])
    setRawText('')
    setMeta(null)
    setParseError(null)

    const requestInput = { sentence, strategy, temperature, connectionId }
    const fingerprint = streamRequestFingerprint(requestInput)
    const saved = loadStreamCheckpoint()
    let state =
      saved && saved.requestFingerprint === fingerprint && !saved.finished
        ? { rawText: saved.rawText, lastEventId: saved.lastEventId, finished: false }
        : { ...initialSseBufferState }
    let streamId =
      saved && saved.requestFingerprint === fingerprint && !saved.finished
        ? saved.streamId
        : undefined

    try {
      for (let attempt = 0; attempt < 2 && !state.finished; attempt += 1) {
        let pending = ''
        const resp = await aiM0EvaluationApi.stream(
          {
            sentence,
            strategy,
            temperature,
            connectionId: connectionId ?? undefined,
            streamId,
          },
          state.lastEventId,
        )
        streamId = resp.headers.get('X-AI-M0-Stream-ID') ?? streamId
        if (!streamId || !resp.body) throw new Error('流式响应缺少 streamId 或 body')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder('utf-8')
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const parsed = parseSseFrames(decoder.decode(value, { stream: true }), pending)
          pending = parsed.pending
          for (const evt of parsed.events) {
            state = applySseEvent(state, evt)
            saveStreamCheckpoint({
              schemaVersion: 1,
              streamId,
              requestFingerprint: fingerprint,
              lastEventId: state.lastEventId,
              rawText: state.rawText,
              updatedAt: new Date().toISOString(),
              finished: state.finished,
            })
            if (evt.kind === 'chunk') {
              setRawText(state.rawText)
              setLogs((prev) => [
                ...prev,
                { ts: Date.now(), kind: 'chunk', message: `+${evt.text.length}b` },
              ])
            } else if (evt.kind === 'error') {
              setLogs((prev) => [
                ...prev,
                {
                  ts: Date.now(),
                  kind: 'error',
                  message: `${evt.errorKind ?? 'unknown'} :: ${evt.errorMessage ?? ''}`,
                },
              ])
            } else {
              setMeta(evt.meta as Record<string, unknown>)
              setLogs((prev) => [
                ...prev,
                { ts: Date.now(), kind: 'done', message: JSON.stringify(evt.meta) },
              ])
            }
          }
        }
        if (!state.finished && attempt === 0) {
          setLogs((prev) => [
            ...prev,
            { ts: Date.now(), kind: 'info', message: '连接中断，正在从最后事件自动续传…' },
          ])
        }
      }
      setRawText(state.rawText)
      if (state.finished) clearStreamCheckpoint()
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        { ts: Date.now(), kind: 'error', message: (err as Error).message },
      ])
    } finally {
      setBusy(false)
    }
  }, [connectionId, sentence, strategy, temperature])

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-800">AI 结构化输出 M0 沙箱</h1>
        <p className="mt-1 text-xs text-slate-500">
          抛弃型 UI · 红线 1：AI 只建议不自动执行，草案区与正式数据物理隔离，本页零落库。
        </p>
      </header>

      <ConnectionsManager />

      <EvaluationConsole />

      <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <label className="mb-1 block text-xs text-slate-600">一句话项目描述</label>
          <textarea
            className="w-full rounded border border-slate-300 p-2 text-sm"
            rows={2}
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="mb-3 flex flex-wrap gap-4">
          <div className="min-w-0 flex-[2_1_240px]">
            <label className="mb-1 block text-xs text-slate-600">Schema 约束策略</label>
            <select
              className="w-full rounded border border-slate-300 p-1 text-sm"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as AiM0Strategy)}
              disabled={busy}
            >
              {AI_M0_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s === 'prompt' && 'P · 纯 Prompt 约束'}
                  {s === 'native' && 'N · Native response_format=json_schema'}
                  {s === 'tool' && 'T · Tool/Function calling'}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-600">温度</label>
            <input
              type="number"
              step={0.1}
              min={0}
              max={2}
              className="w-24 rounded border border-slate-300 p-1 text-sm"
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              disabled={busy}
            />
          </div>
          <div className="min-w-0 flex-[1_1_180px]">
            <label className="mb-1 block text-xs text-slate-600">连接</label>
            <select
              className="w-full rounded border border-slate-300 p-1 text-sm"
              value={connectionId ?? ''}
              onChange={(e) => setConnectionId(e.target.value ? Number(e.target.value) : null)}
              disabled={busy}
            >
              <option value="">默认(env 回退)</option>
              {connections.data?.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.isActive}>
                  {c.displayName}
                  {c.protocol === 'openai_compatible' ? ' · OpenAI' : ' · Anthropic'}
                  {!c.isActive ? '(已停用)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto self-end max-sm:ml-0 max-sm:w-full">
            <button
              type="button"
              onClick={runStream}
              disabled={busy}
              className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-900 disabled:bg-slate-400 max-sm:w-full"
            >
              {busy ? '生成中…' : '触发流式生成'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-medium text-slate-700">SSE 事件日志</h2>
          <ul className="max-h-64 overflow-auto text-xs">
            {logs.map((l, i) => (
              <li key={i} className="border-b py-1 last:border-b-0">
                <span
                  className={`mr-2 rounded px-1 ${
                    l.kind === 'error'
                      ? 'bg-rose-50 text-rose-700'
                      : l.kind === 'done'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-50 text-slate-600'
                  }`}
                >
                  {l.kind}
                </span>
                <span className="text-slate-600">{l.message}</span>
              </li>
            ))}
            {logs.length === 0 && <li className="text-slate-400">尚无事件，触发生成后展示。</li>}
          </ul>
        </div>
        <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-medium text-slate-700">判定与环境元数据</h2>
          {meta ? (
            <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs">
              {JSON.stringify(meta, null, 2)}
            </pre>
          ) : (
            <p className="text-xs text-slate-400">
              done 事件返回时，这里显示 bucket / coverage / errors / latency / provider。
            </p>
          )}
          {parseError && (
            <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700">
              <div className="mb-1 font-medium">Zod 校验失败：</div>
              <ul className="list-disc pl-4">
                {parseError.slice(0, 8).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {draft && (
        <DraftReviewPanel
          draft={draft}
          onConfirm={(d) => console.info('[POC] draft confirmed (not persisted):', d)}
          onReject={() => console.info('[POC] draft rejected')}
        />
      )}
    </main>
  )
}
