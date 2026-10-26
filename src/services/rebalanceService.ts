export interface WalletBalancesInput {
  walletName: string;
  walletAddress: string;
  rhEquity: number;
  rhCollateral: number;
  arbEquity: number;
  arbCollateral: number;
}

export interface RebalanceResult {
  walletName: string;
  walletAddress: string;
  rhEquity: number;
  rhCollateral: number;
  arbEquity: number;
  arbCollateral: number;
  totalEquity: number;
  targetPerLeg: number;
  skewUsd: number;
  bridgeAmountUsd: number;
  bridgeDirection: 'BALANCED' | 'RH_TO_ARB' | 'ARB_TO_RH';
  maxSafeBridgeUsd: number;
  recommendationText: string;
}

export function calculateWalletRebalance(input: WalletBalancesInput): RebalanceResult {
  const totalEquity = parseFloat((input.rhEquity + input.arbEquity).toFixed(2));
  const targetPerLeg = parseFloat((totalEquity / 2).toFixed(2));
  const skewUsd = parseFloat((input.rhEquity - input.arbEquity).toFixed(2));
  const halfSkew = parseFloat((Math.abs(skewUsd) / 2).toFixed(2));

  let bridgeDirection: 'BALANCED' | 'RH_TO_ARB' | 'ARB_TO_RH' = 'BALANCED';
  let bridgeAmountUsd = 0;
  let maxSafeBridgeUsd = 0;
  let recommendationText = '✅ Балансы идеально уравновешены (50/50). Бридж не требуется.';

  if (skewUsd > 10) {
    bridgeDirection = 'RH_TO_ARB';
    bridgeAmountUsd = halfSkew;
    maxSafeBridgeUsd = Math.min(halfSkew, input.rhCollateral);
    recommendationText = `💡 **Рекомендация:** перевести **$${bridgeAmountUsd}** из **Robinhood Chain** в **Arbitrum zkLighter**.`;
    if (input.rhCollateral < halfSkew) {
      recommendationText += `\n⚠️ *Внимание:* в свободной марже RH доступно только **$${input.rhCollateral}** (остальное занято в сделках).`;
    }
  } else if (skewUsd < -10) {
    bridgeDirection = 'ARB_TO_RH';
    bridgeAmountUsd = halfSkew;
    maxSafeBridgeUsd = Math.min(halfSkew, input.arbCollateral);
    recommendationText = `💡 **Рекомендация:** перевести **$${bridgeAmountUsd}** из **Arbitrum zkLighter** в **Robinhood Chain**.`;
    if (input.arbCollateral < halfSkew) {
      recommendationText += `\n⚠️ *Внимание:* в свободной марже Arb доступно только **$${input.arbCollateral}** (остальное занято в сделках).`;
    }
  }

  return {
    walletName: input.walletName,
    walletAddress: input.walletAddress,
    rhEquity: input.rhEquity,
    rhCollateral: input.rhCollateral,
    arbEquity: input.arbEquity,
    arbCollateral: input.arbCollateral,
    totalEquity,
    targetPerLeg,
    skewUsd,
    bridgeAmountUsd,
    bridgeDirection,
    maxSafeBridgeUsd,
    recommendationText,
  };
}

export async function fetchLiveWalletEquity(walletAddress: string): Promise<{
  rhEquity: number;
  rhCollateral: number;
  arbEquity: number;
  arbCollateral: number;
}> {
  const normAddr = walletAddress.trim();
  const rhUrl = `https://api.rh.lighter.xyz/api/v1/account?by=l1_address&value=${normAddr}`;
  const arbUrl = `https://mainnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${normAddr}`;

  const [rhRes, arbRes] = await Promise.allSettled([
    fetch(rhUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json() as Promise<{ accounts?: Array<{ total_asset_value?: string; collateral?: string }> }>),
    fetch(arbUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json() as Promise<{ accounts?: Array<{ total_asset_value?: string; collateral?: string }> }>),
  ]);

  let rhEquity = 0;
  let rhCollateral = 0;
  let arbEquity = 0;
  let arbCollateral = 0;

  if (rhRes.status === 'fulfilled' && rhRes.value?.accounts?.[0]) {
    const acc = rhRes.value.accounts[0];
    rhEquity = parseFloat(acc.total_asset_value || acc.collateral || '0');
    rhCollateral = parseFloat(acc.collateral || '0');
  }

  if (arbRes.status === 'fulfilled' && arbRes.value?.accounts?.[0]) {
    const acc = arbRes.value.accounts[0];
    arbEquity = parseFloat(acc.total_asset_value || acc.collateral || '0');
    arbCollateral = parseFloat(acc.collateral || '0');
  }

  return { rhEquity, rhCollateral, arbEquity, arbCollateral };
}

export function formatRebalanceReport(reports: RebalanceResult[]): string {
  const lines: string[] = [
    `⚖️ **РЕБАЛАНСИРОВКА И БРИДЖ ДЕПОЗИТОВ (/b)**`,
    `Расчёт паритета 50/50 между Robinhood и Arbitrum Core:`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];

  for (const r of reports) {
    const skewSign = r.skewUsd >= 0 ? `+${r.skewUsd}` : `${r.skewUsd}`;
    lines.push(
      `💼 **${r.walletName}** (\`${r.walletAddress.slice(0, 6)}...${r.walletAddress.slice(-4)}\`)`,
      `• Совокупный капитал: **$${r.totalEquity}** (цель на ногу: **$${r.targetPerLeg}**)`,
      `• Robinhood: **$${r.rhEquity}** (свободно: $${r.rhCollateral})`,
      `• Arbitrum Core: **$${r.arbEquity}** (свободно: $${r.arbCollateral})`,
      `• Перекос (RH - Arb): **$${skewSign}**`,
      `${r.recommendationText}`,
      ``
    );
  }

  lines.push(`💡 Перевод восстановит симметричную маржу для безопасного открытия следующего цикла.`);
  return lines.join('\n');
}
