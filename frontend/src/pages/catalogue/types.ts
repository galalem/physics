export type Exercise = {
  slug: string
  title: string
  formula: string
  tags: string[]
  tier: string
  accessible?: boolean
  completed?: boolean
  resumable?: boolean
  recommendations?: {
    before: string[],
    after: string[]
  }
}