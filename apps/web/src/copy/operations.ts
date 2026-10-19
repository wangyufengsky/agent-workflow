/** Operation titles by the contract's `title` key (shared/operations); a unit test keeps it complete. */
export const OPERATION_TITLE: Readonly<Record<string, string>> = {
  'op.settings.get': '查看设置',
  'op.settings.update': '修改设置',
  'op.system.health': '后台状态',
  'op.system.environment': '查看运行环境',
  'op.system.recheckEnvironment': '重新检测环境',
  'op.projects.list': '项目列表',
  'op.projects.create': '添加项目',
  'op.projects.get': '查看项目',
  'op.projects.update': '修改项目',
  'op.projects.delete': '删除项目',
};
