/**
 * report_v2/data_source_registry —— 统一报表数据源注册表。
 *
 * 数据源适配器在此集中注册，模板只声明所需数据源。
 * 聚合时由聚合服务统一执行权限过滤、组织隔离、warnings 和 hash 计算。
 */
import type { ReportDataSourceResult, ReportGenerateFilters } from '@aiproj/types'
import type { DataSourceAdapter } from './data_source_adapter.js'

/** 聚合结果：sourceKey → Result 映射 */
export type DataSourceResultMap = Record<string, ReportDataSourceResult>

/**
 * ReportDataSourceRegistry —— 数据源注册表。
 */
export class ReportDataSourceRegistry {
  private adapters = new Map<string, DataSourceAdapter>()

  /** 注册一个数据源适配器 */
  register(adapter: DataSourceAdapter): this {
    this.adapters.set(adapter.sourceKey, adapter)
    return this
  }

  /** 批量注册 */
  registerAll(adapters: DataSourceAdapter[]): this {
    for (const a of adapters) {
      this.register(a)
    }
    return this
  }

  /** 获取已注册的适配器 */
  get(sourceKey: string): DataSourceAdapter | undefined {
    return this.adapters.get(sourceKey)
  }

  /** 列出所有已注册的 key */
  listKeys(): string[] {
    return [...this.adapters.keys()]
  }

  /**
   * 聚合指定数据源集合。返回 sourceKey → Result 映射。
   * 缺失 key 返回 unavailable 结果；权限不足由适配器内返回 forbidden。
   */
  async aggregateMany(
    sourceKeys: string[],
    organizationId: number,
    projectId: number,
    userId: number,
    filters: ReportGenerateFilters,
  ): Promise<DataSourceResultMap> {
    const results: DataSourceResultMap = {}

    for (const key of sourceKeys) {
      const adapter = this.adapters.get(key)
      if (!adapter) {
        results[key] = {
          sourceKey: key,
          status: 'unavailable',
          generatedAt: new Date().toISOString(),
          data: null,
          warnings: [
            {
              code: 'REPORT_DATASOURCE_UNAVAILABLE',
              level: 'info',
              message: `数据源 "${key}" 未注册`,
            },
          ],
          sourceHash: '',
        }
        continue
      }

      try {
        results[key] = await adapter.aggregate(organizationId, projectId, userId, filters)
      } catch {
        results[key] = {
          sourceKey: key,
          status: 'unavailable',
          generatedAt: new Date().toISOString(),
          data: null,
          warnings: [
            {
              code: 'REPORT_DATASOURCE_UNAVAILABLE',
              level: 'warning',
              message: `数据源 "${key}" 聚合失败`,
            },
          ],
          sourceHash: '',
        }
      }
    }

    return results
  }
}
