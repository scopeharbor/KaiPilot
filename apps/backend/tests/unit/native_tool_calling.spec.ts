// 原生工具调用三种格式（OpenAI Chat / OpenAI Responses / Claude tool use）的请求体与响应解析，
// 以及原生调用结果 → 统一动作的映射。
import { test } from '@japa/runner'
import {
  buildChatToolsPayload,
  buildResponsesToolsPayload,
  parseChatToolsResponse,
  parseResponsesToolsResponse,
} from '#services/ai_m0/openai_adapter'
import {
  buildAnthropicToolsPayload,
  parseAnthropicToolsResponse,
} from '#services/ai_m0/anthropic_compatible_adapter'
import { parseToolArguments, type ToolCallOptions } from '#services/ai_m0/gateway'
import {
  COLLEAGUE_PLANNER_TOOLS,
  nativeToolCallsToRawPlan,
  normalizePlannedActions,
} from '#services/ai_colleague/action_planner_service'

const tool = {
  name: 'set_task_status',
  description: '改任务状态',
  parameters: { type: 'object', properties: { taskId: { type: 'integer' } }, required: ['taskId'] },
}
const options = (api: ToolCallOptions['api']): ToolCallOptions => ({
  api,
  systemPrompt: '系统',
  userPrompt: '用户',
  tools: [tool],
  temperature: 0,
})

test.group('OpenAI Chat Completions 原生工具', () => {
  test('请求体：tools[].function 嵌套 + tool_choice auto', ({ assert }) => {
    const payload = buildChatToolsPayload('deepseek-chat', options('openai_chat'), 2048)
    assert.deepEqual(payload.tools, [
      {
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      },
    ])
    assert.equal(payload.tool_choice, 'auto')
    assert.equal(payload.temperature, 0)
    assert.equal(payload.max_tokens, 2048)
    assert.deepEqual(payload.messages, [
      { role: 'system', content: '系统' },
      { role: 'user', content: '用户' },
    ])
  })

  test('推理模型：不发 temperature，改用 max_completion_tokens', ({ assert }) => {
    const payload = buildChatToolsPayload('gpt-5.2', options('openai_chat'), 2048)
    assert.notProperty(payload, 'temperature')
    assert.equal(payload.max_completion_tokens, 2048)
  })

  test('响应：message.tool_calls[].function.{name, arguments}', ({ assert }) => {
    const result = parseChatToolsResponse({
      id: 'chatcmpl-1',
      model: 'deepseek-chat',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: '好的',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'set_task_status',
                  arguments: '{"taskId":7,"status":"completed"}',
                },
              },
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'open_page', arguments: '坏JSON' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
    assert.equal(result.text, '好的')
    assert.deepEqual(result.toolCalls[0], {
      id: 'call_1',
      name: 'set_task_status',
      arguments: { taskId: 7, status: 'completed' },
    })
    assert.isNull(result.toolCalls[1]!.arguments)
    assert.deepEqual(result.usage?.finishReasons, ['tool_calls'])
    assert.equal(result.usage?.inputTokens, 10)
  })
})

test.group('OpenAI Responses API 原生工具', () => {
  test('请求体：扁平 tools[] + instructions/input + max_output_tokens', ({ assert }) => {
    const payload = buildResponsesToolsPayload('gpt-4.1', options('openai_responses'), 1024)
    assert.deepEqual(payload.tools, [
      {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false,
      },
    ])
    assert.equal(payload.instructions, '系统')
    assert.equal(payload.input, '用户')
    assert.equal(payload.max_output_tokens, 1024)
    assert.equal(payload.tool_choice, 'auto')
  })

  test('响应：output[] 中 function_call 项（call_id / name / arguments）', ({ assert }) => {
    const result = parseResponsesToolsResponse({
      id: 'resp_1',
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_1' },
        { type: 'message', content: [{ type: 'output_text', text: '准备这样做' }] },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_a',
          name: 'open_page',
          arguments: '{"lens":"gantt"}',
        },
      ],
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
    })
    assert.equal(result.text, '准备这样做')
    assert.deepEqual(result.toolCalls, [
      { id: 'call_a', name: 'open_page', arguments: { lens: 'gantt' } },
    ])
    assert.deepEqual(result.usage?.finishReasons, ['completed'])
  })
})

test.group('Claude Messages 原生 tool use', () => {
  test('请求体：tools[].input_schema + tool_choice auto + 顶层 system', ({ assert }) => {
    const payload = buildAnthropicToolsPayload(
      'claude-opus-5-5',
      options('anthropic_messages'),
      4096,
    )
    assert.deepEqual(payload.tools, [
      { name: tool.name, description: tool.description, input_schema: tool.parameters },
    ])
    // 最新 Claude 模型不支持强制 any/tool，只用 auto
    assert.deepEqual(payload.tool_choice, { type: 'auto' })
    assert.equal(payload.system, '系统')
    assert.equal(payload.max_tokens, 4096)
  })

  test('响应：content[] 中 tool_use 块（id / name / input）', ({ assert }) => {
    const result = parseAnthropicToolsResponse({
      id: 'msg_1',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: '我会先改状态。' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'set_task_status',
          input: { taskId: 7, status: 'completed' },
        },
      ],
      usage: { input_tokens: 30, output_tokens: 12 },
    })
    assert.equal(result.text, '我会先改状态。')
    assert.deepEqual(result.toolCalls, [
      { id: 'toolu_1', name: 'set_task_status', arguments: { taskId: 7, status: 'completed' } },
    ])
    assert.equal(result.usage?.totalTokens, 42)
    assert.deepEqual(result.usage?.finishReasons, ['tool_use'])
  })
})

test.group('原生调用 → 统一动作（与 Prompt + JSON 共用校验）', () => {
  const tasks = [
    {
      id: 7,
      name: '登录页',
      status: 'not_started',
      startDate: '2026-10-08',
      endDate: '2026-10-10',
      projectId: 42,
      code: 'PROJ-42#7',
    },
  ]

  test('工具调用按顺序映射成动作，追问、未知工具、坏参数分别处理', ({ assert }) => {
    const { raw, unknownCalls } = nativeToolCallsToRawPlan({
      text: '好的',
      toolCalls: [
        { name: 'set_task_status', arguments: { taskId: 7, status: 'completed' } },
        { name: 'open_page', arguments: { lens: 'gantt' } },
        { name: 'ask_clarification', arguments: { question: '要延到哪天？' } },
        { name: 'drop_table', arguments: {} },
        { name: 'show_task_detail', arguments: null },
      ],
    })
    assert.deepEqual(unknownCalls, ['drop_table', 'show_task_detail'])
    const plan = normalizePlannedActions(raw, { projectId: 42, tasks })
    assert.deepEqual(
      plan.actions.map((a) => a.toolName),
      ['update_task_status', 'navigate_to_space'],
    )
    assert.equal(plan.clarification, '要延到哪天？')
    assert.equal(plan.reply, '好的')
    assert.isTrue(plan.isAction)
  })

  test('没有工具调用 = 普通提问（交回问答）', ({ assert }) => {
    const { raw } = nativeToolCallsToRawPlan({ text: '项目进度是 35%。', toolCalls: [] })
    assert.isFalse(normalizePlannedActions(raw, { projectId: 42, tasks }).isAction)
  })

  test('工具定义名称合法（三家 API 的命名规则交集）且都是 object schema', ({ assert }) => {
    for (const definition of COLLEAGUE_PLANNER_TOOLS) {
      assert.match(definition.name, /^[a-zA-Z0-9_-]{1,64}$/)
      assert.equal(definition.parameters.type, 'object')
    }
  })

  test('parseToolArguments', ({ assert }) => {
    assert.deepEqual(parseToolArguments('{"a":1}'), { a: 1 })
    assert.deepEqual(parseToolArguments({ a: 1 }), { a: 1 })
    assert.deepEqual(parseToolArguments(''), {})
    assert.isNull(parseToolArguments('[1]'))
    assert.isNull(parseToolArguments('{bad'))
  })
})
