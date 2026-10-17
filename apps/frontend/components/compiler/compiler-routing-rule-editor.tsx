'use client'

/**
 * v2-5-compiler-dynamic-routing-management-ui —— 路由规则编排编辑器（切片 B）。
 *
 * 草稿走 Zustand 本地态；提交前展示 diff，显式确认后才发写请求。
 * 无确认离开不落库。
 */
import { useState } from 'react'
import { useCompilerRoutingStore } from '@/stores/compiler-routing-store'
import { compilerRoutingApi } from '@/lib/api/compiler-routing'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import type { CompilerScenarioKind } from '@aiproj/types/compiler-dynamic-routing'

const SCENARIO_KINDS: CompilerScenarioKind[] = [
  'default_plan',
  'lightweight_draft',
  'deterministic_validation',
  'artifact_review',
]

const KNOWN_STAGES = ['intent_ingestion', 'intent_parsing', 'dag_stub']

export function CompilerRoutingRuleEditor() {
  const {
    draft,
    isDirty,
    confirmToken,
    startEditing,
    updateDraft,
    setConfirmToken,
    discard,
    committed,
  } = useCompilerRoutingStore()
  const [preview, setPreview] = useState<
    Awaited<ReturnType<typeof compilerRoutingApi.previewRule>>['data'] | null
  >(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleNewRule() {
    startEditing({
      id: 'custom-rule-v1',
      version: { major: 1, minor: 0 },
      compatibleContracts: { min: '1.0', max: '2.0' },
      scenarioKinds: ['default_plan'],
      allowedStageIds: ['intent_ingestion'],
      allowedSkippedStageIds: [],
      reasonCode: 'ROUTE_MATCHED',
      enabled: true,
    })
  }

  async function handlePreview() {
    if (!draft) return
    setIsPreviewing(true)
    setError(null)
    try {
      const res = await compilerRoutingApi.previewRule(draft)
      setPreview(res.data)
      setConfirmToken(res.data.confirmToken)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsPreviewing(false)
    }
  }

  async function handleConfirm() {
    if (!confirmToken) return
    setIsCommitting(true)
    setError(null)
    try {
      await compilerRoutingApi.confirmRule(confirmToken)
      committed()
      setPreview(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsCommitting(false)
    }
  }

  if (!draft) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          创建或编辑路由规则。提交前会展示预览/差异，确认后才落库。
        </p>
        <Button onClick={handleNewRule}>新建规则</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>
          ⚠️ 规则变更属写入动作，必须经预览/差异 → 显式确认 → 审计后才落库。未确认离开不会保存。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">规则编辑</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-medium">规则 ID</label>
              <input
                value={draft.id}
                onChange={(e) => updateDraft({ id: e.target.value })}
                className="w-full border rounded px-2 py-1 mt-1"
              />
            </div>
            <div>
              <label className="font-medium">版本</label>
              <p className="mt-1">
                {draft.version.major}.{draft.version.minor}
              </p>
            </div>
          </div>

          <div>
            <label className="font-medium">场景类型</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {SCENARIO_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.scenarioKinds.includes(k)}
                    onChange={(e) => {
                      const kinds = e.target.checked
                        ? [...draft.scenarioKinds, k]
                        : draft.scenarioKinds.filter((s) => s !== k)
                      updateDraft({ scenarioKinds: kinds as CompilerScenarioKind[] })
                    }}
                  />
                  <span>{k}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="font-medium">选择 Stage</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {KNOWN_STAGES.map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.allowedStageIds.includes(s)}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...draft.allowedStageIds, s]
                        : draft.allowedStageIds.filter((x) => x !== s)
                      updateDraft({ allowedStageIds: ids })
                    }}
                  />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="font-medium">跳过 Stage</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {KNOWN_STAGES.map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.allowedSkippedStageIds.includes(s)}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...draft.allowedSkippedStageIds, s]
                        : draft.allowedSkippedStageIds.filter((x) => x !== s)
                      updateDraft({ allowedSkippedStageIds: ids })
                    }}
                  />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="font-medium">启用</label>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => updateDraft({ enabled: e.target.checked })}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handlePreview} disabled={!isDirty || isPreviewing}>
              {isPreviewing ? '预览中…' : '预览变更'}
            </Button>
            <Button variant="outline" onClick={discard}>
              取消
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              预览/差异
              <Badge variant="outline">previewOnly</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {preview.before ? (
              <div>
                <p className="font-medium">旧规则</p>
                <p>
                  ID: {preview.before.id} · 场景: {preview.before.scenarioKinds.join(', ')}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">（新增规则，无旧版本）</p>
            )}
            <div>
              <p className="font-medium">新规则</p>
              <p>
                ID: {preview.after.id} · 场景: {preview.after.scenarioKinds.join(', ')}
              </p>
              <p>
                选择: {preview.after.allowedStageIds.join(', ') || '无'} · 跳过:{' '}
                {preview.after.allowedSkippedStageIds.join(', ') || '无'}
              </p>
            </div>
            <p>受影响场景: {preview.affectedScenarioKinds.join(', ')}</p>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleConfirm} disabled={isCommitting}>
                {isCommitting ? '提交中…' : '确认并落库'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
