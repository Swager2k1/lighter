---
description: How to add a new Web3 protocol module to the QSO project
---

// turbo-all

## Workflow: Create New Web3 Module

### Phase 1: Research (READ-ONLY)
1. Read the skill file at `.agents/skills/web3-module-development/SKILL.md` for the full module template
2. Find the target protocol's smart contract addresses and ABI
3. Study a reference module: `src/scripts/main/modules/symbiotic/` (simple) or `src/scripts/main/modules/neon/vibr/` (swap with approve)
4. Create `implementation_plan.md` as an artifact and notify the user for approval

### Phase 2: Implementation (after user approval)
5. Create `src/scripts/main/modules/<protocol>/constants.ts` with contract addresses and minimal ABI
6. Create `src/scripts/main/modules/<protocol>/make-<action>.ts` following the `transactionWorker` pattern
7. Create `src/scripts/main/modules/<protocol>/index.ts` with re-exports
8. Add one line `export * from './<protocol>';` to `src/scripts/main/modules/index.ts`
9. Create route config at `src/_inputs/settings/routes/custom-<protocol>.ts`

### Phase 3: Verification
10. Run type check:
```bash
npx tsc --noEmit
```
11. Fix any TypeScript errors autonomously
12. Present clean log to the user
