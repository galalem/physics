/**
 * xoshiro128** — 128-bit state PRNG with fork()-able substreams.
 *
 * Rationale in docs/physicsruntimedesign.md §8: reproducibility is
 * load-bearing for bug reports, and `fork()` per subsystem prevents
 * decorative additions from shifting the physics stream.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number
  /** Float in [min, max). */
  range(min: number, max: number): number
  /** Random element of a non-empty array. */
  pick<T>(xs: readonly T[]): T
  /** New array with a Fisher–Yates shuffle. */
  shuffle<T>(xs: readonly T[]): T[]
  /** Gaussian sample (Box–Muller). Defaults: μ=0, σ=1. */
  gauss(mu?: number, sigma?: number): number
  /**
   * Independent substream, seeded from a draw of this stream.
   * Establish forks at exercise INIT in a stable order to keep them
   * reproducible across code changes.
   */
  fork(): Rng
}

type State = { a: number; b: number; c: number; d: number }

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0

function nextUint32(s: State): number {
  const result = Math.imul(rotl(Math.imul(s.b, 5), 7), 9) >>> 0
  const t = (s.b << 9) >>> 0
  s.c ^= s.a
  s.d ^= s.b
  s.b ^= s.c
  s.a ^= s.d
  s.c ^= t
  s.d = rotl(s.d, 11)
  return result
}

/** SplitMix32 to derive 128 bits of state from a 32-bit seed. */
function seedState(seed: number): State {
  let z = seed >>> 0
  const step = (): number => {
    z = (z + 0x9e3779b9) >>> 0
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
  const s: State = { a: step(), b: step(), c: step(), d: step() }
  // xoshiro requires at least one non-zero word.
  if ((s.a | s.b | s.c | s.d) === 0) s.a = 1
  return s
}

export function createRng(seed: number): Rng {
  const s = seedState(seed)
  let cachedGauss: number | null = null

  const next = (): number => nextUint32(s) / 0x100000000

  const rng: Rng = {
    next,

    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,

    range: (min, max) => next() * (max - min) + min,

    pick: <T>(xs: readonly T[]): T => {
      if (xs.length === 0) throw new Error('rng.pick: empty array')
      return xs[Math.floor(next() * xs.length)] as T
    },

    shuffle: <T>(xs: readonly T[]): T[] => {
      const out = [...xs]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const ai = out[i] as T
        const aj = out[j] as T
        out[i] = aj
        out[j] = ai
      }
      return out
    },

    gauss: (mu = 0, sigma = 1) => {
      if (cachedGauss !== null) {
        const g = cachedGauss
        cachedGauss = null
        return mu + sigma * g
      }
      // Box–Muller (rejection guard so u,v > 0)
      let u = 0
      let v = 0
      while (u === 0) u = next()
      while (v === 0) v = next()
      const mag = Math.sqrt(-2 * Math.log(u))
      const angle = 2 * Math.PI * v
      cachedGauss = mag * Math.sin(angle)
      return mu + sigma * mag * Math.cos(angle)
    },

    fork: () => createRng(nextUint32(s)),
  }

  return rng
}
