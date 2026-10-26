export function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sleepByRange(rangeMs: [number, number]): Promise<number> {
  const ms = getRandomNumber(rangeMs[0], rangeMs[1]);
  await sleep(ms);
  return ms;
}
