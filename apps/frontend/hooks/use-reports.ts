'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateReportRequest, ExportReportRequest, ReportExportFormat } from '@aiproj/types'
import {
  createReport,
  downloadReportFile,
  exportReport,
  getReport,
  listReports,
  type ReportListFilters,
} from '@/lib/api/reports'

/**
 * preset-project-reports —— TanStack Query 键与 Hooks（tasks 6.1）。
 *
 * 键结构对齐 use-risks.ts / use-projects.ts 的三层分层：
 *   all → lists() → list(...) / details() → detail(...)。
 *
 * 变更操作后按最窄范围失效：生成 → lists()；导出 → detail(reportId)。
 */

export const reportKeys = {
  all: ['reports'] as const,
  lists: () => [...reportKeys.all, 'list'] as const,
  list: (projectId: number, filters?: ReportListFilters) =>
    [...reportKeys.lists(), projectId, filters] as const,
  details: () => [...reportKeys.all, 'detail'] as const,
  detail: (reportId: number) => [...reportKeys.details(), reportId] as const,
}

/**
 * 项目报表历史分页列表。
 */
export function useReportList(projectId: number, filters: ReportListFilters = {}) {
  return useQuery({
    queryKey: reportKeys.list(projectId, filters),
    queryFn: () => listReports(projectId, filters),
    enabled: !!projectId,
  })
}

/**
 * 报表详情（读取已保存的快照）。
 */
export function useReportDetail(reportId: number | null | undefined) {
  return useQuery({
    queryKey: reportKeys.detail(reportId ?? 0),
    queryFn: () => getReport(reportId as number),
    enabled: !!reportId,
  })
}

/**
 * 生成一次预设模板报表。成功后失效 lists() 让历史刷新。
 */
export function useCreateReport(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateReportRequest) => createReport(projectId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
    },
  })
}

/**
 * 触发导出。成功后失效对应报表 detail —— 后端会写入 file_format/file_path。
 */
export function useExportReport(reportId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ExportReportRequest) => exportReport(reportId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(reportId) })
    },
  })
}

/**
 * 下载已导出文件为浏览器 blob。UI 层负责 `URL.createObjectURL` → 触发 <a download>。
 * 保留为 mutation 以便 UI 显示加载/错误状态。
 */
export function useDownloadReport() {
  return useMutation({
    mutationFn: ({ reportId, format }: { reportId: number; format: ReportExportFormat }) =>
      downloadReportFile(reportId, format),
  })
}
