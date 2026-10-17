/**
 * report_v2/data_source_adapter —— 统一报表数据源适配器接口。
 *
 * 每个数据源适配器：
 * - 通过唯一的 sourceKey 注册到 ReportDataSourceRegistry
 * - 聚合查询必须支持项目级时间范围过滤
 * - 输出必须包含 sourceKey、status、generatedAt、data、warnings 和 sourceHash
 * - 缺权返回 forbidden 状态，不抛异常
 * - 降级返回 unavailable 状态和 warning
 */
import type {
  ReportDataSourceResult,
  ReportWarningV2,
  ReportGenerateFilters,
  ReportWarningCode,
  ReportWarningLevel,
} from '@aiproj/types'
import { createHash } from 'node:crypto'

/** 数据源适配器接口 */
export interface DataSourceAdapter<T = unknown> {
  /** 数据源唯一 key（如 'task_summary'） */
  readonly sourceKey: string
  /** 聚合数据（含权限、空数据、降级处理） */
  aggregate(
    organizationId: number,
    projectId: number,
    userId: number,
    filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<T>>
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 计算数据源的 sourceHash */
export function computeSourceHash(data: unknown): string {
  const raw = JSON.stringify(data)
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

/** 创建 warning */
export function makeWarning(
  code: ReportWarningCode,
  level: ReportWarningLevel,
  message: string,
): ReportWarningV2 {
  return { code, level, message }
}

/** 创建 success result */
export function makeSuccess<T>(
  sourceKey: string,
  data: T,
  warnings: ReportWarningV2[] = [],
  metricVersion?: string,
  calculatedAt?: string,
): ReportDataSourceResult<T> {
  return {
    sourceKey,
    status: 'available',
    generatedAt: new Date().toISOString(),
    data,
    warnings,
    sourceHash: computeSourceHash(data),
    ...(metricVersion ? { metricVersion } : {}),
    ...(calculatedAt ? { calculatedAt } : {}),
  }
}

/** 创建 forbidden result（无数据） */
export function makeForbidden<T = null>(sourceKey: string): ReportDataSourceResult<T> {
  return {
    sourceKey,
    status: 'forbidden',
    generatedAt: new Date().toISOString(),
    data: null,
    warnings: [makeWarning('REPORT_DATASOURCE_FORBIDDEN', 'warning', '无权访问该数据源')],
    sourceHash: '',
  }
}

/** 创建 unavailable result（模块未实现或降级） */
export function makeUnavailable<T = null>(
  sourceKey: string,
  message: string = '数据源暂不可用',
): ReportDataSourceResult<T> {
  return {
    sourceKey,
    status: 'unavailable',
    generatedAt: new Date().toISOString(),
    data: null,
    warnings: [makeWarning('REPORT_DATASOURCE_UNAVAILABLE', 'info', message)],
    sourceHash: '',
  }
}

/** 创建 timeout result */
export function makeTimeout<T = null>(sourceKey: string): ReportDataSourceResult<T> {
  return {
    sourceKey,
    status: 'timeout',
    generatedAt: new Date().toISOString(),
    data: null,
    warnings: [makeWarning('REPORT_DATASOURCE_TIMEOUT', 'warning', '数据源聚合超时')],
    sourceHash: '',
  }
}

/** 创建 empty result */
export function makeEmpty<T>(
  sourceKey: string,
  data: T,
  message: string = '暂无数据',
): ReportDataSourceResult<T> {
  return {
    sourceKey,
    status: 'available',
    generatedAt: new Date().toISOString(),
    data,
    warnings: [makeWarning('REPORT_DATASOURCE_EMPTY', 'info', message)],
    sourceHash: computeSourceHash(data),
  }
}
