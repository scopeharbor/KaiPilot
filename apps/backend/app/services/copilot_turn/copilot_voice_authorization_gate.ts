/**
 * v3-copilot-voice-input §3.6 — ASR 授权门服务。
 *
 * 职责：
 * - 检查组织级 ASR 授权开关状态
 * - 提供读写授权开关的方法（含 RBAC 校验）
 * - 未授权时短路：零 ASR provider 调用、零公网访问
 *
 * 设计决策（D2）：
 * - 授权门短路点在调用外部 ASR 之前
 * - 走完上传、校验、落决策后短路
 * - 未授权时返回明确的「未启用」原因，不静默当作未上传
 */

import type { CopilotVoiceRejectionReason } from '@aiproj/types'
import { COPILOT_VOICE_AUTHORIZATION_KEY } from '@aiproj/types'
import OrganizationSetting from '#models/organization_setting'
import RbacService from '#services/rbac_service'
import type User from '#models/user'
import logger from '@adonisjs/core/services/logger'

// ===========================================================================
// 授权状态
// ===========================================================================

export interface CopilotVoiceAuthorizationResult {
  /** 是否已授权。 */
  readonly authorized: boolean
  /** 拒绝原因（仅未授权时）。 */
  readonly rejectionReason?: CopilotVoiceRejectionReason
  /** 可读消息。 */
  readonly message: string
}

// ===========================================================================
// 服务
// ===========================================================================

export default class CopilotVoiceAuthorizationGate {
  readonly #rbac: RbacService

  constructor(rbac?: RbacService) {
    this.#rbac = rbac ?? new RbacService()
  }

  /**
   * 检查组织是否已授权 ASR。
   *
   * 短路逻辑：
   * - 未授权 → { authorized: false, rejectionReason: 'authorization_not_enabled' }
   * - 已授权 → { authorized: true }
   */
  async checkAuthorization(organizationId: number): Promise<CopilotVoiceAuthorizationResult> {
    try {
      const setting = await OrganizationSetting.query()
        .where('organization_id', organizationId)
        .where('key', COPILOT_VOICE_AUTHORIZATION_KEY)
        .first()

      if (!setting || setting.value !== 'true') {
        return {
          authorized: false,
          rejectionReason: 'authorization_not_enabled',
          message: '语音转写功能未启用，请联系组织管理员开启',
        }
      }

      return {
        authorized: true,
        message: '语音转写功能已启用',
      }
    } catch (err) {
      logger.error({ err, organizationId }, '检查 ASR 授权状态失败')
      // 查询失败 → 保守拒绝（不泄露错误细节）
      return {
        authorized: false,
        rejectionReason: 'authorization_not_enabled',
        message: '语音转写功能状态检查失败，请稍后重试',
      }
    }
  }

  /**
   * 设置组织级 ASR 授权开关。
   *
   * RBAC 校验：
   * - 需要 `ai:voice_recognition:manage` 权限
   * - 无权限时拒绝，不泄露更多信息
   */
  async setAuthorization(
    user: User,
    organizationId: number,
    enabled: boolean,
  ): Promise<{ ok: boolean; message: string }> {
    // RBAC 校验
    const permCheck = await this.#rbac.check(
      user,
      'ai:voice_recognition:manage' as never,
      organizationId,
    )
    if (!permCheck.allowed) {
      return {
        ok: false,
        message: '无权修改语音转写授权设置',
      }
    }

    try {
      const existing = await OrganizationSetting.query()
        .where('organization_id', organizationId)
        .where('key', COPILOT_VOICE_AUTHORIZATION_KEY)
        .first()

      if (existing) {
        existing.value = enabled ? 'true' : 'false'
        await existing.save()
      } else {
        await OrganizationSetting.create({
          organizationId,
          key: COPILOT_VOICE_AUTHORIZATION_KEY,
          value: enabled ? 'true' : 'false',
        })
      }

      return {
        ok: true,
        message: enabled ? '语音转写功能已启用' : '语音转写功能已关闭',
      }
    } catch (err) {
      logger.error({ err, organizationId, enabled }, '设置 ASR 授权开关失败')
      return {
        ok: false,
        message: '设置语音转写授权失败，请稍后重试',
      }
    }
  }
}
