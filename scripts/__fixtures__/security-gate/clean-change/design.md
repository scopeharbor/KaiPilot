# clean-change — design

## Context

本 change 只扩展报表模板渲染，不触及认证、租户、外部 provider 或 AI 执行路径；
所有验证均使用本地 fixture 与 mock，不调用真实外部服务。

## Non-Goals

- 不新增运行时 API。
- 不做任何自动执行或落库。
