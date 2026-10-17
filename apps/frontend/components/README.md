# 设计系统组件库用法（establish-design-system）

> 本目录是 `DESIGN.md` 的落地层：设计令牌（`app/globals.css`）+ 通用组件（`components/ui/`）+ 表单系统（`components/forms/`）。
> 所有前端视图复用这套组件与令牌，**不要**在视图里另写样式或另立色板。技术栈：Next.js 14 App Router · TS strict · **Tailwind v4（CSS-first）** · Radix UI · next-themes。

## 1. 设计令牌（单一同源）

令牌全部定义在 [`app/globals.css`](../app/globals.css) 的 CSS 变量，Tailwind v4 用 `@theme inline` 映射为工具类——**改 CSS 变量即改工具类结果**，无第二处硬编码。

| 类别              | CSS 变量                                                 | Tailwind 工具类示例                                           |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| 主色 50–900       | `--primary-500`                                          | `bg-primary-500` `text-primary-600`                           |
| 中性 0–900        | `--gray-700`                                             | `text-gray-700` `border-gray-200`                             |
| 语义（前景/背景） | `--success` / `--success-bg`                             | `text-success` `bg-success-bg`（danger/warning/info/ai 同理） |
| 语义别名          | `--background` `--foreground` `--border` `--placeholder` | `bg-background` `text-foreground` `border-border`             |
| 字阶              | `--fs-base`…                                             | `text-base` `text-2xl`（含行高/字距）                         |
| 圆角              | `--radius-lg`(14)                                        | `rounded-[var(--radius-lg)]`                                  |
| 阴影              | `--shadow-md` `--shadow-focus`                           | `shadow-[var(--shadow-md)]`                                   |
| z-index           | `--z-modal` `--z-toast`                                  | `z-[var(--z-modal)]`                                          |
| 密度              | `--card-pad` `--control-h` `--icon-size`                 | `p-[var(--card-pad)]`                                         |

> 颜色/语义色随主题（`[data-mode]`）级联；密度令牌随 `[data-density]` 降档。二者正交。

## 2. 主题与密度

**主题**（浅/深/跟随系统）由 `next-themes` 驱动，写入 `<html data-mode>`：

```tsx
import { useTheme } from 'next-themes'
const { theme, setTheme } = useTheme()
setTheme('dark') // 'light' | 'dark' | 'system'
```

**密度**（舒适/紧凑）由 `stores/ui-store` 驱动，写入 `<html data-density>`，持久化到 `localStorage`，快捷键 `Cmd/Ctrl+Shift+D`：

```tsx
import { useUiStore } from '@/stores/ui-store'
const { density, setDensity, toggleDensity } = useUiStore()
```

两者的 Provider 与首屏防闪烁脚本已接在根 `app/layout.tsx`，无需在页面重复接入。

## 3. 组件清单（`components/ui/`，28 个）

统一从 `@/components/ui` 导入；图标统一用 `lucide-react`。

- **表单类**：`Button` `IconButton` `Input` `Textarea` `Select` `Combobox` `Checkbox` `RadioGroup` `Switch` `Label`
- **展示类**：`Card` `Badge` `Chip` `Avatar`(+`AvatarGroup`) `Separator` `Progress` `Skeleton`
- **浮层类**：`Tooltip` `Popover` `DropdownMenu` `Dialog` `Sheet`（均 Radix Portal，不被 `overflow` 裁切）
- **反馈类**：`Toast`(+`Toaster`/`useToast`) `Alert` `EmptyState` `Tabs`
- **AI 标识**：`AiChip` `AiCard`（克制版）

### 交互组件的 7 态

每个交互组件齐备 **default / hover / focus / active / disabled / loading / error**：

- `focus` → 键盘聚焦显 `--shadow-focus` ring（AI 元素用 `--shadow-ai`），不依赖颜色单通道；
- `loading` → `<Button loading>` 显示同色系 spinner 并禁用；
- `error` → 传 `aria-invalid` 触发 danger 边框/ring + 一次 shake。

```tsx
<Button variant="primary" size="default" loading={saving}>保存</Button>
<Button variant="danger" onClick={onDelete}>删除</Button>
<Input aria-invalid={hasError} placeholder="项目名称" />
<AiCard chipLabel="AI 建议">…AI 生成内容…</AiCard>
const { toast } = useToast(); toast({ variant: 'success', title: '已保存' })
```

`Button` variant：`primary | secondary | outline | ghost | danger | link`；size：`default | sm | lg | icon`。

## 4. 表单系统（`components/forms/`）

`react-hook-form` + `zod`，字段级中文错误文案（非仅红边框），支持新手↔专业渐进披露：

```tsx
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormSubmit,
  FormModeProvider,
  useForm,
  zodResolver,
} from '@/components/forms'
import { Input } from '@/components/ui'
import { z } from 'zod'

const schema = z.object({ name: z.string().min(1, '请输入项目名称'), note: z.string().optional() })

function ProjectForm() {
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: '', note: '' } })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>项目名称</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* advanced 字段在 <FormModeProvider mode="novice"> 下自动隐藏，数据模型不变 */}
        <FormField
          control={form.control}
          name="note"
          advanced
          render={({ field }) => (
            <FormItem>
              <FormLabel>备注</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormSubmit>保存</FormSubmit> {/* 仅在有改动(isDirty)时高亮可提交 */}
      </form>
    </Form>
  )
}
```

> 前端 zod 校验是**体验层**，不替代后端 AdonisJS(vine) 的权威校验。

## 5. 防 AI-slop 红线（实现时必守，`DESIGN.md` §12）

无侧边色条、无渐变文字、无默认玻璃拟态、无 ghost-card（1px 边框 + ≥16px 阴影不并用）、卡片圆角 ≤16px、无手绘/草图 SVG、无条纹/网格背景、无嵌套卡片。**AI 紫是语义色**，仅用于真正的 AI 元素。完成任一前端源码目录前跑 `npx impeccable detect <目录>`。
