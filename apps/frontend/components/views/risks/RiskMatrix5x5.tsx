'use client'

import { Button } from '@/components/ui/Button'
import { useRiskMatrix } from '@/hooks/use-risk-matrix'
import { useRiskViewStore } from '@/stores/risk-view-store'

const IMPACT_LABELS = ['极低', '低', '中', '高', '极高']
const PROBABILITY_LABELS = ['极低', '低', '中', '高', '极高']

interface RiskMatrix5x5Props {
  projectId: number
  onCellClick?: (probability: number, impact: number) => void
  readOnly?: boolean
}

/** 根据矩阵配置色区或得分返回单元样式。 */
function cellColor(count: number, score: number): string {
  if (count === 0) return 'bg-gray-50 border-gray-200'
  if (score >= 20) return 'bg-red-200 border-red-400'
  if (score >= 15) return 'bg-red-100 border-red-300'
  if (score >= 10) return 'bg-orange-100 border-orange-300'
  if (score >= 5) return 'bg-yellow-50 border-yellow-200'
  return 'bg-green-50 border-green-200'
}

function bubbleSize(count: number): string {
  if (count === 0) return 'w-0 h-0'
  if (count <= 2) return 'w-6 h-6'
  if (count <= 5) return 'w-8 h-8'
  return 'w-10 h-10'
}

/** 风险等级色区图例 */
function LevelLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-3 rounded-sm bg-green-50 border border-green-200" />低
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-3 rounded-sm bg-yellow-50 border border-yellow-200" />中
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-3 rounded-sm bg-orange-100 border border-orange-300" />
        高
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-300" />
        严重
      </span>
    </div>
  )
}

export function RiskMatrix5x5({ projectId, onCellClick, readOnly }: RiskMatrix5x5Props) {
  const { matrixBasis, setMatrixBasis } = useRiskViewStore()
  const { data, isLoading } = useRiskMatrix(projectId, matrixBasis)

  const cells = data?.data?.cells ?? []
  const cellMap = new Map(cells.map((c) => [`${c.probability}-${c.impact}`, c]))

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">加载矩阵...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">概率-影响矩阵</h3>
        <div className="flex items-center gap-3">
          <LevelLegend />
          <div className="flex gap-2">
            <Button
              variant={matrixBasis === 'inherent' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setMatrixBasis('inherent')}
              disabled={readOnly}
            >
              固有
            </Button>
            <Button
              variant={matrixBasis === 'residual' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setMatrixBasis('residual')}
              disabled={readOnly}
            >
              残余
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block relative">
          {/* Y轴标签：影响 */}
          <div className="flex">
            <div className="w-16 flex flex-col justify-around text-xs text-gray-500 pr-2 text-right">
              {IMPACT_LABELS.map((l) => (
                <div key={l} className="h-16 flex items-center justify-end">
                  {l}
                </div>
              ))}
            </div>

            {/* 矩阵网格：行 = impact（5=顶, 1=底），列 = probability（1=左, 5=右） */}
            <div className="flex flex-col-reverse gap-1">
              {[1, 2, 3, 4, 5].map((impact) => (
                <div key={impact} className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((probability) => {
                    const cell = cellMap.get(`${probability}-${impact}`)
                    const count = cell?.count ?? 0
                    const score = probability * impact
                    return (
                      <div
                        key={`${probability}-${impact}`}
                        className={`w-16 h-16 rounded-lg border flex flex-col items-center justify-center transition-colors ${readOnly ? '' : 'cursor-pointer hover:opacity-80'} ${cellColor(count, score)}`}
                        role={readOnly ? 'img' : 'button'}
                        tabIndex={readOnly ? -1 : 0}
                        aria-label={`概率${PROBABILITY_LABELS[probability - 1]}影响${IMPACT_LABELS[impact - 1]}：${count}条风险`}
                        onClick={() => !readOnly && onCellClick?.(probability, impact)}
                        onKeyDown={(e) => {
                          if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault()
                            onCellClick?.(probability, impact)
                          }
                        }}
                        title={count > 0 ? `${count} 条风险` : '无风险'}
                      >
                        {count > 0 && (
                          <div
                            className={`rounded-full bg-white/80 flex items-center justify-center text-xs font-bold ${bubbleSize(count)}`}
                          >
                            {count}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* X轴标签：概率 */}
          <div className="flex ml-16 mt-1">
            {[1, 2, 3, 4, 5].map((p) => (
              <div key={p} className="w-16 text-center text-xs text-gray-500">
                {PROBABILITY_LABELS[p - 1]}
              </div>
            ))}
          </div>

          <div className="flex ml-16 mt-2">
            <div className="w-80 text-center text-xs text-gray-400">概率 →</div>
          </div>
        </div>
      </div>
    </div>
  )
}
