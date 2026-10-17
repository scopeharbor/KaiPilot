import type {
  OcrEntityLinkTargetSuggestion,
  OcrEntityLinkTargetSummary,
  OcrTargetKind,
  OcrMatchReason,
} from '@aiproj/types'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import Milestone from '#models/milestone'
import Risk from '#models/risk'
import ProjectMember from '#models/project_member'
import User from '#models/user'
import Project from '#models/project'
import Attachment from '#models/attachment'
import logger from '@adonisjs/core/services/logger'

// ─── Context 类型（避免引入完整 HttpContext） ──────────────────────────────

export interface EntityLinkContext {
  organizationId: number
  projectId: number
  actorId: number
}

// ─── Target Adapter 接口 ──────────────────────────────────────────────────

/**
 * OCR 实体链接目标适配器接口（v3-ocr-entity-linking §3.3）。
 *
 * 每个具体的 P0 适配器实现此接口，负责将规范化标签匹配到项目实体。
 */
export interface OcrEntityLinkTargetAdapter {
  /** 按规范化标签模糊匹配目标实体 */
  match(normalizedLabel: string, ctx: EntityLinkContext): Promise<OcrEntityLinkTargetSuggestion[]>

  /** 按 targetKind + targetId 解析目标实体摘要 */
  resolve(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSummary | null>

  /** 检查当前用户对目标实体的访问权限 */
  checkPermission(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<boolean>

  /** 获取目标实体的陈旧签名（用于检测目标是否已变更） */
  getStaleSignature(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<string>
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

function normalizeForMatch(input: string): string {
  return input.replace(/[\s\-_]+/g, '').toLowerCase()
}

function buildSuggestion(
  targetKind: OcrTargetKind,
  targetId: number,
  title: string,
  matchReason: OcrMatchReason,
  confidence: number,
  navigationRef: string | null = null,
): OcrEntityLinkTargetSuggestion {
  return {
    targetKind,
    targetId,
    title,
    matchReason,
    confidence,
    navigationRef,
    redacted: false,
  }
}

// ─── P0 具体适配器 ───────────────────────────────────────────────────────

/**
 * 任务目标适配器。
 * 按任务标题/编号匹配 Task 模型。
 */
export class TaskTargetAdapter implements OcrEntityLinkTargetAdapter {
  async match(
    normalizedLabel: string,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSuggestion[]> {
    const norm = normalizeForMatch(normalizedLabel)
    const rows = await Task.query()
      .where('project_id', ctx.projectId)
      .select('id', 'name')
      .limit(20)

    const results: OcrEntityLinkTargetSuggestion[] = []
    for (const row of rows) {
      const rowNorm = normalizeForMatch(row.name)
      if (rowNorm === norm) {
        results.push(buildSuggestion('task', row.id, row.name, 'exact_label', 1.0))
      } else if (rowNorm.includes(norm) || norm.includes(rowNorm)) {
        results.push(buildSuggestion('task', row.id, row.name, 'normalized_label', 0.85))
      } else if (row.name.includes(normalizedLabel)) {
        results.push(buildSuggestion('task', row.id, row.name, 'fuzzy', 0.6))
      }
    }
    return results.slice(0, 5)
  }

  async resolve(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSummary | null> {
    const row = await Task.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('id', 'name', 'status')
      .first()
    if (!row) return null
    return {
      targetKind,
      targetId: row.id,
      title: row.name,
      isAccessible: true,
      isActive: row.status !== 'archived',
      matchableLabel: row.name,
    }
  }

  async checkPermission(
    _targetKind: OcrTargetKind,
    _targetId: number,
    _ctx: EntityLinkContext,
  ): Promise<boolean> {
    // 项目成员默认可读任务；精细权限由上层 policy 控制
    return true
  }

  async getStaleSignature(
    _targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<string> {
    const row = await Task.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('updated_at')
      .first()
    return row ? String(row.updatedAt?.toMillis?.() ?? '0') : '0'
  }
}

/**
 * WBS 节点目标适配器。
 * 按 WBS 代码模式匹配 WbsNode 模型。
 */
export class WbsNodeTargetAdapter implements OcrEntityLinkTargetAdapter {
  async match(
    normalizedLabel: string,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSuggestion[]> {
    const rows = await WbsNode.query()
      .where('project_id', ctx.projectId)
      .select('id', 'name', 'code')
      .limit(50)

    const norm = normalizeForMatch(normalizedLabel)
    const results: OcrEntityLinkTargetSuggestion[] = []
    for (const row of rows) {
      // WBS 代码精确匹配
      if (row.code && normalizeForMatch(row.code) === norm) {
        results.push(buildSuggestion('wbs_node', row.id, row.name ?? row.code, 'exact_label', 1.0))
      } else if (row.code && normalizeForMatch(row.code).includes(norm)) {
        results.push(
          buildSuggestion('wbs_node', row.id, row.name ?? row.code, 'normalized_label', 0.9),
        )
      } else if (row.name && normalizeForMatch(row.name) === norm) {
        results.push(buildSuggestion('wbs_node', row.id, row.name, 'exact_label', 0.95))
      } else if (
        row.name &&
        (normalizeForMatch(row.name).includes(norm) || norm.includes(normalizeForMatch(row.name)))
      ) {
        results.push(buildSuggestion('wbs_node', row.id, row.name, 'fuzzy', 0.7))
      }
    }
    return results.slice(0, 5)
  }

  async resolve(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSummary | null> {
    const row = await WbsNode.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('id', 'name', 'code')
      .first()
    if (!row) return null
    const title = row.name ?? row.code ?? `WBS-${targetId}`
    return {
      targetKind,
      targetId: row.id,
      title,
      isAccessible: true,
      isActive: true,
      matchableLabel: row.code ?? title,
    }
  }

  async checkPermission(
    _targetKind: OcrTargetKind,
    _targetId: number,
    _ctx: EntityLinkContext,
  ): Promise<boolean> {
    return true
  }

  async getStaleSignature(
    _targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<string> {
    const row = await WbsNode.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('updated_at')
      .first()
    return row ? String(row.updatedAt?.toMillis?.() ?? '0') : '0'
  }
}

/**
 * 里程碑目标适配器。
 * 按里程碑名称匹配 Milestone 模型。
 */
export class MilestoneTargetAdapter implements OcrEntityLinkTargetAdapter {
  async match(
    normalizedLabel: string,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSuggestion[]> {
    const rows = await Milestone.query()
      .where('project_id', ctx.projectId)
      .select('id', 'name')
      .limit(30)

    const norm = normalizeForMatch(normalizedLabel)
    const results: OcrEntityLinkTargetSuggestion[] = []
    for (const row of rows) {
      const rowNorm = normalizeForMatch(row.name)
      if (rowNorm === norm) {
        results.push(buildSuggestion('milestone', row.id, row.name, 'exact_label', 1.0))
      } else if (rowNorm.includes(norm) || norm.includes(rowNorm)) {
        results.push(buildSuggestion('milestone', row.id, row.name, 'normalized_label', 0.8))
      } else if (row.name.includes(normalizedLabel)) {
        results.push(buildSuggestion('milestone', row.id, row.name, 'fuzzy', 0.6))
      }
    }
    return results.slice(0, 5)
  }

  async resolve(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSummary | null> {
    const row = await Milestone.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('id', 'name', 'status')
      .first()
    if (!row) return null
    return {
      targetKind,
      targetId: row.id,
      title: row.name,
      isAccessible: true,
      isActive: row.status !== 'archived',
      matchableLabel: row.name,
    }
  }

  async checkPermission(
    _targetKind: OcrTargetKind,
    _targetId: number,
    _ctx: EntityLinkContext,
  ): Promise<boolean> {
    return true
  }

  async getStaleSignature(
    _targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<string> {
    const row = await Milestone.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('updated_at')
      .first()
    return row ? String(row.updatedAt?.toMillis?.() ?? '0') : '0'
  }
}

/**
 * 风险目标适配器。
 * 按风险标题/代码匹配 Risk 模型。
 */
export class RiskTargetAdapter implements OcrEntityLinkTargetAdapter {
  async match(
    normalizedLabel: string,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSuggestion[]> {
    const rows = await Risk.query()
      .where('project_id', ctx.projectId)
      .select('id', 'title', 'risk_code')
      .limit(30)

    const norm = normalizeForMatch(normalizedLabel)
    const results: OcrEntityLinkTargetSuggestion[] = []
    for (const row of rows) {
      // 风险代码精确匹配
      if (row.riskCode && normalizeForMatch(row.riskCode) === norm) {
        results.push(buildSuggestion('risk', row.id, row.title, 'exact_label', 1.0))
      } else {
        const rowNorm = normalizeForMatch(row.title)
        if (rowNorm === norm) {
          results.push(buildSuggestion('risk', row.id, row.title, 'exact_label', 0.95))
        } else if (rowNorm.includes(norm) || norm.includes(rowNorm)) {
          results.push(buildSuggestion('risk', row.id, row.title, 'normalized_label', 0.8))
        } else if (row.title.includes(normalizedLabel)) {
          results.push(buildSuggestion('risk', row.id, row.title, 'fuzzy', 0.6))
        }
      }
    }
    return results.slice(0, 5)
  }

  async resolve(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSummary | null> {
    const row = await Risk.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('id', 'title', 'status')
      .first()
    if (!row) return null
    return {
      targetKind,
      targetId: row.id,
      title: row.title,
      isAccessible: true,
      isActive: row.status !== 'closed',
      matchableLabel: row.title,
    }
  }

  async checkPermission(
    _targetKind: OcrTargetKind,
    _targetId: number,
    _ctx: EntityLinkContext,
  ): Promise<boolean> {
    return true
  }

  async getStaleSignature(
    _targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<string> {
    const row = await Risk.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('updated_at')
      .first()
    return row ? String(row.updatedAt?.toMillis?.() ?? '0') : '0'
  }
}

/**
 * 项目成员目标适配器。
 * 按用户名匹配 ProjectMember + User 模型。
 */
export class ProjectMemberTargetAdapter implements OcrEntityLinkTargetAdapter {
  async match(
    normalizedLabel: string,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSuggestion[]> {
    const members = await ProjectMember.query()
      .where('project_id', ctx.projectId)
      .select('user_id')
      .limit(50)

    if (members.length === 0) return []

    // schema 基类把外键声明为 bigint | number，whereIn 需要窄化为 number
    const userIds = members.map((m) => Number(m.userId))
    const norm = normalizeForMatch(normalizedLabel)
    const users = await User.query()
      .whereIn('id', userIds)
      .select('id', 'full_name', 'email')
      .limit(50)

    const results: OcrEntityLinkTargetSuggestion[] = []
    for (const user of users) {
      const userName = user.fullName ?? user.email ?? ''
      const userNorm = normalizeForMatch(userName)
      if (userNorm === norm) {
        results.push(buildSuggestion('project_member', user.id, userName, 'exact_label', 1.0))
      } else if (userNorm.includes(norm) || norm.includes(userNorm)) {
        results.push(buildSuggestion('project_member', user.id, userName, 'normalized_label', 0.8))
      } else if (userName.includes(normalizedLabel)) {
        results.push(buildSuggestion('project_member', user.id, userName, 'fuzzy', 0.6))
      }
    }
    return results.slice(0, 5)
  }

  async resolve(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSummary | null> {
    // 验证该用户确实是项目成员
    const member = await ProjectMember.query()
      .where('project_id', ctx.projectId)
      .where('user_id', targetId)
      .first()

    if (!member) return null

    const user = await User.query().where('id', targetId).select('id', 'full_name', 'email').first()

    const title = user?.fullName ?? user?.email ?? `用户-${targetId}`
    return {
      targetKind,
      targetId,
      title,
      isAccessible: true,
      isActive: user?.isActive ?? false,
      matchableLabel: title,
    }
  }

  async checkPermission(
    _targetKind: OcrTargetKind,
    _targetId: number,
    _ctx: EntityLinkContext,
  ): Promise<boolean> {
    return true
  }

  async getStaleSignature(
    _targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<string> {
    const member = await ProjectMember.query()
      .where('project_id', ctx.projectId)
      .where('user_id', targetId)
      .select('updated_at')
      .first()
    return member ? String(member.updatedAt?.toMillis?.() ?? '0') : '0'
  }
}

/**
 * 项目目标适配器。
 * 按项目名称匹配 Project 模型。
 */
export class ProjectTargetAdapter implements OcrEntityLinkTargetAdapter {
  async match(
    normalizedLabel: string,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSuggestion[]> {
    const row = await Project.query()
      .where('id', ctx.projectId)
      .where('organization_id', ctx.organizationId)
      .select('id', 'name')
      .first()

    if (!row) return []

    const norm = normalizeForMatch(normalizedLabel)
    const rowNorm = normalizeForMatch(row.name)
    if (rowNorm === norm) {
      return [buildSuggestion('project', row.id, row.name, 'exact_label', 1.0)]
    } else if (rowNorm.includes(norm) || norm.includes(rowNorm)) {
      return [buildSuggestion('project', row.id, row.name, 'normalized_label', 0.85)]
    } else if (row.name.includes(normalizedLabel)) {
      return [buildSuggestion('project', row.id, row.name, 'fuzzy', 0.6)]
    }
    return []
  }

  async resolve(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSummary | null> {
    const row = await Project.query()
      .where('id', targetId)
      .where('organization_id', ctx.organizationId)
      .select('id', 'name', 'status')
      .first()
    if (!row) return null
    return {
      targetKind,
      targetId: row.id,
      title: row.name,
      isAccessible: true,
      isActive: row.status !== 'archived',
      matchableLabel: row.name,
    }
  }

  async checkPermission(
    _targetKind: OcrTargetKind,
    _targetId: number,
    _ctx: EntityLinkContext,
  ): Promise<boolean> {
    return true
  }

  async getStaleSignature(
    _targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<string> {
    const row = await Project.query()
      .where('id', targetId)
      .where('organization_id', ctx.organizationId)
      .select('updated_at')
      .first()
    return row ? String(row.updatedAt?.toMillis?.() ?? '0') : '0'
  }
}

/**
 * 文件目标适配器。
 * 按附件名称匹配 Attachment 模型。
 */
export class FileTargetAdapter implements OcrEntityLinkTargetAdapter {
  async match(
    normalizedLabel: string,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSuggestion[]> {
    const rows = await Attachment.query()
      .where('project_id', ctx.projectId)
      .whereNull('deleted_at')
      .select('id', 'file_name')
      .limit(30)

    const norm = normalizeForMatch(normalizedLabel)
    const results: OcrEntityLinkTargetSuggestion[] = []
    for (const row of rows) {
      const name = row.fileName ?? ''
      const nameNorm = normalizeForMatch(name)
      if (nameNorm === norm) {
        results.push(buildSuggestion('file', row.id, name, 'exact_label', 1.0))
      } else if (nameNorm.includes(norm) || norm.includes(nameNorm)) {
        results.push(buildSuggestion('file', row.id, name, 'normalized_label', 0.8))
      } else if (name.includes(normalizedLabel)) {
        results.push(buildSuggestion('file', row.id, name, 'fuzzy', 0.6))
      }
    }
    return results.slice(0, 5)
  }

  async resolve(
    targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<OcrEntityLinkTargetSummary | null> {
    const row = await Attachment.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .whereNull('deleted_at')
      .select('id', 'file_name')
      .first()
    if (!row) return null
    const title = row.fileName ?? `附件-${targetId}`
    return {
      targetKind,
      targetId: row.id,
      title,
      isAccessible: true,
      isActive: true,
      matchableLabel: title,
    }
  }

  async checkPermission(
    _targetKind: OcrTargetKind,
    _targetId: number,
    _ctx: EntityLinkContext,
  ): Promise<boolean> {
    return true
  }

  async getStaleSignature(
    _targetKind: OcrTargetKind,
    targetId: number,
    ctx: EntityLinkContext,
  ): Promise<string> {
    const row = await Attachment.query()
      .where('id', targetId)
      .where('project_id', ctx.projectId)
      .select('updated_at')
      .first()
    return row ? String(row.updatedAt?.toMillis?.() ?? '0') : '0'
  }
}

// ─── Target Adapter Registry ──────────────────────────────────────────────

/**
 * 目标适配器注册表。
 * 将 OcrTargetKind 映射到具体的适配器实例。
 * 创建运行时可传入 registry 实例，未传入则使用默认单例。
 */
export class TargetAdapterRegistry {
  private readonly adapters: Map<OcrTargetKind, OcrEntityLinkTargetAdapter>

  constructor(custom?: Partial<Record<OcrTargetKind, OcrEntityLinkTargetAdapter>>) {
    const defaults: Record<OcrTargetKind, OcrEntityLinkTargetAdapter> = {
      task: new TaskTargetAdapter(),
      wbs_node: new WbsNodeTargetAdapter(),
      milestone: new MilestoneTargetAdapter(),
      risk: new RiskTargetAdapter(),
      project_member: new ProjectMemberTargetAdapter(),
      project: new ProjectTargetAdapter(),
      file: new FileTargetAdapter(),
      // attachment 复用 file 适配器（Attachment 模型）
      attachment: new FileTargetAdapter(),
    }

    this.adapters = new Map()
    for (const [kind, adapter] of Object.entries(defaults)) {
      this.adapters.set(kind as OcrTargetKind, custom?.[kind as OcrTargetKind] ?? adapter)
    }
  }

  get(kind: OcrTargetKind): OcrEntityLinkTargetAdapter | undefined {
    return this.adapters.get(kind)
  }

  /** 获取所有已注册的 target kind */
  registeredKinds(): OcrTargetKind[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * 对所有已注册的 target kind 执行匹配。
   * 返回按置信度降序排列的结果。
   */
  async matchAll(
    normalizedLabel: string,
    targetKinds: OcrTargetKind[],
    ctx: EntityLinkContext,
  ): Promise<Map<OcrTargetKind, OcrEntityLinkTargetSuggestion[]>> {
    const result = new Map<OcrTargetKind, OcrEntityLinkTargetSuggestion[]>()
    await Promise.all(
      targetKinds.map(async (kind) => {
        const adapter = this.adapters.get(kind)
        if (!adapter) return
        try {
          const suggestions = await adapter.match(normalizedLabel, ctx)
          result.set(kind, suggestions)
        } catch (err) {
          logger.warn({ kind, normalizedLabel, err }, '[EntityLink] target adapter match 失败')
        }
      }),
    )
    return result
  }
}

/** 默认单例注册表 */
export const defaultTargetRegistry = new TargetAdapterRegistry()
