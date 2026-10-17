# 手机工作面回归

使用已迁移并填充示范数据的本地实例，不执行 globalSetup 或重置数据库；前端须以 `NEXT_PUBLIC_FF_NEXT_UI=true` 启动/构建。后端选择本地 SQLite、关闭真实 AI provider 和登录期两步验证绑定，不使用生产数据库。

从仓库根执行（前后端已经启动）：

```sh
pnpm --filter @aiproj/e2e exec playwright test --config=playwright.mobile.config.ts
```

使用系统 Chromium 可设置 `E2E_CHROMIUM_PATH=/usr/bin/chromium`；否则使用 Playwright 安装的 Chromium。`E2E_BASE_URL` 和 `E2E_API_URL` 可覆盖前后端地址。默认使用仓库文档中的示范管理员 `admin@aiproj.local` / `password123`；其他本地测试帐号可通过 `E2E_MOBILE_EMAIL` / `E2E_MOBILE_PASSWORD` 设置，不要在日志输出凭据。

覆盖 320、390、430px 手机、844×390 横屏与 1440×900 桌面：真实表单登录、导航与设置、AI/通知/空间地图弹层、内部表格滚动、六种项目视图、看板状态切换与页面触摸滚动、任务详情、手动新建任务与 API 持久化。只删除本次创建的回归任务。截图和失败 trace 写入被忽略的 `test-results/mobile/`。

本组独立于原有 E2E 套件，避免默认关闭新轨 feature flag 的旧版测试环境误跑；使用浏览器触控模拟，不代表真实 iOS Safari 硬件验证。

本轮增加手机专用交互流程：状态标签与开始按钮、全屏任务详情执行/排期/关联切换、修改保留及实际 PATCH 持久化、手机卡片列表、甘特概要/图形切换、纵向时间线、日历默认日视图、真实依赖 AON 列表/画布、鱼骨原因编辑、AI 确定性导航与收件箱/对话切换。测试只创建独立命名的本地项目并在 finally 删除该项目；鱼骨编辑在该独立项目中保存并重载验证，不调用付费模型。

全站页面布局另用独立配置：

```sh
pnpm --filter @aiproj/e2e exec playwright test --config=playwright.mobile.audit.config.ts
```

`route-inventory.json` 记录全部 212 个页面源文件；审计对实际源码核对清单，扩展全部 24 个图表 ID，在 320px、390px 与手机横屏分别访问 235 个路径。报告保留重定向、空态、旗标关闭、权限受限与缺少实例资料的区分；15 个动态详情路径没有对应本地实例，只验证空态/错误态，不宣称完整业务验证。所有路径检查页面结构、整页横向越界和未捕获脚本异常；并不以布局审计替代每项业务提交、真实模型、真实第三方集成或硬件浏览器验证。JSON 报告与失败截图位于被忽略的 `test-results/mobile-audit/`。

视口缩短测试验证 AI 输入、发送按钮在可见范围内；真实 iOS/Android 软键盘及 Safari 手势仍需硬件复验。

针对失败路径重跑可设置 `E2E_MOBILE_AUDIT_FILTER` 为路由正则表达式；报告只记录实际匹配路径，局部重跑结果须与完整记录合并，不能代替全站覆盖。审计等待初始 API 响应及项目/图表骨架消失，避免持续轮询或未读取的错误响应流让 networkidle 永远无法成立。

本轮逐页状态、验证方式与边界见 [AUDIT.md](./AUDIT.md)。

## 手机主题保持回归

只跑新 UI 主题回归：

```bash
pnpm --filter @aiproj/e2e exec playwright test --config=playwright.mobile.config.ts mobile-theme.spec.ts
```

五种尺寸各验证手动明暗切换、手机更多菜单关闭/重开、AI 同事本地明暗操作、导航与刷新后的偏好及实际背景。只替换 AI `/ai/tools/plan` 的只读规划响应；输入、发送、本地执行、主题同步和持久化为真实前端流程，不调用真实模型。既有布局/业务操作验证与本组主题结果分别记录。

## 平台 AI 模型管理回归

```sh
pnpm --filter @aiproj/e2e exec playwright test --config=playwright.mobile.config.ts mobile-platform-models.spec.ts
```

五种尺寸验证单主模型确认保存、整张卡片文字及按钮旁空白处的鼠标拖曳、键盘排序、手机方向按钮、预览前零写入与整页宽度；390px 另以 Chromium CDP 真实触控事件验证长按卡片排序与按钮点按，卡片按钮可用键盘操作。登录使用本地示范超管 superadmin@aiproj.local（密码同示范账号，需预先加入本地测试组织以满足新 UI 组织门控），模型配置 GET/PUT 使用浏览器独立桩；后端功能测试另外验证真实 API 单主模型储存、读回与解析。桌面与 390px 截图在 test-results/mobile 下；模型名称为展示用测试资料，不代表生产已套用配置，也不调用真实模型。
