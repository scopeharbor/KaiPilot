/**
 * v3-ai-request-tracing —— AI 请求追踪服务入口。
 *
 * 提供 trace 生成、span 记录、上下文传播与孤儿标记。
 * 追踪失败可降级：recordSpan 永不抛错。
 */
export { TraceContextService } from './trace_context.js'
export { TraceQueryService } from './trace_query_service.js'
