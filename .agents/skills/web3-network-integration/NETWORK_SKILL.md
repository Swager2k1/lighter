---
description: How to add a new Web3 network (blockchain) to the QSO project
---

# Web3 Network Integration Skill

## Overview

This skill defines the complete, **step-by-step** process for adding a new EVM-compatible blockchain network to the QSO project. After completion, the new network becomes available for **all** existing and future modules.

## Prerequisites

Before starting, gather the following information for the target network:

| Data | Where to find | Example |
|------|---------------|---------|
| **Chain ID** | chainlist.org or official docs | `80094` |
| **Network name** | Official docs | `Berachain` |
| **Native token symbol** | Official docs | `BERA` |
| **Native token decimals** | Usually `18` | `18` |
| **RPC URLs (2-3 minimum)** | chainlist.org, official docs | `https://rpc.berachain.com` |
| **Block explorer URL** | Official docs | `https://berascan.com` |
| **viem/chains support** | Check `node_modules/viem/chains` | `import { berachain } from 'viem/chains'` |

## Two Integration Patterns

### Pattern A: Network exists in `viem/chains` (PREFERRED)

If the chain is already defined in the viem library, use a simple import:

```typescript
import { arbitrum } from 'viem/chains';
```

### Pattern B: Custom chain definition via `defineChain()`

If the chain is NOT in viem, define it manually:

```typescript
import { defineChain } from 'viem';

export const myNetwork = defineChain({
  id: 12345,                    // Chain ID
  name: 'My Network',
  nativeCurrency: {
    decimals: 18,
    name: 'My Token',
    symbol: 'MYT',
  },
  rpcUrls: {
    default: { http: ['https://rpc.mynetwork.com'] },
  },
  blockExplorers: {
    default: {
      name: 'My Explorer',
      url: 'https://explorer.mynetwork.com',
    },
  },
});
```

## 9 Integration Points (Checklist)

Adding a network requires changes in **9 files**. The order below is the mandatory execution sequence.

> [!CAUTION]
> Files marked ⚠️ are **core files**. These are the ONLY core files you are allowed to edit when adding a network, and only by **appending** new entries — never modify or delete existing lines.

---

### Step 1. ⚠️ `src/types/networks.ts` — Add to Networks enum + SUPPORTED_NETWORKS

**Add enum value:**
```typescript
// In enum Networks { ... }
MY_NETWORK = 'my-network',
```

**Add to SUPPORTED_NETWORKS array:**
```typescript
// In const SUPPORTED_NETWORKS = [ ... ]
'my-network',
```

> [!IMPORTANT]  
> The string value in the enum becomes the network's identifier everywhere in the project. Use lowercase kebab-case for multi-word names (e.g. `'camp-network'`, `'arbitrum-nova'`).

---

### Step 2. `src/clients/<network>.ts` — Create Client Class

**Pattern A (viem/chains exists):**
```typescript
import { myNetwork } from 'viem/chains';

import { Networks } from '../types';
import { ClientConstruct, DefaultClient } from './default-client';

export class MyNetworkClient extends DefaultClient {
  constructor(params: ClientConstruct) {
    super({
      ...params,
      chainData: myNetwork,
      network: Networks.MY_NETWORK,
    });
  }
}
```

**Pattern B (custom defineChain):**
```typescript
import { defineChain } from 'viem';

import { Networks } from '../types';
import { ClientConstruct, DefaultClient } from './default-client';

export const myNetwork = defineChain({
  id: 12345,
  name: 'My Network',
  nativeCurrency: { decimals: 18, name: 'My Token', symbol: 'MYT' },
  rpcUrls: { default: { http: ['https://rpc.mynetwork.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.mynetwork.com' } },
});

export class MyNetworkClient extends DefaultClient {
  constructor(params: ClientConstruct) {
    super({
      ...params,
      chainData: myNetwork,
      network: Networks.MY_NETWORK,
    });
  }
}
```

> [!IMPORTANT]  
> Class naming convention: `<NetworkName>Client` in PascalCase. Examples: `BerachainClient`, `ArbitrumNovaClient`, `CampNetworkClient`.

---

### Step 3. ⚠️ `src/clients/index.ts` — Add re-export

```typescript
export * from './<network>';
```

---

### Step 4. ⚠️ `src/_inputs/settings/RPCs.ts` — Add RPC URLs

```typescript
// In PUBLIC_RPCS object
'my-network': [
  'https://primary-rpc.mynetwork.com',
  'https://backup-rpc.mynetwork.com',
],
```

> [!WARNING]  
> Always provide at least 2 RPC endpoints for redundancy (fallback transport). If only one public RPC exists, list it but add a comment noting the limitation.

---

### Step 5. ⚠️ `src/constants/explorer-links.ts` — Add explorer URL

```typescript
// In explorerLinks object
'my-network': 'https://explorer.mynetwork.com',
```

---

### Step 6. ⚠️ `src/helpers/clients/get-client-by-network.ts` — Add switch case

```typescript
// In getClientByNetwork switch
case Networks.MY_NETWORK:
  return new MyNetworkClient(params);
```

Also add the import at the top of the file:
```typescript
import { MyNetworkClient } from '../../clients';
```

> [!NOTE]  
> The import should be added to the existing destructured import block from `'../../clients'`, not as a separate import statement.

---

### Step 7. ⚠️ `src/helpers/clients/get-explorer-link-by-network.ts` — Add switch case

```typescript
// In getExplorerLinkByNetwork switch
case Networks.MY_NETWORK:
  return explorerLinks['my-network'];
```

---

### Step 8. ⚠️ `src/helpers/clients/get-native-token-by-network.ts` — Add switch case

**If using viem/chains (Pattern A):**
```typescript
case Networks.MY_NETWORK:
  return myNetwork.nativeCurrency.symbol;
```
(Import `myNetwork` from `viem/chains` at the top)

**If using custom defineChain (Pattern B):**
```typescript
case Networks.MY_NETWORK:
  return myNetwork.nativeCurrency.symbol;
```
(Import `myNetwork` from `'../../clients'` at the top)

**If native token symbol is non-standard or chain object is missing it:**
```typescript
case Networks.MY_NETWORK:
  return 'MYT';
```

---

### Step 9. (OPTIONAL) `src/helpers/clients/get-blockscout-link-by-network.ts` — Add switch case

Only if the network has a Blockscout explorer:
```typescript
case Networks.MY_NETWORK:
  return 'https://mynetwork.blockscout.com/';
```

If no Blockscout exists, skip this — the default returns `''`.

---

### Step 10. (OPTIONAL) `src/helpers/clients/check-legacy-type-by-network.ts`

Only if the network uses **legacy** gas pricing (gasPrice instead of EIP-1559 maxFeePerGas):
```typescript
const legacyTypeNetworks: SupportedNetworks[] = ['0g-newton', 'my-network'];
```

---

## Verification

After all changes:

```bash
npx tsc --noEmit
```

Fix any TypeScript errors (usually missing imports or typos in enum values).

---

## Anti-Patterns (NEVER DO)

| ❌ DO NOT | ✅ DO INSTEAD |
|-----------|--------------|
| Delete or modify existing network entries | Only **append** new entries |
| Use a single RPC without fallback | Provide 2+ RPC URLs when possible |
| Use unstable/rate-limited public RPCs as the only option | Prefer dedicated endpoints (Blockpi, Alchemy, etc.) |
| Hardcode chain data inline in modules | Create a proper client class in `src/clients/` |
| Skip `SUPPORTED_NETWORKS` array | Always add to both enum AND array |
| Use an inconsistent network key format | Use lowercase, kebab-case: `'my-network'` |
| Modify `DefaultClient` class | Only extend it via `class MyClient extends DefaultClient` |
| Forget `get-native-token-by-network.ts` | Missing entries cause runtime crashes |

---

## Reference: Files Summary

| # | File | Action | Core? |
|---|------|--------|-------|
| 1 | `src/types/networks.ts` | Add enum + array entry | ⚠️ Yes (append only) |
| 2 | `src/clients/<network>.ts` | **Create new file** | ✅ New file |
| 3 | `src/clients/index.ts` | Add re-export line | ⚠️ Yes (append only) |
| 4 | `src/_inputs/settings/RPCs.ts` | Add RPC URLs | ⚠️ Yes (append only) |
| 5 | `src/constants/explorer-links.ts` | Add explorer URL | ⚠️ Yes (append only) |
| 6 | `src/helpers/clients/get-client-by-network.ts` | Add switch case + import | ⚠️ Yes (append only) |
| 7 | `src/helpers/clients/get-explorer-link-by-network.ts` | Add switch case | ⚠️ Yes (append only) |
| 8 | `src/helpers/clients/get-native-token-by-network.ts` | Add switch case + import | ⚠️ Yes (append only) |
| 9 | `src/helpers/clients/get-blockscout-link-by-network.ts` | Add switch case (optional) | ⚠️ Yes (append only) |
