/**
 * DocumentSearchIndexPanel — 文档搜索索引状态面板（v3-document-full-text-search §10.6）
 *
 * 展示当前项目的文档搜索索引状态，提供重建索引入口。
 * 权限降级：无 manage 权限时只展示状态，禁用重建按钮。
 */
'use client'

import * as React from 'react'
import { AlertCircle, FileSearch, RefreshCw, Loader2, Database } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { useDocumentSearchStatus, useReindexDocumentSearch } from '@/hooks/use-document-search'
import type { DocumentSearchStatus } from '@aiproj/types'

// ============================================================
// 子组件：状态行
// ============================================================

function StatusRow({
  label,
  value,
  badgeVariant,
}: {
  label: string
  value: string | number
  badgeVariant?: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      {badgeVariant ? (
        <Badge variant={badgeVariant}>{value}</Badge>
      ) : (
        <span className="font-medium text-gray-800">{value}</span>
      )}
    </div>
  )
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '从未索引'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '未知'
  }
}

// ============================================================
// 面板主体
// ============================================================

export interface DocumentSearchIndexPanelProps {
  projectId: number
  /** 当前用户是否拥有 manage 权限 */
  canManage?: boolean
}

export function DocumentSearchIndexPanel({
  projectId,
  canManage = false,
}: DocumentSearchIndexPanelProps) {
  const statusQuery = useDocumentSearchStatus(projectId)
  const reindexMutation = useReindexDocumentSearch(projectId)

  // 加载态
  if (statusQuery.isLoading) {
    return (
      <Card variant="outlined" className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="w-4 h-4" />
            文档搜索索引
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </CardContent>
      </Card>
    )
  }

  // 错误态
  if (statusQuery.isError) {
    return (
      <Card variant="outlined" className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger">
            <AlertCircle className="w-4 h-4" />
            文档搜索索引
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <AlertCircle className="w-8 h-8 text-danger" />
            <p className="text-sm text-gray-600">索引状态获取失败</p>
            <Button variant="secondary" size="sm" onClick={() => statusQuery.refetch()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              重试
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // 空态（无数据）
  if (!statusQuery.data?.data) {
    return (
      <Card variant="outlined" className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="w-4 h-4" />
            文档搜索索引
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Database className="w-8 h-8 text-gray-300" />
            <p className="text-sm text-gray-500">暂无索引状态数据</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const status: DocumentSearchStatus = statusQuery.data.data

  // 重建中
  const isRebuilding = reindexMutation.isPending

  return (
    <Card variant="outlined" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSearch className="w-4 h-4" />
          文档搜索索引
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-gray-100">
          {/* 可索引总数 */}
          <StatusRow label="可索引文档" value={status.totalIndexable} />

          {/* 已索引 */}
          <StatusRow
            label="已索引"
            value={status.indexed}
            badgeVariant={
              status.indexed === status.totalIndexable && status.totalIndexable > 0
                ? 'success'
                : 'warning'
            }
          />

          {/* 过期/缺失 */}
          {status.staleOrMissing > 0 && (
            <StatusRow label="过期/缺失" value={status.staleOrMissing} badgeVariant="warning" />
          )}

          {/* 截断 */}
          {status.truncated > 0 && (
            <StatusRow label="截断" value={status.truncated} badgeVariant="danger" />
          )}

          {/* 最后索引时间 */}
          <StatusRow label="最后索引" value={formatDateTime(status.lastIndexedAt)} />
        </div>

        {/* 重建按钮 */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          {canManage ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={isRebuilding}
              onClick={() => reindexMutation.mutate(false)}
              className="w-full sm:w-auto"
            >
              {isRebuilding ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  重建中...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  重建索引
                </>
              )}
            </Button>
          ) : (
            <p className="text-xs text-gray-400">需要管理权限才能重建索引</p>
          )}
        </div>

        {/* 重建结果反馈 */}
        {reindexMutation.isSuccess && reindexMutation.data?.data && (
          <div className="mt-3 p-2 bg-success-bg rounded text-xs text-success">
            重建完成：已索引 {reindexMutation.data.data.indexed}，跳过{' '}
            {reindexMutation.data.data.skipped}，移除 {reindexMutation.data.data.removed}
            {reindexMutation.data.data.truncated > 0 &&
              `，截断 ${reindexMutation.data.data.truncated}`}
            {reindexMutation.data.data.warnings.length > 0 && '，有警告'}
          </div>
        )}

        {/* 重建错误反馈 */}
        {reindexMutation.isError && (
          <div className="mt-3 p-2 bg-danger-bg rounded text-xs text-danger">
            重建失败，请稍后重试
          </div>
        )}
      </CardContent>
    </Card>
  )
}
