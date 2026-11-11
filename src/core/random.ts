export interface RandomSource {
  /** A number in [0, 1). */
  next(): number;
}

/**
 * The same generator as TAKO-SEN's createWideSeededRandom (DESIGN.md 13.3):
 * whole code points of the seed are hashed into 128 bits (cyrb128) and
 * stepped with sfc32, using 32-bit integer arithmetic only.
 */
export function createWideSeededRandom(seed: string): RandomSource {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (const char of seed) {
    const code = char.codePointAt(0)!;
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  let a = h1 | 0;
  let b = (h2 ^ h1) | 0;
  let c = (h3 ^ h1) | 0;
  let d = (h4 ^ h1) | 0;
  const source = {
    next() {
      const sum = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + sum) | 0;
      return (sum >>> 0) / 4294967296;
    },
  };
  // Discard the first outputs, which still correlate with the hash.
  for (let i = 0; i < 15; i += 1) source.next();
  return source;
}

/** An integer in [0, n). */
export function randomInt(random: RandomSource, n: number): number {
  return Math.floor(random.next() * n);
}

export function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(random, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
