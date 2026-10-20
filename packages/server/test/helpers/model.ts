/**
 * The model of every test that calls one (the `@opencode` bridge test, J10 and `pnpm test:live`): a free model, so
 * the runs cost nothing (D50, D62). `AW_OC_TEST_MODEL` picks another one when free models change availability.
 */
export const TEST_MODEL = process.env.AW_OC_TEST_MODEL ?? 'opencode-go/deepseek-v4.1-flash';
