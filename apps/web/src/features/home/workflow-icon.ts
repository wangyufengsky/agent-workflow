import type { IconName } from '../../components/icon.tsx';

/** Icons of the built-in workflows on the start cards; custom workflows use the generic one. */
const WORKFLOW_ICON: Readonly<Record<string, IconName>> = {
  feature: 'sparkle',
  bugfix: 'alert',
  unit_tests: 'check',
  code_review: 'search',
  refactor: 'layers',
};

export const workflowIcon = (key: string): IconName => WORKFLOW_ICON[key] ?? 'flow';

/** The built-in「新功能开发」: what the sidebar's「开始任务」and ⌘N put the home input in (28 §2.2). */
export const DEFAULT_START_WORKFLOW = 'feature';
