'use client'

/**
 * v2-5-compiler-dynamic-routing-management-ui —— 路由模拟面板（切片 C）。
 *
 * 提交候选计划 → 展示预测 selected/skipped/reason/valid；
 * 明确标注"模拟诊断，非真实执行"。
 */
import { useState } from 'react'
import { useRoutingSimulate } from '@/hooks/use-compiler-routing'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import type { CompilerScenarioKind } from '@aiproj/types/compiler-dynamic-routing'

const SCENARIO_KINDS: CompilerScenarioKind[] = [
  'default_plan',
  'lightweight_draft',
  'deterministic_validation',
  'artifact_review',
]

const DEFAULT_CANDIDATE_STAGES = ['intent_ingestion', 'intent_parsing', 'dag_stub']

export function CompilerRoutingSimulatePanel() {
  const [scenarioKind, setScenarioKind] = useState<CompilerScenarioKind>('default_plan')
  const [simulateInput, setSimulateInput] = useState<Parameters<typeof useRoutingSimulate>[0]>(null)

  const { data, isLoading, error } = useRoutingSimulate(simulateInput)
  const result = data?.data

  function handleSimulate() {
    setSimulateInput({
      scenarioKind,
      candidateStageIds: DEFAULT_CANDIDATE_STAGES,
      availableHandlerStageIds: DEFAULT_CANDIDATE_STAGES,
      contractVersion: '2.0',
      dependencies: [
        { stageId: 'intent_parsing', dependsOn: ['intent_ingestion'] },
        { stageId: 'dag_stub', dependsOn: ['intent_ingestion', 'intent_parsing'] },
      ],
    })
  }

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>
          ⚠️ 路由模拟为只读诊断工具，不会执行任何 stage、不会写入数据、不会调用真实模型。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">模拟输入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">场景类型</label>
            <select
              value={scenarioKind}
              onChange={(e) => setScenarioKind(e.target.value as CompilerScenarioKind)}
              className="border rounded px-2 py-1 text-sm"
            >
              {SCENARIO_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            候选 stage：{DEFAULT_CANDIDATE_STAGES.join(', ')}
          </p>
          <Button onClick={handleSimulate} disabled={isLoading}>
            {isLoading ? '模拟中…' : '执行模拟'}
          </Button>
        </CardContent>
      </Card>

      {error && <EmptyState title="模拟失败" description="请检查输入后重试。" />}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              模拟结果
              <Badge variant={result.valid ? 'success' : 'danger'}>
                {result.valid ? '有效' : '无效'}
              </Badge>
              <Badge variant="outline">noSideEffect</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>Reason：{result.decision.reasonCode}</p>
            <p>选中 stage：{result.decision.selectedStageIds.join(', ') || '（无）'}</p>
            <p>跳过 stage：{result.decision.skippedStageIds.join(', ') || '（无）'}</p>
            <p>
              选中/原始：{result.decision.selectedStageCount}/{result.decision.originalStageCount}
            </p>
            <p>Fallback：{result.decision.isFallback ? '是' : '否'}</p>
            {result.errors.length > 0 && (
              <div className="mt-2 text-destructive">
                <p className="font-medium">错误：</p>
                <ul className="list-disc pl-4">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
