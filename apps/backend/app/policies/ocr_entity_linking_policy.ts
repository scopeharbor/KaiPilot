import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'

/**
 * OCR 实体链接 Policy（v3-ocr-entity-linking §3.7）。
 *
 * 权限模型：
 * - view：读取运行/候选/已确认链接（项目成员 + ocr_entity_link:view 或 ocr:review）
 * - manage：创建运行/刷新（项目成员 + ocr_entity_link:manage 或 file:manage）
 * - confirm：预览/确认/取代/拒绝 advisory link（项目成员 + ocr_entity_link:confirm 或 ocr:confirm）
 * - explain：可选 AI 解释（项目成员 + ocr_entity_link:explain 或 ai:trigger）
 *
 * read-only 降级：无 view 权限返回 null；越权操作抛出 PermissionDeniedException。
 * 跨组织/跨项目越权操作由 Controller 层二次检查。
 */
export default class OcrEntityLinkingPolicy {
  #ctx: HttpContext

  constructor(ctx: HttpContext) {
    this.#ctx = ctx
  }

  private get member(): { role: string } | null {
    return (this.#ctx as any).projectMember ?? null
  }

  private hasPermission(perm: string): boolean {
    return this.#ctx.rbac?.hasPermission(perm) ?? false
  }

  private isProjectMember(): boolean {
    return this.member !== null
  }

  /** 查看运行/候选/已确认链接：需要 ocr_entity_link:view 或 ocr:review */
  view(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_entity_link:view') || this.hasPermission('ocr:review')
  }

  /** 创建运行：需要 ocr_entity_link:manage 或 file:manage */
  manage(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_entity_link:manage') || this.hasPermission('file:manage')
  }

  /** 确认 advisory link：需要 ocr_entity_link:confirm 或 ocr:confirm */
  confirm(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_entity_link:confirm') || this.hasPermission('ocr:confirm')
  }

  /** 可选 AI 解释：需要 ocr_entity_link:explain 或 ai:trigger */
  explain(): boolean {
    if (!this.isProjectMember()) return false
    return this.hasPermission('ocr_entity_link:explain') || this.hasPermission('ai:trigger')
  }

  /** 断言查看 */
  assertView(): void {
    if (!this.view()) {
      throw new PermissionDeniedException('缺少 OCR 实体链接查看权限', {
        code: 'OCR_ENTITY_LINK_PERMISSION_DENIED',
      })
    }
  }

  /** 断言管理 */
  assertManage(): void {
    if (!this.manage()) {
      throw new PermissionDeniedException('缺少 OCR 实体链接管理权限', {
        code: 'OCR_ENTITY_LINK_PERMISSION_DENIED',
      })
    }
  }

  /** 断言确认 */
  assertConfirm(): void {
    if (!this.confirm()) {
      throw new PermissionDeniedException('缺少 OCR 实体链接确认权限', {
        code: 'OCR_ENTITY_LINK_PERMISSION_DENIED',
      })
    }
  }

  /** 断言解释 */
  assertExplain(): void {
    if (!this.explain()) {
      throw new PermissionDeniedException('缺少 OCR 实体链接 AI 解释权限', {
        code: 'OCR_ENTITY_LINK_PERMISSION_DENIED',
      })
    }
  }

  /** 检查越权：如果用户是项目成员但无任何 view 权限，返回 false */
  resolveScope(): 'full' | 'readonly' | null {
    if (!this.isProjectMember()) return null
    if (this.manage() || this.confirm()) return 'full'
    if (this.view()) return 'readonly'
    return null
  }
}
