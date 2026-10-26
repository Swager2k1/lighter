---
description: How to add a new network to the Stargate Bridge module for cross-chain transfers
---

# Stargate Network Integration Skill

## Overview

This skill defines the complete process for adding a new EVM network to the **Stargate Bridge** module (`src/modules/bridges/stargate/`). After completion, the new network becomes available as a source/destination for Stargate bridge operations with ETH, USDC/USDC.e, USDT tokens.

> [!IMPORTANT]
> This skill should be executed **AFTER** the network has already been added to the QSO project via `/add-network`. The network must exist in `src/types/networks.ts` and have a working client.

## Prerequisites

- The network is already registered in the QSO project (enum, client, RPC, explorer — via `/add-network`)
- The network's enum key in `src/types/networks.ts` (e.g., `'doma'`, `'somnia'`, `'story'`)

## Phase 1: Check Stargate Support

### Step 1. Query Stargate API for deployment data

Fetch the full Stargate V2 metadata from the API:

```
URL: https://mainnet.stargate-api.com/v1/metadata
```

This returns a JSON with `v1` and `v2` arrays. **Focus on `v2`** entries.

Search for entries where `chainKey` matches the network name (lowercase). For example, for Doma:

```json
{ "chainKey": "doma", "chainName": "doma", "id": "doma:13:v2", ... }
```

> [!WARNING]
> If no entries with the target `chainKey` are found, Stargate does NOT support this network. Stop here and inform the user.

### Step 2. Extract deployment data per token

For each token found (typically `assetId: "1"` = USDC/USDC.e, `assetId: "2"` = USDT, `assetId: "13"` = ETH/WETH), extract:

| Field | API JSON path | Example |
|-------|--------------|---------|
| **stargateType** | `.stargateType` | `"NATIVE"`, `"OFT"`, or `"POOL"` |
| **stargateAddress** | `.address` | `0x5d46805B...` |
| **tokenAddress** | `.token.address` | `0xEeee...` (native) or ERC20 address |
| **tokenSymbol** | `.token.symbol` | `ETH`, `USDC.e` |
| **tokenDecimals** | `.token.decimals` | `18` or `6` |
| **tokenMessaging** | `.tokenMessaging` | `0x108f4c...` |
| **lpToken** (if exists) | `.lpToken.address` | `0xACf29...` |

### Step 3. Determine the EID (Endpoint ID)

The EID is NOT in the Stargate API. Get it from LayerZero:

```
Search: "LayerZero <network_name> endpoint ID EID"
Or check: https://docs.layerzero.network/v2/deployments/mainnet
```

EIDs for mainnet V2 are in the 30000+ range (e.g., Doma = 30393, Somnia = 30380).

### Step 4. Get feeLib address via on-chain RPC call

The feeLib is NOT exposed in the Stargate API. Read it directly from the deployed contract using `getAddressConfig()`:

```javascript
// Function selector for getAddressConfig()
const selector = keccak256("getAddressConfig()").slice(0, 10); // = 0x2bc5114c

// Make eth_call to the Stargate pool/OFT contract
const result = await eth_call({
  to: "<stargateAddress>",  // The .address from API
  data: selector
});

// Result is 6 ABI-encoded addresses (32 bytes each):
// slot 0: feeLib         ← THIS IS WHAT WE NEED
// slot 1: planner
// slot 2: treasurer
// slot 3: tokenMessaging (should match API data)
// slot 4: creditMessaging
// slot 5: (zero)
```

**Practical command to run in terminal:**

```bash
node -e "
const https = require('https');
const {keccak256} = require('viem');
const sel = keccak256(Buffer.from('getAddressConfig()')).slice(0,10);
const data = JSON.stringify({jsonrpc:'2.0',method:'eth_call',params:[{to:'<STARGATE_ADDRESS>',data:sel},'latest'],id:1});
const opts = {hostname:'<RPC_HOST>',port:443,path:'/',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}};
const req = https.request(opts,(res)=>{let b='';res.on('data',(c)=>b+=c;res.on('end',()=>{const r=JSON.parse(b);if(r.result){const hex=r.result.slice(2);for(let i=0;i<hex.length;i+=64){const addr='0x'+hex.substring(i+24,i+64);if(addr!=='0x'+'0'.repeat(40))console.log('slot',i/64,':',addr)}}else console.log('Error:',JSON.stringify(r.error))})});
req.write(data); req.end();
"
```

Replace `<STARGATE_ADDRESS>` with the `.address` from the Stargate API and `<RPC_HOST>` with the network's RPC hostname.

> [!CAUTION]
> You MUST call `getAddressConfig()` separately for EACH token's Stargate contract (ETH pool, USDC OFT, etc.) because each has its own feeLib.

## Phase 2: Add Deployment Entries

### Step 5. Identify the target deployment object

File: `src/modules/bridges/stargate/constants.ts`

Map the `stargateType` from the API to the deployment object:

| Token | stargateType | Deployment object | Contract field |
|-------|-------------|-------------------|---------------|
| ETH/WETH | `NATIVE` | `ETH_DEPLOYMENTS` | `stargatePoolNative` |
| ETH/WETH | `OFT` | `ETH_DEPLOYMENTS` | `stargateOft` |
| ETH/WETH | `POOL` | `ETH_DEPLOYMENTS` | `stargatePool` |
| USDC/USDC.e | `NATIVE` | `USDC_DEPLOYMENTS` | `stargatePoolNative` |
| USDC/USDC.e | `OFT` | `USDC_DEPLOYMENTS` | `stargateOft` |
| USDC/USDC.e | `POOL` | `USDC_DEPLOYMENTS` | `stargatePool` |
| USDT | `OFT` | `USDT_DEPLOYMENTS` | `stargateOft` |
| USDT | `POOL` | `USDT_DEPLOYMENTS` | `stargatePool` |

### Step 6. Insert the deployment entry

Add a new entry in **alphabetical order** inside the corresponding `*_DEPLOYMENTS` object. Use the network's enum key (lowercase) as the property name.

**Template for NATIVE type (ETH with native pool):**
```typescript
doma: {
  eid: 30393,
  token: {
    name: 'ETH',
    symbol: 'ETH',
    decimals: 18,
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  },
  lpToken: {                              // Include if API has .lpToken
    name: 'ETH-LP',
    symbol: 'S*ETH',
    decimals: 18,
    address: '<lpToken.address from API>',
  },
  feeLib: {
    address: '<slot 0 from getAddressConfig()>',
  },
  tokenMessaging: {
    address: '<tokenMessaging from API>',
  },
  stargatePoolNative: {
    address: '<.address from API>',
  },
},
```

**Template for OFT type (USDC.e, USDT on newer chains):**
```typescript
doma: {
  eid: 30393,
  token: {
    name: 'Bridged USDC (Stargate)',
    symbol: 'USDC.e',
    decimals: 6,
    address: '<token.address from API>',
  },
  feeLib: {
    address: '<slot 0 from getAddressConfig()>',
  },
  tokenMessaging: {
    address: '<tokenMessaging from API>',
  },
  stargateOft: {
    address: '<.address from API>',
  },
},
```

**Template for POOL type (USDC on established chains):**
```typescript
mynetwork: {
  eid: 30XXX,
  token: {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    address: '<token.address from API>',
  },
  lpToken: {
    name: 'USDC-LP',
    symbol: 'S*USDC',
    decimals: 6,
    address: '<lpToken.address from API>',
  },
  feeLib: {
    address: '<slot 0 from getAddressConfig()>',
  },
  tokenMessaging: {
    address: '<tokenMessaging from API>',
  },
  stargatePool: {
    address: '<.address from API>',
  },
},
```

> [!NOTE]
> For native ETH tokens, the token address is always `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`.
> For OFT types, there is typically no `lpToken`.

### Step 7. Add to TOKENS_BY_NETWORK (if needed)

If the network was just added to the project via `/add-network`, ensure there is an entry for it in `src/constants/contracts.ts` → `TOKENS_BY_NETWORK`. An empty object is sufficient:

```typescript
doma: {},
```

## Phase 3: Verification

### Step 8. TypeScript check

// turbo
```bash
npx tsc --noEmit
```

Fix any errors autonomously. Common issues:
- Missing network key type (shouldn't happen if `/add-network` was run first)
- Typos in addresses

### Step 9. Present results

Report to the user:
- Which tokens were added for the network (ETH, USDC.e, USDT)
- The EID used
- The contract addresses added
- TypeScript compilation status

## Quick Reference: Data Sources

| Data | Source | Method |
|------|--------|--------|
| Token deployments | Stargate API | `GET mainnet.stargate-api.com/v1/metadata` |
| EID | LayerZero docs | Web search or docs page |
| feeLib | On-chain | `getAddressConfig()` RPC call (slot 0) |
| tokenMessaging | Stargate API + on-chain | API field or `getAddressConfig()` (slot 3) |

## Anti-Patterns (NEVER DO)

| ❌ DO NOT | ✅ DO INSTEAD |
|-----------|--------------|
| Guess contract addresses | Always verify from API + on-chain |
| Skip feeLib lookup | Always call `getAddressConfig()` on-chain |
| Use wrong stargateType field | Map NATIVE→stargatePoolNative, OFT→stargateOft, POOL→stargatePool |
| Add entries without EID | Always look up the LayerZero EID |
| Skip TOKENS_BY_NETWORK check | Ensure empty entry exists in `contracts.ts` |
| Modify existing deployment entries | Only append new network entries |
