/**
 * bi_report_templates —— BI 报表模板库服务入口。
 */
export {
  BI_BUILTIN_TEMPLATES,
  BI_TEMPLATE_MAP,
  isBuiltinBiTemplate,
  getBuiltinBiTemplates,
  getBuiltinBiTemplatesByCategory,
  getBuiltinBiTemplatesByScenario,
  getBuiltinBiTemplate,
  getBuiltinBiTemplateVersion,
} from './registry.js'

export { BiTemplateLibraryService } from './template_library_service.js'
export { BiTemplateCopyService } from './copy_service.js'
