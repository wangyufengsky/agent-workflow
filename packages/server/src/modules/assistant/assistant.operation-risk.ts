import {
  createTaskOp,
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

export function assistantOperationRisk(contract: OperationContract, input: Record<string, unknown>): OperationRisk {
  // 任务创建的常规放行记录不能授权新的测试目标、写入接口或后续动作。
  if (
    (contract.id === createTaskOp.id && input.functionalTest !== undefined) ||
    (contract.id === exportDesignOp.id && input.overwrite === true) ||
    CONFIRM_EACH_CALL.has(contract.id)
  ) {
    return OperationRisk.Critical;
  }
  return contract.risk;
}
