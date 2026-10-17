// apps/frontend/hooks/use-bi-aggregation.ts
// v3-bi-data-aggregation-service §7.2：TanStack Query hooks 和 query key helper。
// 确保语义相同但参数顺序不同的 query 生成稳定 key。

import { useQuery } from '@tanstack/react-query'
import {
  biAggregationKeys,
  fetchBiAggregation,
  parseBiAggregationError,
  type BiAggregationApiParams,
} from '@/lib/api/bi-aggregation'
import type { BiAggregationResponse } from '@aiproj/types'

/**
 * BI 聚合查询 hook。
 *
 * 特性：
 *   - 稳定 query key：相同语义参数不同顺序时生成相同 key
 *   - 自动解析错误信封
 *   - 支持所有白名单参数
 */
export function useBiAggregation(params: BiAggregationApiParams) {
  // 规范化参数以生成稳定 key：metricKeys 排序
  const normalizedParams: BiAggregationApiParams = {
    ...params,
    metricKeys: params.metricKeys ? [...params.metricKeys].sort() : [],
    dimensions: params.dimensions ? [...params.dimensions].sort() : undefined,
  }

  return useQuery<BiAggregationResponse, Error>({
    queryKey: biAggregationKeys.aggregation(params.organizationId, normalizedParams),
    queryFn: () => fetchBiAggregation(params),
    staleTime: 5 * 60 * 1000, // 5 分钟 stale
    retry: 1,
    enabled: params.metricKeys.length > 0,
  })
}

/**
 * BI 聚合查询 key helper：生成稳定 query key。
 */
export function useBiAggregationQueryKey(params: BiAggregationApiParams) {
  const normalizedParams: BiAggregationApiParams = {
    ...params,
    metricKeys: params.metricKeys ? [...params.metricKeys].sort() : [],
    dimensions: params.dimensions ? [...params.dimensions].sort() : undefined,
  }
  return biAggregationKeys.aggregation(params.organizationId, normalizedParams)
}

/**
 * 解析 BI 聚合查询错误。
 */
export function useBiAggregationError(error: unknown) {
  if (!error) return null
  return parseBiAggregationError(error)
}
