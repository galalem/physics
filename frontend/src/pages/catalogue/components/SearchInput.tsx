import { useLocale } from '@galalem/react-localization'

export function SearchInput({
  query,
  onChange,
}: {
  query: string
  onChange: (q: string) => void
}) {
  const { __ } = useLocale()

  return (
    <div className="catalogue-search__input">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="7" stroke="currentColor" strokeWidth="2" />
        <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={__('pages.catalogue.search_placeholder')}
        aria-label={__('pages.catalogue.search_placeholder')}
      />
    </div>
  )
}
