import { T } from '@galalem/react-localization'
import { useState } from 'react'
import { useTags } from '~/hooks'

export function TagChips({
  activeTags,
  onChange,
}: {
  activeTags?: string[] | null | undefined
  onChange?: ((tags: string[] | null) => void) | undefined
}) {
  const [active, setActive] = useState<string[] | null>(activeTags || null);
  const { tags } = useTags();

  const handleToggle = (tag:string|null) => {
    const newTags:string[] | null = tag === null ? null : active?.includes(tag) ? active.filter(t => t !== tag) : [tag, ...active || []];
    setActive(newTags);
    onChange?.(newTags);
  }
  return (
    <div className="catalogue-chips scroll-shadow-x" role="radiogroup">
      <button
        type="button"
        role="radio"
        aria-checked={active === null}
        className={active === null ? 'active' : ''}
        onClick={() => handleToggle(null)}
      >
        <T>common.literal.all</T>
      </button>
      {tags?.filter((group) => group.slug == 'field').flatMap((group) =>
        group.tags.map((tag) => {
          const compound = `${group.slug}:${tag.slug}`
          const isActive = active?.includes(compound)
          return (
            <button
              key={compound}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={isActive ? 'active' : ''}
              onClick={() => handleToggle(compound)}
            >
              {tag.label}
            </button>
          )
        })
      )}
    </div>
  )
}
