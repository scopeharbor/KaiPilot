# warning-change — security gate fixture（warning 场景）

> fixture 目录：`scripts/__fixtures__/security-gate/warning-change/`（CLI 测试用，非真实 change）。

## 用途

验证 security gate 对「有 evidence 但缺 strict validate 记录」的 change 产出 warning：
observation-and-inventory.md 存在 + 提及 authentication-session，但归档证据未声明 strictValidate。
