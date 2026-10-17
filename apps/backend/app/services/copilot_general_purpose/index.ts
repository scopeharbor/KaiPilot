// Copilot 通用问答模式服务 barrel
//
// 注（v3-backend-type-debt-closure）：原先按 `export { default as CopilotGeneralPurposeModeService }`
// 导出，但该模块导出的是一组纯函数、**没有 default 导出**，且全仓库无人消费该名字。
// 改为命名空间导出，与相邻的 boundary guard 保持一致。
export * as CopilotGeneralPurposeMode from './copilot_general_purpose_mode_service.js'
export * as CopilotGeneralPurposeBoundaryGuard from './copilot_general_purpose_boundary_guard.js'
