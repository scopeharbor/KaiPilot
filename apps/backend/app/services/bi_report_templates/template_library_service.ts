/**
 * bi_report_templates/template_library_service —— BI 报表模板库只读服务（tasks §3.1）。
 *
 * 职责：
 *   - 目录列表：合并内置模板 + 组织活跃自定义副本
 *   - 模板详情
 *   - 预览聚合：按数据源键分发既有只读服务，逐源 freshness/warning
 *   - 单源失败降级为 partial 而非整体 500
 *   - 读路径无副作用（不触 AI/快照刷新/外发）
 */
import { inject } from '@adonisjs/core'
import type {
  BiTemplateEntry,
  BiTemplatePreview,
  BiTemplateWarning,
  BiPreviewSourceResult,
  BiDataSourceKey,
  BiTemplateId,
  BiCopyStatus,
  BiTemplateDef,
} from '@aiproj/types'
import {
  BI_FRESHNESS_STATES,
  BI_TEMPLATE_WARNING_CODES,
  buildBiTemplateWarning,
  buildBiSourceFreshness,
  aggregateBiTemplateFreshness,
  isPluginBiTemplateId,
} from '@aiproj/types'
import {
  getBuiltinBiTemplates,
  getBuiltinBiTemplate,
  getBuiltinBiTemplateVersion,
  isBuiltinBiTemplate,
} from './registry.js'
import ReportTemplate from '#models/report_template'
import PluginTemplatePackService from '#services/plugin_template_pack_service'

/**
 * BiTemplateLibraryService —— BI 报表模板库只读服务。
 */
@inject()
export class BiTemplateLibraryService {
  constructor(private readonly pluginTemplatePackService?: PluginTemplatePackService) {}

  /**
   * 解析模板来源三分支 helper（builtin / organization-copy / plugin / unknown）。
   */
  resolveTemplateSource(
    templateId: string,
  ): 'builtin' | 'organization-copy' | 'plugin' | 'unknown' {
    if (isBuiltinBiTemplate(templateId)) return 'builtin'
    if (templateId.startsWith('copy_')) return 'organization-copy'
    if (isPluginBiTemplateId(templateId)) return 'plugin'
    return 'unknown'
  }

  /**
   * 列出组织可见的 BI 报表模板目录。
   *
   * 顺序：内置模板在前，插件贡献模板居中，组织活跃自定义副本在后。
   */
  async listTemplates(
    organizationId: number,
    query?: { category?: string; page?: number; perPage?: number },
  ): Promise<{
    data: BiTemplateEntry[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const builtin = getBuiltinBiTemplates()
    const page = query?.page ?? 1
    const perPage = query?.perPage ?? 20

    // 1. 构建内置模板条目
    const builtinEntries: BiTemplateEntry[] = builtin
      .filter((t) => !query?.category || t.category === query.category)
      .map((t) => ({
        templateId: t.templateId,
        version: t.version,
        name: t.name,
        description: t.description,
        category: t.category,
        scenario: t.scenario,
        builtin: true,
        isCopy: false,
        source: 'builtin',
      }))

    // 2. 插件贡献模板条目（居中）
    let pluginEntries: BiTemplateEntry[] = []
    if (this.pluginTemplatePackService) {
      try {
        pluginEntries = await this.pluginTemplatePackService.listPluginTemplates(organizationId, {
          category: query?.category,
        })
      } catch {
        pluginEntries = []
      }
    }

    // 3. 查询组织自定义副本（在后）
    const copies = await ReportTemplate.query()
      .where('organization_id', organizationId)
      .where('status', 'active')
    let copyEntries: BiTemplateEntry[] = copies.map((c) => {
      const currentVersion = getBuiltinBiTemplateVersion(c.sourceTemplateId as BiTemplateId)
      const sourceDef = builtin.find((b) => b.templateId === c.sourceTemplateId)
      return {
        templateId: `copy_${c.id}`,
        version: c.sourceVersion,
        name: c.name,
        description: c.description,
        category: sourceDef?.category ?? ('execution' as BiTemplateEntry['category']),
        scenario: sourceDef?.scenario ?? ('weekly_review' as BiTemplateEntry['scenario']),
        builtin: false,
        isCopy: true,
        source: 'organization-copy',
        sourceTemplateId: c.sourceTemplateId as BiTemplateId,
        sourceVersion: c.sourceVersion,
        hasNewerVersion: c.sourceVersion < currentVersion,
        copyStatus: c.status as BiCopyStatus,
        createdAt: c.createdAt.toISO() ?? undefined,
        updatedAt: c.updatedAt.toISO() ?? undefined,
      }
    })

    if (query?.category) {
      copyEntries = copyEntries.filter((c) => c.category === query.category)
    }

    // 合并并排序：内置模板在前，插件贡献居中，自定义副本在后
    const all = [...builtinEntries, ...pluginEntries, ...copyEntries]

    // 分页
    const total = all.length
    const totalPages = Math.ceil(total / perPage)
    const start = (page - 1) * perPage
    const paged = all.slice(start, start + perPage)

    return {
      data: paged,
      meta: { total, page, perPage, totalPages },
    }
  }

  /**
   * 获取单个模板详情。
   *
   * 先查内置注册表，再查插件贡献，最后查组织自定义副本。
   */
  async getTemplate(organizationId: number, templateId: string): Promise<BiTemplateEntry | null> {
    const source = this.resolveTemplateSource(templateId)

    if (source === 'builtin') {
      const def = getBuiltinBiTemplate(templateId)
      if (!def) return null
      return {
        templateId: def.templateId,
        version: def.version,
        name: def.name,
        description: def.description,
        category: def.category,
        scenario: def.scenario,
        builtin: true,
        isCopy: false,
        source: 'builtin',
      }
    }

    if (source === 'plugin') {
      if (!this.pluginTemplatePackService) return null
      const res = await this.pluginTemplatePackService.getPluginTemplate(organizationId, templateId)
      return res ? res.entry : null
    }

    if (source === 'organization-copy') {
      const copyId = Number.parseInt(templateId.replace('copy_', ''), 10)
      if (Number.isNaN(copyId)) return null

      const copy = await ReportTemplate.query()
        .where('id', copyId)
        .where('organization_id', organizationId)
        .first()
      if (!copy) return null

      const sourceDef = getBuiltinBiTemplate(copy.sourceTemplateId as BiTemplateId)
      const currentVersion = getBuiltinBiTemplateVersion(copy.sourceTemplateId as BiTemplateId)

      return {
        templateId,
        version: copy.sourceVersion,
        name: copy.name,
        description: copy.description,
        category: (sourceDef?.category ?? 'execution') as BiTemplateEntry['category'],
        scenario: (sourceDef?.scenario ?? 'weekly_review') as BiTemplateEntry['scenario'],
        builtin: false,
        isCopy: true,
        source: 'organization-copy',
        sourceTemplateId: copy.sourceTemplateId as BiTemplateId,
        sourceVersion: copy.sourceVersion,
        hasNewerVersion: copy.sourceVersion < currentVersion,
        copyStatus: copy.status as BiCopyStatus,
        createdAt: copy.createdAt.toISO() ?? undefined,
        updatedAt: copy.updatedAt.toISO() ?? undefined,
      }
    }

    return null
  }

  /**
   * 获取模板预览 —— 按数据源键分发到既有只读服务，组装结果。
   *
   * 预览为只读聚合：逐数据源调用，单源失败降级为 partial + warning。
   * 读路径无副作用：不调 AIGateway、不刷新快照、不外发。
   */
  async previewTemplate(organizationId: number, templateId: string): Promise<BiTemplatePreview> {
    const source = this.resolveTemplateSource(templateId)
    let def: BiTemplateDef | undefined
    let version: number = 1

    if (source === 'builtin') {
      const builtin = getBuiltinBiTemplate(templateId)
      if (!builtin) {
        return this.buildEmptyPreview(templateId, 1)
      }
      def = builtin
      version = builtin.version
    } else if (source === 'plugin') {
      if (!this.pluginTemplatePackService) {
        return this.buildEmptyPreview(templateId, 1)
      }
      const res = await this.pluginTemplatePackService.getPluginTemplate(organizationId, templateId)
      if (!res) {
        return this.buildEmptyPreview(templateId, 1)
      }
      def = res.def
      version = res.entry.version
    } else if (source === 'organization-copy') {
      const copyId = Number.parseInt(templateId.replace('copy_', ''), 10)
      if (Number.isNaN(copyId)) {
        return this.buildEmptyPreview(templateId, 1)
      }
      const copy = await ReportTemplate.query()
        .where('id', copyId)
        .where('organization_id', organizationId)
        .first()
      if (!copy) {
        return this.buildEmptyPreview(templateId, 1)
      }
      const builtin = getBuiltinBiTemplate(copy.sourceTemplateId as BiTemplateId)
      if (!builtin) {
        return this.buildEmptyPreview(templateId, 1)
      }
      def = builtin
      version = copy.sourceVersion
    } else {
      return this.buildEmptyPreview(templateId, 1)
    }

    // 逐数据源生成预览结果
    const sources: BiPreviewSourceResult[] = []
    const allWarnings: BiTemplateWarning[] = []

    for (const dsKey of def.composition.dataSourceKeys) {
      try {
        const result = await this.previewDataSource(dsKey, organizationId)
        sources.push(result)
        allWarnings.push(...result.warnings)
      } catch {
        // 单源失败降级
        sources.push({
          dataSourceKey: dsKey,
          status: 'unavailable',
          freshness: buildBiSourceFreshness(
            dsKey,
            BI_FRESHNESS_STATES.UNAVAILABLE,
            null,
            `数据源 ${dsKey} 聚合失败`,
          ),
          warnings: [
            buildBiTemplateWarning(
              BI_TEMPLATE_WARNING_CODES.DATASOURCE_UNAVAILABLE,
              'warning',
              `数据源 ${dsKey} 聚合失败`,
              dsKey,
            ),
          ],
          redactions: [],
          data: null,
        })
        allWarnings.push(
          buildBiTemplateWarning(
            BI_TEMPLATE_WARNING_CODES.DATASOURCE_UNAVAILABLE,
            'warning',
            `数据源 ${dsKey} 聚合失败`,
            dsKey,
          ),
        )
      }
    }

    // 聚合 freshness
    const freshnessList = sources.map((s) => s.freshness)
    const aggregatedFreshness = aggregateBiTemplateFreshness(freshnessList)

    return {
      templateId: templateId as BiTemplateId,
      version,
      sources,
      warnings: allWarnings,
      blocking: allWarnings.some((w) => w.level === 'critical'),
      aggregatedFreshness,
    }
  }

  /**
   * 预览单个数据源 —— 为每个数据源键提供占位实现。
   *
   * 实际实现中会分发到对应的既有只读服务（组织 Dashboard、PMO、资源池等）。
   * 当前提供 fixture 级降级：返回 fresh + 空数据 + info warning。
   */
  private async previewDataSource(
    _dataSourceKey: BiDataSourceKey,
    _organizationId: number,
  ): Promise<BiPreviewSourceResult> {
    // 占位实现：返回 fresh + 空数据
    // 实际接入时替换为对应服务的只读调用
    return {
      dataSourceKey: _dataSourceKey,
      status: 'available',
      freshness: buildBiSourceFreshness(
        _dataSourceKey,
        BI_FRESHNESS_STATES.FRESH,
        new Date().toISOString(),
      ),
      warnings: [
        buildBiTemplateWarning(
          BI_TEMPLATE_WARNING_CODES.DATASOURCE_EMPTY,
          'info',
          `数据源 ${_dataSourceKey} 暂无数据`,
          _dataSourceKey,
        ),
      ],
      redactions: [],
      data: null,
    }
  }

  /**
   * 构建空预览结果（模板不存在时）。
   */
  private buildEmptyPreview(templateId: string, version: number): BiTemplatePreview {
    return {
      templateId: templateId as BiTemplateId,
      version,
      sources: [],
      warnings: [
        buildBiTemplateWarning(
          BI_TEMPLATE_WARNING_CODES.DATASOURCE_UNAVAILABLE,
          'critical',
          '模板不存在或已移除',
        ),
      ],
      blocking: true,
      aggregatedFreshness: BI_FRESHNESS_STATES.UNAVAILABLE,
    }
  }
}
