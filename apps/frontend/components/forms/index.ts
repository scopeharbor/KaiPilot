/** 表单与验证系统统一出口（establish-design-system / form-system）。 */
export * from './Form'

// 便利再导出：使用方无需分别 import react-hook-form / zod resolver。
export { useForm, useFormContext, useFormState, useWatch } from 'react-hook-form'
export { zodResolver } from '@hookform/resolvers/zod'
