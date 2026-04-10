import { ConclaveDefinition, ConclaveNode } from "@openconclave/shared";
import { NODE_TYPE_ALIASES } from "@openconclave/shared/src/constants";

/**
 * Normalizes conclave node types for backward compatibility.
 * Converts legacy node type names (e.g., "transform") to current names (e.g., "code").
 *
 * This allows existing conclaves to continue working after type renames.
 *
 * The normalization ensures that both node.type and node.data.type are synchronized
 * to the normalized type, providing a consistent interface for executors and other
 * downstream logic.
 */
export function normalizeConclaveNodeTypes(conclave: ConclaveDefinition): ConclaveDefinition {
  return {
    ...conclave,
    nodes: conclave.nodes.map(normalizeNode)
  };
}

/**
 * Normalizes a single node's type properties.
 *
 * Every conclave node has type at TWO levels:
 * - node.type: Root property (redundant but maintained for compatibility)
 * - node.data.type: Nested property (the authoritative type used by executors)
 *
 * Both MUST be synchronized. This function ensures both are updated together.
 *
 * Example:
 *   Input:  { type: "transform", data: { type: "transform" } }
 *   Output: { type: "code", data: { type: "code" } }
 */
function normalizeNode(node: ConclaveNode): ConclaveNode {
  const normalizedType = NODE_TYPE_ALIASES[node.data.type as keyof typeof NODE_TYPE_ALIASES] || node.data.type;

  // Only return a new object if the type actually changed
  if (normalizedType === node.data.type) {
    return node;
  }

  return {
    ...node,
    type: normalizedType as any,  // Update root property
    data: {
      ...node.data,
      type: normalizedType         // Update nested property (authoritative)
    }
  };
}

/**
 * Validates that a conclave was normalized (no legacy types remain).
 * Useful for debugging and audit purposes.
 *
 * Returns an array of error messages. Empty array means the conclave is fully normalized.
 */
export function validateNormalized(conclave: ConclaveDefinition): string[] {
  const errors: string[] = [];
  const legacyTypes = Object.keys(NODE_TYPE_ALIASES);

  conclave.nodes.forEach((node, index) => {
    if (legacyTypes.includes(node.data.type)) {
      errors.push(`Node ${index} (${node.id}) still uses legacy type: ${node.data.type}`);
    }
  });

  return errors;
}
