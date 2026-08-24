import type { StageInfo } from '@physics/sdk/react'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict

function pick(locale: string): Locale {
  return (locale in dict ? locale : 'en') as Locale
}

export function getStagesFor(locale: string): StageInfo[] {
  return dict[pick(locale)].stages as StageInfo[]
}

export function getHintFor(locale: string, stageIdx: number, level: number): string {
  const hints = dict[pick(locale)].hints as Record<string, Record<string, string>>
  return hints[String(stageIdx)]?.[String(level)] ?? ''
}
