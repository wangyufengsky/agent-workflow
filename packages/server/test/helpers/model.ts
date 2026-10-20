/**
 * The model of every test that calls one (the `@opencode` bridge test and `pnpm test:live`): a free model, so the
 * runs cost nothing (D42, D50). `AW_OC_TEST_MODEL` picks another one when free models change availability.
 */
export const TEST_MODEL = process.env.AW_OC_TEST_MODEL ?? 'opencode-go/beam-free';
