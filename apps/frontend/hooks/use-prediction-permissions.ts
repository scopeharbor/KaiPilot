'use client'

import { usePermissions } from '@/hooks/use-permissions'

/**
 * 预测相关权限辅助 Hook。
 * 遵循 design D11 模式，**仅用于展示层控制**，安全判定以服务端 RBAC 为准。
 */
export function usePredictionPermissions() {
  const { can, canAny, canAll } = usePermissions()

  return {
    /** 可查看预测面板。 */
    canView: can('prediction:view'),
    /** 可生成/触发预测。 */
    canGenerate: can('prediction:generate'),
    /** 可确认/忽略预测。 */
    canConfirm: can('prediction:confirm'),
    /** 可触发 AI 解释生成。 */
    canTriggerAi: can('prediction:trigger_ai'),
    /** 可执行任一预测操作。 */
    canAnyPrediction: canAny([
      'prediction:view',
      'prediction:generate',
      'prediction:confirm',
      'prediction:trigger_ai',
    ]),
    /** 可执行全部预测操作。 */
    canAllPrediction: canAll([
      'prediction:view',
      'prediction:generate',
      'prediction:confirm',
      'prediction:trigger_ai',
    ]),
  }
}
