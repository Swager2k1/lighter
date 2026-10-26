export function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function sleepByRange(rangeMs) {
    const ms = getRandomNumber(rangeMs[0], rangeMs[1]);
    await sleep(ms);
    return ms;
}
