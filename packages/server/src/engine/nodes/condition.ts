import type { WorkflowNode, ConditionConfig } from "@openconclave/shared";
import { evaluateExpression } from "../../lib/expression";

export function executeCondition(node: WorkflowNode, input: unknown): unknown {
  const config = node.data.config as ConditionConfig;
  const result = evaluateExpression(config.expression, input);
  return { __conditionResult: result, __passthrough: input };
}
