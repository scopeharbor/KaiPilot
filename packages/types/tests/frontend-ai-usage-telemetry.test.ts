/**
 * v3-frontend-ai-usage-telemetry —— 契约测试：前端类别与意图目录枚举一致。
 */
import { describe, it, expect } from 'vitest'
import {
  FRONTEND_TELEMETRY_EVENT_KINDS,
  FRONTEND_TELEMETRY_FORBIDDEN_FIELDS,
  frontendTelemetryContainsForbiddenFields,
  frontendTelemetryContainsSensitiveSamples,
  isFrontendTelemetryEventCompliant,
  isValidFrontendTelemetryIntentClass,
} from '../src/frontend-ai-usage-telemetry'
import { COPILOT_INTENT_CLASSES } from '../src/copilot-shared-contracts'
import {
  FIXTURE_PANEL_OPEN,
  FIXTURE_PANEL_CLOSE_SUBMITTED,
  FIXTURE_SESSION_TURN,
  FIXTURE_FIRST_QUESTION_INTENT,
  FIXTURE_CHIP_CLICK,
  FIXTURE_ACTION_CLICK,
  FIXTURE_ACTION_REJECT,
  FIXTURE_COMPLETE_SESSION,
  FIXTURE_PANEL_CLOSE_ABANDONED,
  FIXTURE_ABANDONMENT,
  FIXTURE_ABANDONMENT_SESSION,
  FIXTURE_TELEMETRY_DISABLED_SESSION,
  FIXTURE_BATCH_REQUEST,
  FIXTURE_BATCH_RESPONSE_SUCCESS,
  FIXTURE_FORBIDDEN_USER_INPUT,
  FIXTURE_FORBIDDEN_TOKEN,
  FIXTURE_FORBIDDEN_SECRET,
  FIXTURE_AGGREGATION_RESULT,
} from '../src/frontend-ai-usage-telemetry-fixtures'

describe('frontend-ai-usage-telemetry', () => {
  describe('2.5 前端类别与意图目录枚举一致', () => {
    it('首问意图类别复用 CopilotIntentClass 枚举', () => {
      // 验证 COPILOT_INTENT_CLASSES 包含所有六类意图
      expect(COPILOT_INTENT_CLASSES).toEqual([
        'query',
        'analysis',
        'generation',
        'mutation',
        'instruction',
        'meta',
      ])
    })

    it('isValidFrontendTelemetryIntentClass 校验意图类别', () => {
      // 合法类别
      expect(isValidFrontendTelemetryIntentClass('query')).toBe(true)
      expect(isValidFrontendTelemetryIntentClass('analysis')).toBe(true)
      expect(isValidFrontendTelemetryIntentClass('generation')).toBe(true)
      expect(isValidFrontendTelemetryIntentClass('mutation')).toBe(true)
      expect(isValidFrontendTelemetryIntentClass('instruction')).toBe(true)
      expect(isValidFrontendTelemetryIntentClass('meta')).toBe(true)

      // 非法类别
      expect(isValidFrontendTelemetryIntentClass('invalid')).toBe(false)
      expect(isValidFrontendTelemetryIntentClass('')).toBe(false)
      expect(isValidFrontendTelemetryIntentClass('QUERY')).toBe(false)
    })
  })

  describe('事件种类定义', () => {
    it('包含八类事件', () => {
      expect(FRONTEND_TELEMETRY_EVENT_KINDS).toEqual([
        'panel_open',
        'panel_close',
        'session_turn',
        'first_question_intent',
        'abandonment',
        'chip_click',
        'action_click',
        'action_reject',
      ])
    })
  })

  describe('2.6 禁存约束', () => {
    it('禁存字段列表包含所有敏感字段', () => {
      expect(FRONTEND_TELEMETRY_FORBIDDEN_FIELDS).toContain('userInput')
      expect(FRONTEND_TELEMETRY_FORBIDDEN_FIELDS).toContain('entityIdentifier')
      expect(FRONTEND_TELEMETRY_FORBIDDEN_FIELDS).toContain('keystroke')
      expect(FRONTEND_TELEMETRY_FORBIDDEN_FIELDS).toContain('prompt')
      expect(FRONTEND_TELEMETRY_FORBIDDEN_FIELDS).toContain('modelOutput')
      expect(FRONTEND_TELEMETRY_FORBIDDEN_FIELDS).toContain('token')
      expect(FRONTEND_TELEMETRY_FORBIDDEN_FIELDS).toContain('secret')
    })

    it('containsForbiddenFields 检测禁存字段', () => {
      // 不含禁存字段
      expect(frontendTelemetryContainsForbiddenFields({ eventKind: 'panel_open' })).toBe(false)
      expect(frontendTelemetryContainsForbiddenFields({ turnCount: 1 })).toBe(false)

      // 含禁存字段
      expect(frontendTelemetryContainsForbiddenFields({ userInput: 'test' })).toBe(true)
      expect(frontendTelemetryContainsForbiddenFields({ entityIdentifier: '123' })).toBe(true)
      expect(frontendTelemetryContainsForbiddenFields({ keystroke: 'a' })).toBe(true)
      expect(frontendTelemetryContainsForbiddenFields({ prompt: 'test' })).toBe(true)
      expect(frontendTelemetryContainsForbiddenFields({ modelOutput: 'test' })).toBe(true)
      expect(frontendTelemetryContainsForbiddenFields({ token: 'sk-123' })).toBe(true)
      expect(frontendTelemetryContainsForbiddenFields({ secret: 'password' })).toBe(true)
    })
  })

  describe('2.7 敏感样本检测', () => {
    it('containsSensitiveSamples 检测敏感样本', () => {
      // 不含敏感样本
      expect(frontendTelemetryContainsSensitiveSamples({ eventKind: 'panel_open' })).toBe(false)
      expect(frontendTelemetryContainsSensitiveSamples({ turnCount: 1 })).toBe(false)

      // 含敏感样本
      expect(frontendTelemetryContainsSensitiveSamples({ eventKind: '用户输入的文本内容' })).toBe(
        true,
      )
      expect(frontendTelemetryContainsSensitiveSamples({ token: 'sk-1234567890abcdef' })).toBe(true)
    })
  })

  describe('合规性校验', () => {
    it('isFrontendTelemetryEventCompliant 校验事件合规性', () => {
      // 合规事件
      expect(isFrontendTelemetryEventCompliant({ eventKind: 'panel_open' })).toBe(true)
      expect(isFrontendTelemetryEventCompliant({ turnCount: 1 })).toBe(true)

      // 不合规事件（含禁存字段）
      expect(isFrontendTelemetryEventCompliant({ userInput: 'test' })).toBe(false)
      expect(isFrontendTelemetryEventCompliant({ token: 'sk-123' })).toBe(false)
    })
  })

  describe('2.8 fixtures', () => {
    it('完整会话 fixtures 包含所有事件类型', () => {
      expect(FIXTURE_COMPLETE_SESSION).toHaveLength(6)
      expect(FIXTURE_COMPLETE_SESSION[0].eventKind).toBe('panel_open')
      expect(FIXTURE_COMPLETE_SESSION[1].eventKind).toBe('session_turn')
      expect(FIXTURE_COMPLETE_SESSION[2].eventKind).toBe('first_question_intent')
      expect(FIXTURE_COMPLETE_SESSION[3].eventKind).toBe('chip_click')
      expect(FIXTURE_COMPLETE_SESSION[4].eventKind).toBe('action_click')
      expect(FIXTURE_COMPLETE_SESSION[5].eventKind).toBe('panel_close')
    })

    it('放弃 fixtures 包含放弃事件', () => {
      expect(FIXTURE_ABANDONMENT_SESSION).toHaveLength(3)
      expect(FIXTURE_ABANDONMENT_SESSION[0].eventKind).toBe('panel_open')
      expect(FIXTURE_ABANDONMENT_SESSION[1].eventKind).toBe('panel_close')
      expect(FIXTURE_ABANDONMENT_SESSION[2].eventKind).toBe('abandonment')
      expect((FIXTURE_ABANDONMENT_SESSION[1] as { hasSubmitted: boolean }).hasSubmitted).toBe(false)
    })

    it('埋点关闭 fixtures 事件不应发送', () => {
      expect(FIXTURE_TELEMETRY_DISABLED_SESSION).toHaveLength(3)
    })

    it('批量发送 fixtures 格式正确', () => {
      expect(FIXTURE_BATCH_REQUEST.events).toHaveLength(6)
      expect(FIXTURE_BATCH_RESPONSE_SUCCESS.received).toBe(6)
    })

    it('禁存字段 fixtures 包含敏感数据', () => {
      expect(frontendTelemetryContainsForbiddenFields(FIXTURE_FORBIDDEN_USER_INPUT)).toBe(true)
      expect(frontendTelemetryContainsForbiddenFields(FIXTURE_FORBIDDEN_TOKEN)).toBe(true)
      expect(frontendTelemetryContainsForbiddenFields(FIXTURE_FORBIDDEN_SECRET)).toBe(true)
    })

    it('聚合结果 fixtures 包含五个核心指标', () => {
      expect(FIXTURE_AGGREGATION_RESULT.openRate).toBe(0.8)
      expect(FIXTURE_AGGREGATION_RESULT.sessionLength).toBe(3.5)
      expect(FIXTURE_AGGREGATION_RESULT.firstQuestionDistribution).toBeDefined()
      expect(FIXTURE_AGGREGATION_RESULT.abandonmentRate).toBe(0.2)
      expect(FIXTURE_AGGREGATION_RESULT.chipClickDistribution).toBeDefined()
    })
  })
})
