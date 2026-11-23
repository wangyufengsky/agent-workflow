import {
  createTaskOp,
  functionalTestApproveRevisionOp,
  functionalTestRepairOp,
  functionalTestRerunOp,
  type OperationContract,
  OperationRisk,
} from '@aw/shared';

const CONFIRM_EACH_TEST_CALL = new Set([
  functionalTestApproveRevisionOp.id,
  functionalTestRepairOp.id,
  functionalTestRerunOp.id,
]);

export function assistantOperationRisk(contract: OperationContract, input: Record<string, unknown>): OperationRisk {
  // 任务创建的常规放行记录不能授权新的测试目标、写入接口或后续动作。
  if (
    (contract.id === createTaskOp.id && input.functionalTest !== undefined) ||
    CONFIRM_EACH_TEST_CALL.has(contract.id)
  ) {
    return OperationRisk.Critical;
  }
  return contract.risk;
}
