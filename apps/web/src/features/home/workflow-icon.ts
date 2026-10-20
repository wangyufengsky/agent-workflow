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
