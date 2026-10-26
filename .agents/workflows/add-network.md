---
description: How to add a new Web3 network (blockchain) to the QSO project
---

// turbo-all

## Workflow: Add New Web3 Network

### Phase 1: Research
1. Read the skill file at `.agents/skills/web3-network-integration/SKILL.md` for the full integration guide
2. Check if the network exists in `viem/chains` — run: `grep -r "<network_name>" node_modules/viem/dist/esm/chains/definitions/`
3. If NOT in viem: gather Chain ID, native token symbol, decimals, RPC URLs, and explorer URL from official docs or chainlist.org
4. If IN viem: note the import name (e.g. `import { berachain } from 'viem/chains'`)

### Phase 2: Implementation (9 steps — follow skill file order strictly)
5. Add enum value + `SUPPORTED_NETWORKS` entry in `src/types/networks.ts`
6. Create client class file `src/clients/<network>.ts`
7. Add re-export in `src/clients/index.ts`
8. Add RPC URLs in `src/_inputs/settings/RPCs.ts`
9. Add explorer link in `src/constants/explorer-links.ts`
10. Add switch case + import in `src/helpers/clients/get-client-by-network.ts`
11. Add switch case in `src/helpers/clients/get-explorer-link-by-network.ts`
12. Add switch case in `src/helpers/clients/get-native-token-by-network.ts`
13. (Optional) Add Blockscout link in `src/helpers/clients/get-blockscout-link-by-network.ts`
14. (Optional) Add to legacy networks in `src/helpers/clients/check-legacy-type-by-network.ts` if needed

### Phase 2.5: Stargate Bridge Integration (Optional)
After network base integration, ask the user: "Нужно ли добавить поддержку Stargate Bridge для этой сети?"
If yes, read and follow the skill at `.agents/skills/stargate-network-integration/SKILL.md`

### Phase 3: Verification
15. Run type check:
```bash
npx tsc --noEmit
```
16. Fix any TypeScript errors autonomously
17. Present clean log to the user
