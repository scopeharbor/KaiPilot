import type { TaskBatchResult } from '@/lib/api/tasks'
import { Alert } from '@/components/ui/Alert'

export function TaskBatchResultAlert({ result }: { result: TaskBatchResult | null }) {
  if (!result) return null
  const failed = result.results.filter((item) => !item.success)
  return (
    <Alert
      variant={result.failedCount ? 'warning' : 'success'}
      title={`已成功处理 ${result.successCount} 项，失败 ${result.failedCount} 项`}
    >
      {failed.length ? (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {failed.slice(0, 5).map((item) => (
            <li key={item.taskId}>
              任务 {item.taskId}：{item.error?.message ?? '处理失败'}
            </li>
          ))}
          {failed.length > 5 ? <li>另有 {failed.length - 5} 项失败</li> : null}
        </ul>
      ) : (
        '相关任务列表与项目统计已刷新。'
      )}
    </Alert>
  )
}
