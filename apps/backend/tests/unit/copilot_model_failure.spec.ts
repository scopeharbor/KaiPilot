import { test } from '@japa/runner'
import {
  classifyModelFailure,
  CopilotModelCallError,
  describeCopilotAnswerFailure,
} from '#services/copilot_turn/copilot_model_failure'

test.group('Copilot 模型调用失败分类', () => {
  test('按上游状态码与错误信息细分', ({ assert }) => {
    const kindOf = (input: Parameters<typeof classifyModelFailure>[0]) =>
      classifyModelFailure(input).kind
    assert.equal(kindOf({ message: '429 Rate limit reached' }), 'rate-limit')
    assert.equal(kindOf({ message: '401 Incorrect API key provided' }), 'model-auth')
    assert.equal(kindOf({ message: '404 The model `gpt-x` does not exist' }), 'model-not-found')
    assert.equal(kindOf({ message: '502 Bad gateway' }), 'model-error')
    assert.equal(kindOf({ message: 'Request timed out.' }), 'model-timeout')
    assert.equal(kindOf({ errorKind: 'token_limit_exceeded', message: '' }), 'model-output-limit')
    assert.equal(kindOf({ message: '400 Invalid parameter' }), 'model-rejected')
    assert.equal(kindOf({ errorKind: 'sse_interrupted', message: '' }), 'model-interrupted')
    assert.equal(kindOf({ message: 'socket hang up' }), 'model-interrupted')
    assert.equal(kindOf({ errorKind: 'repetition_loop', message: '' }), 'model-loop')
    assert.equal(kindOf({ message: 'something odd' }), 'model-error')
  })

  test('低敏原因只含分类与状态码，不含供应商原文', ({ assert }) => {
    const error = classifyModelFailure({ message: '401 Incorrect API key provided: sk-abc***' })
    assert.equal(error.reason, '模型供应商拒绝了密钥或权限（HTTP 401）')
    assert.notInclude(error.reason, 'sk-abc')
  })

  test('回答流程异常 → turn-error 分类', ({ assert }) => {
    assert.deepEqual(
      describeCopilotAnswerFailure(
        new CopilotModelCallError('model-timeout', '模型供应商响应超时'),
      ),
      { errorKind: 'model-timeout', degradedReason: '模型供应商响应超时' },
    )
    const limited = Object.assign(new Error('limited'), { rateLimitDecision: { allowed: false } })
    assert.equal(describeCopilotAnswerFailure(limited).errorKind, 'rate-limit')
    // 认不出来的内部异常不冒充供应商问题
    assert.equal(
      describeCopilotAnswerFailure(new Error('Cannot read properties of undefined')).errorKind,
      'retryable-service',
    )
    assert.equal(
      describeCopilotAnswerFailure(Object.assign(new Error('boom'), { status: 503 })).errorKind,
      'model-error',
    )
  })
})
