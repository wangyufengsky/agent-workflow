export const FUNCTIONAL_TEST_NODE = {
  Author: 'test_case_author',
  Import: 'test_case_import',
  Environment: 'test_environment',
  Execute: 'test_execute',
  Report: 'test_report',
} as const;
export type FunctionalTestNode = (typeof FUNCTIONAL_TEST_NODE)[keyof typeof FUNCTIONAL_TEST_NODE];

export function isFunctionalTestNode(key: string): key is FunctionalTestNode {
  return Object.values(FUNCTIONAL_TEST_NODE).some((node) => node === key);
}

export const FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT = 'java-main';
