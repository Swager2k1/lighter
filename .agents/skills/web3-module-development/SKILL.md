---
description: How to create a new Web3 protocol module for the QSO automation framework
---

# Web3 Module Development Skill

## Overview

This skill defines the step-by-step process for adding a new Web3 protocol module to the QSO project. Every module follows the same isolated, anti-sybil, financially-safe pattern.

## Prerequisites

Before starting, read the existing reconnaissance of core utilities:
- `src/helpers/utils/randomizers.ts` — `getRandomNumber()`, `getRandomBigInt()`, `getRandomItemFromArray()`
- `src/helpers/utils/sleep.ts` — `sleep()`, `sleepByRange()`
- `src/helpers/gas/get-gas-options.ts` — `getGasOptions()`
- `src/helpers/gas/wait-gas.ts` — `waitGas()`
- `src/clients/default-client.ts` — `DefaultClient` class (approve, balance, waitTxReceipt)
- `src/helpers/main/transaction-worker.ts` — `transactionWorker()` wrapper

All imports come from `'../../../../helpers'` and `'../../../../types'`.

## Phase 1: Research (READ-ONLY)

1. **Identify the target protocol's smart contracts:**
   - Find the official contract addresses on the target chain
   - Locate the ABI (from block explorer, official docs, or GitHub)
   - Identify which functions need to be called (swap, deposit, withdraw, etc.)

2. **Study one existing module as a reference pattern:**
   - Simple module: `src/scripts/main/modules/symbiotic/` (single action)
   - Complex module with service: `src/scripts/main/modules/tempo/` (service + multiple actions)
   - Swap module: `src/scripts/main/modules/neon/vibr/` (DEX swap with approve)

3. **Check if the protocol needs a custom service class:**
   - If all logic fits in one transaction callback → NO service needed
   - If you need session management, API calls, or multi-step flows → create a `<protocol>.service.ts`

4. **Create an implementation_plan.md and wait for user approval.**

## Phase 2: Implementation

### Step 1: Create module folder structure

```
src/scripts/main/modules/<protocol>/
├── index.ts
├── constants.ts          # (if needed)
├── make-<action>.ts      # one file per action
└── <protocol>.service.ts # (if needed)
```

### Step 2: Write `constants.ts` (if needed)

```typescript
// Contract addresses (verified on block explorer)
export const PROTOCOL_CONTRACT = '0x...' as const;

// ABI — only the functions you call (minimal ABI)
export const PROTOCOL_ABI = [
  {
    inputs: [...],
    name: 'functionName',
    outputs: [...],
    stateMutability: '...',
    type: 'function',
  },
] as const;
```

### Step 3: Write `make-<action>.ts`

Follow this exact template:

```typescript
import {
  calculateAmount,
  decimalToInt,
  getGasOptions,
  getTrimmedLogsAmount,
  TransactionCallbackParams,
  TransactionCallbackReturn,
  transactionWorker,
} from '../../../../helpers';
import { TransformedModuleParams } from '../../../../types';

// Public entry point — used by the router
export const execMake<Action> = async (params: TransformedModuleParams) =>
  transactionWorker({
    ...params,
    startLogMessage: 'Execute <protocol> <action>...',
    transactionCallback: make<Action>,
  });

// Private callback — contains the actual transaction logic
const make<Action> = async (params: TransactionCallbackParams): TransactionCallbackReturn => {
  const {
    client,
    gweiRange,
    gasLimitRange,
    network,
    logger,
    minAndMaxAmount,
    usePercentBalance,
    minTokenBalance,
  } = params;

  const { walletClient, publicClient, explorerLink, walletAddress } = client;

  // 1. CHECK BALANCE (Rule 3: Zero Loss Tolerance)
  const balance = await client.getNativeBalance(); // or getBalanceByContract()

  const logBalance = getTrimmedLogsAmount(balance.int, 'TOKEN');
  if (minTokenBalance && balance.int < minTokenBalance) {
    return {
      status: 'passed',
      message: `Balance [${logBalance}] is lower than minTokenBalance ${minTokenBalance}`,
    };
  }

  // 2. CALCULATE AMOUNT (Rule 4: Anti-Sybil — randomized via NumberRange)
  const amount = calculateAmount({
    balance: balance.wei,
    decimals: balance.decimals,
    minAndMaxAmount,
    usePercentBalance,
    isBigInt: true,
  });

  // 3. GET GAS OPTIONS (Rule 4: Anti-Sybil — randomized gas)
  const feeOptions = await getGasOptions({
    gweiRange,
    gasLimitRange,
    network,
    publicClient,
  });

  // 4. SEND TRANSACTION
  const txHash = await walletClient.writeContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'deposit',
    args: [walletAddress, amount],
    ...feeOptions,
  });

  // 5. WAIT FOR RECEIPT (Rule 3: verify success)
  await client.waitTxReceipt(txHash);

  // 6. RETURN RESULT
  const amountInt = decimalToInt({ amount, decimals: balance.decimals });
  const logAmount = getTrimmedLogsAmount(amountInt, 'TOKEN');

  return {
    status: 'success',
    txHash,
    explorerLink,
    tgMessage: `<Action> ${logAmount}`,
  };
};
```

### Step 4: Write `index.ts`

```typescript
export * from './make-<action>';
```

### Step 5: Register in modules index

Add **one line** to `src/scripts/main/modules/index.ts`:

```typescript
export * from './<protocol>';
```

### Step 6: Create route config

Create `src/_inputs/settings/routes/custom-<protocol>.ts` using existing route files as templates.

## Phase 3: Verification

// turbo
1. Run TypeScript type checking:
```bash
npx tsc --noEmit
```

2. Fix all errors autonomously.

3. Present only the clean final log to the user.

## Anti-Patterns (NEVER DO)

- ❌ Hardcode private keys or seed phrases
- ❌ Use static gas values (e.g., `gasPrice: 5n`)
- ❌ Use static amounts or delays
- ❌ Edit core files (`helpers/`, `clients/`, `managers/`, `types/`)
- ❌ Skip balance check before transaction
- ❌ Skip `waitTxReceipt()` after transaction
- ❌ Create new randomization functions (use existing ones)
- ❌ Use `maxUint256` directly for approve (use `client.approve()`)
