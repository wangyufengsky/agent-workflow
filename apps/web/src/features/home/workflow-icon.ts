import type { IconName } from '../../components/icon.tsx';

/** Icons of the built-in workflows on the start cards; custom workflows use the generic one. */
const WORKFLOW_ICON: Readonly<Record<string, IconName>> = {
  feature: 'sparkle',
  bugfix: 'alert',
  unit_tests: 'check',
  code_review: 'search',
  refactor: 'layers',
  version_review: 'clock',
  security_review: 'lock',
  cleanup: 'trash',
  design_proposal: 'map',
  detailed_design: 'book',
  breakdown: 'split',
};

export const workflowIcon = (key: string): IconName => WORKFLOW_ICON[key] ?? 'flow';

/** The built-in「新功能开发」: what the sidebar's「开始任务」and ⌘N put the home input in (28 §2.2). */
export const DEFAULT_START_WORKFLOW = 'feature';

/** The built-in workflows shown as chips under「直接开始」; the rest are under「更多流程」(38 C2, D158). */
export const PRIMARY_WORKFLOWS: readonly string[] = ['feature', 'bugfix', 'unit_tests', 'code_review', 'refactor'];
