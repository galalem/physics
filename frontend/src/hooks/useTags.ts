import { useCallback, useEffect, useState } from 'react'
import { useLocale } from '@galalem/react-localization'
import { bread } from '~/lib/api'

export type Tag = { slug: string; label: string }
export type Tags = { slug: string; label: string; tags: Tag[] }

const cache: Record<string, Promise<Tags[]>> = {}

export function useTags() {
  const [tags, setTags] = useState<Tags[]>([])
  const { locale } = useLocale()

  const labelTag = useCallback((compound: string) => {
    if (!compound.includes(':')) return null
    const [group, tag] = compound.split(':')
    return tags?.find((g) => g.slug === group)?.tags.find((t) => t.slug === tag)?.label ?? null
  }, [tags])

  const invalidate = () => Object.keys(cache).forEach((k) => delete cache[k])

  useEffect(() => {
    if (!locale) return

    // Usually browsing should go through `bread.browse`, but the tags endpoint is an exception.
    if (!(locale in cache)) {
      cache[locale] = bread.read<Tags[]>('', 'tags').then((res) => {
        if (!res.error) return res.content
        delete cache[locale]
        return []
      })
    }

    let cancelled = false
    cache[locale]!.then((cachedTags) => {
      if (!cancelled && cachedTags.length) setTags(cachedTags)
    })

    return () => { cancelled = true }
  }, [locale])

  return { tags, labelTag, invalidate }
}
