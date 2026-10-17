# Streaming WebSocket Service 使用文档

## 事件名称

### 客户端 → 服务端（Control Messages）

- `subscribe:stream` - 订阅长任务 stream
- `unsubscribe:stream` - 取消订阅
- `resume:stream` - 从游标恢复
- `ack:stream` - 确认收到事件
- `client:heartbeat` - 客户端心跳
- `status:stream` - 查询流状态
- `diagnostics:stream` - 查询服务诊断

### 服务端 → 客户端

- `stream:event` - 进度事件（StreamingProgressEnvelope）
- `stream:log` - 实时日志事件
- `stream:subscribed` - 订阅确认
- `stream:status` - 状态响应
- `stream:reset-required` - 需要重置（走 REST/SSE 回退）
- `stream:diagnostics` - 诊断响应

## 允许的客户端控制

只允许读侧控制：subscribe, unsubscribe, resume, ack, heartbeat, status 查询。
禁止 write:, apply:, sync:, external:, deploy:, publish:, package-manager:, repository: 前缀的任何消息。

## 回退路径

- WebSocket 不可用时自动降级到 REST/SSE
- STREAMING_WS_ENABLED=false 时 WebSocket 推送关闭
- REALTIME_ENABLED=false 时 Socket.IO 完全关闭
- reset-required 时客户端必须走 REST/SSE/status snapshot

## 特性门禁

- STREAMING_WS_ENABLED: 默认 true，关闭后 WebSocket 推送不生效
- REALTIME_ENABLED: 默认 true，关闭后所有实时通道停用

## 低敏字段 Allowlist

### Progress Payload

phase, completedUnits, totalUnits, percent, messageCode, checkpointId, summary, resultId, errorCode, reasonCode, module, moduleStatus, stageId, attempt

### Realtime Log

streamId, stageId, phase, attempt, severity, messageCode, count, durationMs, safeRefs, hash, timestamp

### 禁止字段

prompt, rawOutput, token, secret, stackTrace, apiKey, password, credential, privateKey, authorization

## Domain Adapters

- ai-draft: 验证用户对 draft 的 project:view 权限
- compiler: 验证用户对 Compiler run 的 project:view 权限
- code-generation: 验证用户对 code generation bundle 的访问权限

## Room 命名

stream:{organizationId}:{domain}:{streamId}
客户端不提供原始 room 名。

## 架构概述

- 复用现有 AdonisJS + Socket.IO 单体
- in-process 模式，不需要独立进程/容器/Redis
- best-effort 广播，失败不影响 REST 写入
- 默认本机 pnpm dev 可运行
