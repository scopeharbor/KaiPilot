# Proposal: v3-clean-fixture（干净 change 夹具）

## 背景与证据（source priority §4）

- V3 范围以 docs/v2-v3/planning/v3-development-baseline.md 为唯一裁决入口。
- V2.5 历史事实引用 docs/v2-v3/planning/v2.5-release-map.md 与 v2.5-development-baseline，仅作历史证据。
- 已归档能力规范 openspec/specs/streaming-progress-contract/spec.md 作为行为契约引用。

## 范围

- 在只读报表页面复用 V2.5 已交付的 SSE 进度契约（reference-evidence）。
- 消费 openspec/specs/ 归档契约，不重开任何已收口 GA 表面。

## 非目标（non-goals）

- 不做容器化，不引入 Docker 或微服务。
- 不涉及真实外部动作：真实 OAuth/Webhook 未授权，停在 fixture/mock 边界。
- AI 只建议：任何 AI 建议均经预览/差异与显式确认后由人工应用，不自动执行。

## 验证

- fixture-first：全部自动化测试使用 fixture/mock。
