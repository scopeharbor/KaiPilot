import FileTag from '#models/file_tag'
import FileSearchEntry from '#models/file_search_entry'
import AuditService, { AuditEvent } from '#services/audit_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'

/**
 * 文件标签管理服务（V2 D1）。
 * 标签字典（file_tags）与标签-文件关联通过 file_search_entries.tags_text 维护。
 *
 * 设计决策：由于没有专用的 file_tag_assignments 迁移，标签分配以逗号分隔的标签名
 * 存储在 file_search_entries.tags_text 中（D4 搜索索引表同时承担关联职责）。
 * 标签重命名时会同步更新所有关联的 tags_text。
 */
@inject()
export default class FileTagService {
  constructor(private audit: AuditService) {}

  /**
   * 列出项目下所有标签。
   */
  async listTags(projectId: number, page: number = 1, perPage: number = 50) {
    const query = FileTag.query().where('project_id', projectId).orderBy('name', 'asc')

    const result = await query.paginate(page, perPage)
    const meta = result.getMeta()
    return {
      data: result.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  /**
   * 创建新标签（项目内唯一）。
   */
  async createTag(
    projectId: number,
    organizationId: number,
    name: string,
    color: string | null,
    userId: number,
  ): Promise<FileTag> {
    // 校验标签名在同一项目内唯一
    const existing = await FileTag.query()
      .where('project_id', projectId)
      .where('name', name)
      .first()

    if (existing) {
      throw new ValidationException('标签名已存在')
    }

    const tag = await FileTag.create({
      projectId,
      organizationId,
      name,
      color: color ?? null,
      createdBy: userId,
    })

    // 审计：标签创建
    await this.audit.log({
      event: AuditEvent.FILE_TAG_CREATED,
      userId,
      organizationId,
      projectId,
      entityType: 'file_tag',
      entityId: tag.id,
      metadata: { name, color: color ?? null },
    })

    return tag
  }

  /**
   * 重命名标签（同步更新所有引用了此标签的 search entry）。
   */
  async renameTag(
    projectId: number,
    tagId: number,
    name: string,
    userId: number,
  ): Promise<FileTag> {
    const tag = await FileTag.query().where('id', tagId).where('project_id', projectId).first()

    if (!tag) {
      throw new ResourceNotFoundException('标签不存在')
    }

    const oldName = tag.name
    tag.name = name
    await tag.save()

    // 同步更新所有文件搜索索引中的标签名
    const entries = await FileSearchEntry.query()
      .where('project_id', projectId)
      .where('tags_text', 'like', `%${oldName}%`)
    for (const entry of entries) {
      if (entry.tagsText) {
        const tagNames = entry.tagsText.split(',').map((t) => t.trim())
        const updated = tagNames.map((t) => (t === oldName ? name : t))
        entry.tagsText = updated.join(', ')
        await entry.save()
      }
    }

    // 审计：标签重命名
    await this.audit.log({
      event: AuditEvent.FILE_TAG_UPDATED,
      userId,
      organizationId: tag.organizationId,
      projectId,
      entityType: 'file_tag',
      entityId: tagId,
      changes: { before: { name: oldName }, after: { name } },
    })

    return tag
  }

  /**
   * 更新标签名称和/或颜色。
   */
  async updateTag(
    projectId: number,
    tagId: number,
    name: string,
    userId: number,
    color?: string,
  ): Promise<FileTag> {
    const tag = await FileTag.query().where('id', tagId).where('project_id', projectId).first()

    if (!tag) {
      throw new ResourceNotFoundException('标签不存在')
    }

    const oldName = tag.name
    const oldColor = tag.color

    if (name) {
      tag.name = name
    }
    if (color !== undefined) {
      tag.color = color
    }
    await tag.save()

    // 如果名称变了，同步更新文件搜索索引
    if (name && name !== oldName) {
      const entries = await FileSearchEntry.query()
        .where('project_id', projectId)
        .where('tags_text', 'like', `%${oldName}%`)
      for (const entry of entries) {
        if (entry.tagsText) {
          const tagNames = entry.tagsText.split(',').map((t) => t.trim())
          const updated = tagNames.map((t) => (t === oldName ? name : t))
          entry.tagsText = updated.join(', ')
          await entry.save()
        }
      }
    }

    // 审计：标签更新
    await this.audit.log({
      event: AuditEvent.FILE_TAG_UPDATED,
      userId,
      organizationId: tag.organizationId,
      projectId,
      entityType: 'file_tag',
      entityId: tagId,
      changes: {
        before: { name: oldName, color: oldColor },
        after: { name: tag.name, color: tag.color },
      },
    })

    return tag
  }

  /**
   * 删除标签，同时移除所有文件搜索索引中的该标签引用。
   */
  async deleteTag(projectId: number, tagId: number, userId: number): Promise<void> {
    const tag = await FileTag.query().where('id', tagId).where('project_id', projectId).first()

    if (!tag) {
      throw new ResourceNotFoundException('标签不存在')
    }

    const tagName = tag.name

    // 从所有引用该标签的搜索条目中移除
    const entries = await FileSearchEntry.query()
      .where('project_id', projectId)
      .where('tags_text', 'like', `%${tagName}%`)
    for (const entry of entries) {
      if (entry.tagsText) {
        const tagNames = entry.tagsText.split(',').map((t) => t.trim())
        const updated = tagNames.filter((t) => t !== tagName)
        entry.tagsText = updated.length > 0 ? updated.join(', ') : null
        await entry.save()
      }
    }

    // 删除标签
    await tag.delete()

    // 审计：标签删除
    await this.audit.log({
      event: AuditEvent.FILE_TAG_DELETED,
      userId,
      organizationId: tag.organizationId,
      projectId,
      entityType: 'file_tag',
      entityId: tagId,
      metadata: { name: tagName },
    })
  }

  /**
   * 为文件分配标签。
   * 将标签名追加到 file_search_entries.tags_text 中。
   */
  async assignTags(
    projectId: number,
    fileType: string,
    fileId: number,
    tagIds: number[],
    _userId: number,
  ): Promise<void> {
    if (tagIds.length === 0) return

    // 查找所有标签并校验归属
    const tags = await FileTag.query().whereIn('id', tagIds).where('project_id', projectId)

    if (tags.length !== tagIds.length) {
      throw new ValidationException('部分标签不存在或不属于该项目')
    }

    // 查找或创建文件搜索条目
    let entry = await FileSearchEntry.query()
      .where('file_type', fileType)
      .where('file_id', fileId)
      .where('project_id', projectId)
      .first()

    if (!entry) {
      // 搜索条目尚不存在，跳过（仅标签分配无需自动创建完整索引）
      return
    }

    // 合并现有标签与新增标签，去重
    const existingTags = entry.tagsText ? entry.tagsText.split(',').map((t) => t.trim()) : []
    const newTagNames = tags.map((t) => t.name)
    const merged = [...new Set([...existingTags, ...newTagNames])]
    entry.tagsText = merged.join(', ')
    await entry.save()
  }

  /**
   * 从文件移除标签。
   */
  async removeTags(
    projectId: number,
    fileType: string,
    fileId: number,
    tagIds: number[],
  ): Promise<void> {
    if (tagIds.length === 0) return

    // 查找标签名
    const tags = await FileTag.query().whereIn('id', tagIds).where('project_id', projectId)

    if (tags.length === 0) return

    const removeNames = new Set(tags.map((t) => t.name))

    // 更新文件搜索条目
    const entry = await FileSearchEntry.query()
      .where('file_type', fileType)
      .where('file_id', fileId)
      .where('project_id', projectId)
      .first()

    if (!entry || !entry.tagsText) return

    const tagNames = entry.tagsText.split(',').map((t) => t.trim())
    const updated = tagNames.filter((t) => !removeNames.has(t))
    entry.tagsText = updated.length > 0 ? updated.join(', ') : null
    await entry.save()
  }

  /**
   * 获取文件的标签列表。
   */
  async getFileTags(fileType: string, fileId: number, projectId: number): Promise<FileTag[]> {
    const entry = await FileSearchEntry.query()
      .where('file_type', fileType)
      .where('file_id', fileId)
      .where('project_id', projectId)
      .first()

    if (!entry || !entry.tagsText) return []

    const tagNames = entry.tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (tagNames.length === 0) return []

    const tags = await FileTag.query().where('project_id', projectId).whereIn('name', tagNames)

    return tags
  }

  /**
   * 根据标签查找文件（返回匹配的文件列表，通过搜索索引查询）。
   */
  async listFilesByTag(projectId: number, tagId: number, page: number = 1, perPage: number = 50) {
    // 获取标签名
    const tag = await FileTag.query().where('id', tagId).where('project_id', projectId).first()

    if (!tag) {
      throw new ResourceNotFoundException('标签不存在')
    }

    const query = FileSearchEntry.query()
      .where('project_id', projectId)
      .where('tags_text', 'like', `%${tag.name}%`)
      .orderBy('updated_at', 'desc')

    const result = await query.paginate(page, perPage)
    const meta = result.getMeta()
    return {
      data: result.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }
}
