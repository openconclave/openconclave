# Rename "Transform" to "Code" Node

## Summary
Rename all references to "transform" node type to "code" throughout the codebase. The node that runs user-written code (Python/JS) is currently called "transform" but should be called "code" — it's a clearer, more intuitive name.

## Scope

### Shared types (`packages/shared/src/`)
- Rename `"transform"` to `"code"` in `WorkflowNode.data.type` union type
- Update any type guards or utility functions that check for `"transform"`

### Server (`packages/server/src/`)
- Rename `transform-node-executor.ts` to `code-node-executor.ts`
- Update the executor registry/mapping that dispatches to the transform executor
- Update any references in graph-walker or node-executor that match on `"transform"` type
- Update log messages that reference "transform"

### Client (`packages/client/src/`)
- Rename the transform node component if it exists
- Update the node type registry in the workflow editor canvas
- Update any UI labels, icons, or tooltips that say "Transform"
- Update the "add node" menu/palette entry

### Database
- No schema migration needed — node types are stored in workflow JSON, not as DB columns. Existing workflows with `"transform"` nodes will need to still work (backward compat) OR be migrated via a one-time script.

## Constraints
- This is a rename only — do NOT change any behavior or add features
- Ensure existing workflows with "transform" nodes still load correctly
- All tests must pass after the rename
