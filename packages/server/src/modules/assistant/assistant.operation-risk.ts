import {
  createDeckOp,
  createDeckRequestSchema,
  createTaskOp,
  DeckMaterialKind,
  exportDesignOp,
  functionalTestApproveRevisionOp,
  functionalTestRepairOp,
  functionalTestRerunOp,
  incrementalUpdateDesignOp,
  type OperationContract,
  OperationRisk,
  startGitReviewOp,
} from '@aw/shared';

const CONFIRM_EACH_CALL = new Set([
  functionalTestApproveRevisionOp.id,
  functionalTestRepairOp.id,
  functionalTestRerunOp.id,
  startGitReviewOp.id,
  incrementalUpdateDesignOp.id,
]);

function hasDesignOrReviewMaterial(materials: unknown): boolean {
  return createDeckRequestSchema.shape.materials
    .parse(materials)
    .some(({ kind }) => kind === DeckMaterialKind.Design || kind === DeckMaterialKind.GitReview);
}

export function assistantOperationRisk(contract: OperationContract, input: Record<string, unknown>): OperationRisk {
  // 任务创建的常规放行记录不能授权新的测试目标、写入接口或后续动作。
  if (
    (contract.id === createTaskOp.id && input.functionalTest !== undefined) ||
    (contract.id === exportDesignOp.id && input.overwrite === true) ||
    (contract.id === createDeckOp.id && hasDesignOrReviewMaterial(input.materials)) ||
    CONFIRM_EACH_CALL.has(contract.id)
  ) {
    return OperationRisk.Critical;
  }
  return contract.risk;
}
