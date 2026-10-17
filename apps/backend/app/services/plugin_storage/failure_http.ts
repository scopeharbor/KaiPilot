/**
 * v3-plugin-scoped-storage —— 服务层拒绝 → HTTP 响应映射（任务 4.1）。
 *
 * 非泄露原则：所有隔离类失败（跨租/跨项目/跨插件/不存在）对外统一为 404 +
 * 相同形状的错误体；具体 reasonCode 仅出现在错误码字段（机器可判、低敏），
 * message 使用固定文案，不回显 key 名、值或任何存在性差异。
 */

/** 结构化最小接口：同时接受 runtime 与 cleanup/export 服务的失败形状。 */
interface FailureLike {
  reasonCode: string
  httpStatus: number
}

const MESSAGES: Record<string, string> = {
  'storage-auth-required': '需要认证',
  'storage-permission-denied': '无权访问该存储',
  'storage-cross-tenant-denied': '资源不存在',
  'storage-cross-project-denied': '资源不存在',
  'storage-cross-plugin-namespace': '资源不存在',
  'storage-install-not-enabled': '资源不存在',
  'storage-namespace-not-found': '存储命名空间或条目不存在',
  'storage-namespace-read-only': '存储命名空间当前不可写（停用状态）',
  'storage-namespace-orphaned': '存储命名空间已随卸载进入保留态',
  'storage-namespace-pending-deletion': '存储命名空间处于待删除状态',
  'storage-key-invalid': 'key 格式非法',
  'storage-value-invalid': 'value 必须是有界的 canonical JSON 文档',
  'storage-value-too-large': 'value 超过单项大小上限',
  'storage-secret-like-content': 'value 含疑似凭据内容，存储不是 secret vault',
  'storage-entry-limit-reached': '条目数达到配额上限',
  'storage-quota-exceeded': '存储配额超限',
  'storage-quota-org-exceeded': '组织级存储配额超限',
  'storage-quota-project-exceeded': '项目级存储配额超限',
  'storage-revision-conflict': 'revision 冲突：请基于最新版本重试',
  'storage-cleanup-handle-invalid': '清理句柄非法',
  'storage-cleanup-handle-expired': '清理句柄已过期，请重新预览',
  'storage-cleanup-binding-mismatch': '清理绑定失配：内容已在预览后变化',
  'storage-cleanup-already-consumed': '清理句柄已被消费',
  'storage-cleanup-audit-failed': '审计写入失败，操作已回滚',
  'storage-export-permission-denied': '无权导出插件存储数据',
  'storage-export-too-large': '导出超过上限',
  'storage-export-scan-failed': '导出内容未通过低敏扫描（fail closed）',
  'storage-pagination-invalid': '分页参数非法',
  'storage-unknown-error': '内部错误',
}

export interface StorageFailureBody {
  error: { code: string; message: string }
}

export function storageFailureResponse(failure: FailureLike): {
  status: number
  body: StorageFailureBody
} {
  return {
    status: failure.httpStatus,
    body: {
      error: {
        code: failure.reasonCode,
        message: MESSAGES[failure.reasonCode] ?? '请求被拒绝',
      },
    },
  }
}
