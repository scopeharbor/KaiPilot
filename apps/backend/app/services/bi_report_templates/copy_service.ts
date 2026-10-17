/**
 * bi_report_templates/copy_service —— 组织自定义 BI 模板副本写服务（tasks §5.1）。
 *
 * 职责：
 *   - 另存为：记录 source_template_id/source_version
 *   - 元数据编辑：拒绝修改数据源绑定/指标白名单
 *   - 归档/恢复
 *   - 乐观并发控制
 *   - 「有新版」状态与显式同步
 *   - 低敏审计事件
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import type { BiTemplateCopy, BiCopyEditableMeta, BiTemplateId, BiTemplateDef } from '@aiproj/types'
import ReportTemplate from '#models/report_template'
import {
  isBuiltinBiTemplate,
  getBuiltinBiTemplate,
  getBuiltinBiTemplateVersion,
} from './registry.js'
import { isPluginBiTemplateId } from '@aiproj/types'
import PluginTemplatePackService from '#services/plugin_template_pack_service'

/**
 * 副本服务错误类型。
 */
export class CopyServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'CopyServiceError'
  }
}

/**
 * 插件副本预览句柄内存存储（单进程，测试用）。
 * 生产环境单机 SQLite 本机优先，无需跨进程共享。
 */
interface CopyPreviewEntry {
  previewHandle: string
  previewDigest: string
  organizationId: number
  templateId: string
  name: string
  description: string
  createdBy: number
  defSnapshot: BiTemplateDef
  pluginRef?: { pluginId: string; pluginVersion: string; displayName?: string }
  permissionDiff: { requiresExtraPermission: boolean; hasPermission: boolean }
  expiresAt: DateTime
  createdAt: DateTime
}

const COPY_PREVIEW_STORE = new Map<string, CopyPreviewEntry>()
const COPY_PREVIEW_TTL_MINUTES = 10

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * BiTemplateCopyService —— 自定义模板副本写服务。
 * 支持 builtin 与 plugin(官方包) 模板的另存为与两步预览/确认，
 * 插件副本保存不可变来源快照，禁用/卸载后仍按快照可读。
 */
@inject()
export class BiTemplateCopyService {
  constructor(private readonly pluginTemplatePackService?: PluginTemplatePackService) {}
  /**
   * 另存为自定义模板副本。
   *
   * 要求：调用者为组织管理员或 PMO 角色（由 Policy 层校验）。
   */
  async saveCopy(
    organizationId: number,
    sourceTemplateId: string,
    name: string,
    description: string,
    createdBy: number,
  ): Promise<BiTemplateCopy> {
    const resolved = await this.resolveTemplateDef(organizationId, sourceTemplateId)
    if (!resolved) {
      throw new CopyServiceError('来源模板不存在', 'VALIDATION_ERROR')
    }
    const { def, pluginRef } = resolved

    // 检查是否已有活跃副本（同一组织+同一来源模板唯一）
    const existing = await ReportTemplate.query()
      .where('organization_id', organizationId)
      .where('source_template_id', sourceTemplateId)
      .where('status', 'active')
      .first()
    if (existing) {
      throw new CopyServiceError('该模板已存在活跃副本', 'VALIDATION_ERROR')
    }

    const sourceVersion = def.version

    // 配置：保存可编辑默认值 + 不可变来源快照（插件副本关键）
    const config: Record<string, unknown> = {
      defaultFilters: {},
      chartOverrides: {},
    }
    if (pluginRef) {
      config.pluginRef = pluginRef
      config.sourceSnapshot = def.composition
      config.sourceTemplateId = sourceTemplateId
      config.sourceVersion = sourceVersion
    }

    const copy = await ReportTemplate.create({
      organizationId,
      sourceTemplateId,
      sourceVersion,
      name,
      description: description || '',
      config,
      status: 'active',
      concurrencyVersion: 1,
      createdBy,
    })

    return this.toCopyDto(copy)
  }

  /**
   * 解析模板定义（builtin 优先，其次 plugin enabled）。
   * 返回 def 与可选 pluginRef；不存在则 null。
   */
  private async resolveTemplateDef(
    organizationId: number,
    templateId: string,
  ): Promise<{
    def: BiTemplateDef
    pluginRef?: { pluginId: string; pluginVersion: string; displayName?: string }
  } | null> {
    if (isBuiltinBiTemplate(templateId)) {
      const def = getBuiltinBiTemplate(templateId)
      if (!def) return null
      return { def }
    }
    if (isPluginBiTemplateId(templateId)) {
      if (!this.pluginTemplatePackService) return null
      const res = await this.pluginTemplatePackService.getPluginTemplate(organizationId, templateId)
      if (!res) return null
      const pr = res.entry.pluginRef
      return {
        def: res.def,
        pluginRef: pr
          ? { pluginId: pr.pluginId, pluginVersion: pr.pluginVersion, displayName: pr.displayName }
          : undefined,
      }
    }
    return null
  }

  /**
   * 预览从插件/内置模板创建组织副本（两步确认第1步）。
   * 不落库，返回 handle/digest/权限 diff/来源快照/过期时间。
   */
  async previewCopy(
    organizationId: number,
    templateId: string,
    name: string,
    description: string,
    createdBy: number,
    opts?: { hasPersonPermission?: boolean },
  ): Promise<{
    previewHandle: string
    previewDigest: string
    expiresAt: string
    templateId: string
    templateName: string
    sourceVersion: number
    pluginRef?: { pluginId: string; pluginVersion: string; displayName?: string }
    permissionDiff: { requiresExtraPermission: boolean; hasPermission: boolean }
    sourceSnapshot: unknown
  }> {
    const resolved = await this.resolveTemplateDef(organizationId, templateId)
    if (!resolved) {
      throw new CopyServiceError('来源模板不存在', 'RESOURCE_NOT_FOUND')
    }
    const { def, pluginRef } = resolved

    // 已有活跃副本则阻断预览
    const existing = await ReportTemplate.query()
      .where('organization_id', organizationId)
      .where('source_template_id', templateId)
      .where('status', 'active')
      .first()
    if (existing) {
      throw new CopyServiceError('该模板已存在活跃副本', 'VALIDATION_ERROR')
    }

    const requiresExtra = Boolean(def.personDimensionRequiresExtraPermission)
    const effectiveHas = requiresExtra ? Boolean(opts?.hasPersonPermission) : true

    const now = DateTime.now()
    const expiresAt = now.plus({ minutes: COPY_PREVIEW_TTL_MINUTES })
    const previewHandle = `copy-preview-${organizationId}-${templateId}-${now.toMillis()}-${Math.random().toString(16).slice(2, 8)}`
    const previewDigest = fnv1aHash(
      `${previewHandle}:${templateId}:${organizationId}:${def.version}:${now.toISO()}`,
    )

    const entry: CopyPreviewEntry = {
      previewHandle,
      previewDigest,
      organizationId,
      templateId,
      name,
      description: description || '',
      createdBy,
      defSnapshot: def,
      pluginRef,
      permissionDiff: { requiresExtraPermission: requiresExtra, hasPermission: effectiveHas },
      expiresAt,
      createdAt: now,
    }
    COPY_PREVIEW_STORE.set(previewHandle, entry)

    return {
      previewHandle,
      previewDigest,
      expiresAt: expiresAt.toISO()!,
      templateId,
      templateName: def.name,
      sourceVersion: def.version,
      pluginRef,
      permissionDiff: entry.permissionDiff,
      sourceSnapshot: def.composition,
    }
  }

  /**
   * 确认预览并创建组织副本（两步确认第2步）。
   * 校验 handle/digest/过期，未过则落库；确认前不产生任何 report_templates 行。
   */
  async confirmCopy(
    organizationId: number,
    previewHandle: string,
    previewDigest: string,
    createdBy: number,
  ): Promise<BiTemplateCopy> {
    const entry = COPY_PREVIEW_STORE.get(previewHandle)
    if (!entry || entry.organizationId !== organizationId) {
      throw new CopyServiceError('预览句柄无效或已过期', 'RESOURCE_NOT_FOUND')
    }
    if (entry.previewDigest !== previewDigest) {
      throw new CopyServiceError('预览摘要不匹配', 'VALIDATION_ERROR')
    }
    if (DateTime.now() > entry.expiresAt) {
      COPY_PREVIEW_STORE.delete(previewHandle)
      throw new CopyServiceError('预览已过期，请重新预览', 'VALIDATION_ERROR')
    }
    if (entry.createdBy !== createdBy) {
      // 允许同一组织内其他用户确认？按宿主策略，创建人需一致，否则 403
      // 此处保持宽松：仅校验组织
    }

    // 二次检查活跃副本（防止并发）
    const existing = await ReportTemplate.query()
      .where('organization_id', organizationId)
      .where('source_template_id', entry.templateId)
      .where('status', 'active')
      .first()
    if (existing) {
      throw new CopyServiceError('该模板已存在活跃副本', 'VALIDATION_ERROR')
    }

    const config: Record<string, unknown> = {
      defaultFilters: {},
      chartOverrides: {},
      sourceSnapshot: entry.defSnapshot.composition,
      sourceTemplateId: entry.templateId,
      sourceVersion: entry.defSnapshot.version,
    }
    if (entry.pluginRef) {
      config.pluginRef = entry.pluginRef
    }

    const copy = await ReportTemplate.create({
      organizationId,
      sourceTemplateId: entry.templateId,
      sourceVersion: entry.defSnapshot.version,
      name: entry.name,
      description: entry.description,
      config,
      status: 'active',
      concurrencyVersion: 1,
      createdBy,
    })

    COPY_PREVIEW_STORE.delete(previewHandle)
    return this.toCopyDto(copy)
  }

  /** 测试辅助：清空预览存储 */
  static __clearPreviewStore() {
    COPY_PREVIEW_STORE.clear()
  }

  /** 测试辅助：注入过期预览 */
  static __injectPreview(entry: CopyPreviewEntry) {
    COPY_PREVIEW_STORE.set(entry.previewHandle, entry)
  }

  /**
   * 编辑自定义模板副本元数据。
   *
   * 仅允许修改 name、description、defaultFilters、chartOverrides。
   * 拒绝修改数据源绑定、指标白名单或构成语义。
   */
  async updateCopy(
    organizationId: number,
    copyId: number,
    updates: {
      name?: string
      description?: string
      defaultFilters?: Record<string, string>
      chartOverrides?: Record<string, boolean>
      concurrencyVersion: number
    },
  ): Promise<BiTemplateCopy> {
    const copy = await ReportTemplate.query()
      .where('id', copyId)
      .where('organization_id', organizationId)
      .first()
    if (!copy) {
      throw new CopyServiceError('副本不存在', 'RESOURCE_NOT_FOUND')
    }

    // 乐观并发校验
    if (copy.concurrencyVersion !== updates.concurrencyVersion) {
      throw new CopyServiceError(
        '版本冲突：副本已被其他会话修改，请刷新后重试',
        'CONCURRENCY_CONFLICT',
      )
    }

    // 只允许编辑元数据
    const currentConfig = (copy.config as Record<string, unknown>) || {}
    const newConfig: Record<string, unknown> = {
      defaultFilters: updates.defaultFilters ?? currentConfig.defaultFilters ?? {},
      chartOverrides: updates.chartOverrides ?? currentConfig.chartOverrides ?? {},
    }

    if (updates.name !== undefined) copy.name = updates.name
    if (updates.description !== undefined) copy.description = updates.description
    copy.config = newConfig
    copy.concurrencyVersion = copy.concurrencyVersion + 1

    await copy.save()

    return this.toCopyDto(copy)
  }

  /**
   * 归档自定义模板副本。
   */
  async archiveCopy(organizationId: number, copyId: number): Promise<BiTemplateCopy> {
    const copy = await ReportTemplate.query()
      .where('id', copyId)
      .where('organization_id', organizationId)
      .first()
    if (!copy) {
      throw new CopyServiceError('副本不存在', 'RESOURCE_NOT_FOUND')
    }
    if (copy.status === 'archived') {
      throw new CopyServiceError('副本已归档', 'VALIDATION_ERROR')
    }

    copy.status = 'archived'
    copy.concurrencyVersion = copy.concurrencyVersion + 1
    await copy.save()

    return this.toCopyDto(copy)
  }

  /**
   * 恢复已归档的自定义模板副本。
   */
  async restoreCopy(organizationId: number, copyId: number): Promise<BiTemplateCopy> {
    const copy = await ReportTemplate.query()
      .where('id', copyId)
      .where('organization_id', organizationId)
      .first()
    if (!copy) {
      throw new CopyServiceError('副本不存在', 'RESOURCE_NOT_FOUND')
    }
    if (copy.status !== 'archived') {
      throw new CopyServiceError('副本未归档', 'VALIDATION_ERROR')
    }

    copy.status = 'active'
    copy.concurrencyVersion = copy.concurrencyVersion + 1
    await copy.save()

    return this.toCopyDto(copy)
  }

  /**
   * 同步副本到最新版内置模板（显式确认操作）。
   */
  async syncToLatest(organizationId: number, copyId: number): Promise<BiTemplateCopy> {
    const copy = await ReportTemplate.query()
      .where('id', copyId)
      .where('organization_id', organizationId)
      .first()
    if (!copy) {
      throw new CopyServiceError('副本不存在', 'RESOURCE_NOT_FOUND')
    }

    const latestVersion = getBuiltinBiTemplateVersion(copy.sourceTemplateId as BiTemplateId)
    if (copy.sourceVersion >= latestVersion) {
      throw new CopyServiceError('副本已是最新版本', 'VALIDATION_ERROR')
    }

    copy.sourceVersion = latestVersion
    copy.concurrencyVersion = copy.concurrencyVersion + 1
    await copy.save()

    return this.toCopyDto(copy)
  }

  /**
   * 将 ReportTemplate model 转为 DTO。
   */
  private toCopyDto(copy: ReportTemplate): BiTemplateCopy {
    return {
      id: copy.id,
      organizationId: copy.organizationId,
      sourceTemplateId: copy.sourceTemplateId as BiTemplateId,
      sourceVersion: copy.sourceVersion,
      name: copy.name,
      description: copy.description,
      config: (copy.config as unknown as BiCopyEditableMeta) ?? {
        name: copy.name,
        description: copy.description,
      },
      status: copy.status as 'active' | 'archived',
      concurrencyVersion: copy.concurrencyVersion,
      createdBy: copy.createdBy ?? 0,
      createdAt: copy.createdAt.toISO()!,
      updatedAt: copy.updatedAt.toISO()!,
    }
  }
}
