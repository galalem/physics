import { T, useLocale } from '@galalem/react-localization'
import { useEffect, useMemo, useState } from 'react'
import { bread } from '~/lib/api'
import { TagChips } from './components/TagChips'
import { ExerciseCard } from './components/ExerciseCard'
import { RailSection } from './components/RailSection'
import { SearchInput } from './components/SearchInput'
import type { Exercise } from './types'
import './styles.scss'
import { useMe } from '~/hooks'


function Paginator({ page, size, total, onChange }: { page: number, size: number, total: number, onChange: (page:number) => void }) {
  const { __ } = useLocale()
  const pages = Math.max(Math.ceil(total / size), 1)
  const first = page == 1
  const last = page >= pages
  const go = (p: number) => onChange(Math.min(Math.max(p, 1), pages))
  return (
    <nav className="mt-4" aria-label={__('pages.catalogue.pagination_label')}>
      <ul className="pagination justify-content-center">
        <li className={`page-item ${first ? 'disabled' : ''}`}>
          <a className="page-link" href="#catalogue" onClick={() => go(1)}>
            <i className="bi bi-chevron-double-left"></i>
          </a>
        </li>
        <li className={`page-item ${first ? 'disabled' : ''}`}>
          <a className="page-link" href="#catalogue" onClick={() => go(page - 1)}>
            <i className="bi bi-chevron-left"></i>
          </a>
        </li>
        {Array.from(new Array(pages)).map((_, i) => {
          const isCurrent = i == page - 1
          return (
            <li key={i} className={`page-item ${isCurrent ? 'active' : ''}`} aria-current={isCurrent ? 'page' : undefined}>
              <a className="page-link" href="#catalogue" onClick={() => go(i + 1)}>{i + 1}</a>
            </li>
          )
        })}
        <li className={`page-item ${last ? 'disabled' : ''}`}>
          <a className="page-link" href="#catalogue" onClick={() => go(page + 1)}>
            <i className="bi bi-chevron-right"></i>
          </a>
        </li>
        <li className={`page-item ${last ? 'disabled' : ''}`}>
          <a className="page-link" href="#catalogue" onClick={() => go(pages)}>
            <i className="bi bi-chevron-double-right"></i>
          </a>
        </li>
      </ul>
    </nav>
  )
}

export function CataloguePage() {
  const { locale } = useLocale()
  const { me } = useMe()
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[] | null>(null) // compound family:slug or null = "All"

  const [exercises, setExercises] = useState<Exercise[]>([]);

  useEffect(() => {
    let cancelled = false
    bread.read<Exercise[]>('', 'exercises') // usually browsing should go through `bread.browse` but the public catalogue is an exception
    .then((res) => {
      if (!cancelled && !res.error) setExercises(res.content)
    })

    return () => { cancelled = true }
    // me?.id in deps so login/logout (and cross-user switches) trigger
    // a refetch — auth-only fields (accessible/completed/resumable/…)
    // must reflect the current session.
  }, [locale, me?.id]);

  const result = useMemo(() => {
    return exercises.filter(e => {
      return e.title.toLowerCase().includes(query.toLowerCase())
      && (activeTags || []).every(tag => e.tags.includes(tag))
    });
  }, [exercises, query, activeTags])

  const resumable = useMemo(() => result.filter(e => e.resumable), [result]);
  const completed = useMemo(() => result.filter(e => e.completed && !e.resumable), [result]);
  const recommended = useMemo(() => result.filter(e => e.accessible && !e.completed && !e.resumable).sort((a, b) => {
    const score = (ex:Exercise) => result.reduce((s:number, r:Exercise) => {
      if (!(r.completed || r.resumable)) return s;
      return s
        + (r.recommendations?.before.includes(ex.slug) ? 1 : 0)
        + (r.recommendations?.after.includes(ex.slug) ? 1 : 0)
    }, 0)
    return score(b) - score(a)
  }).slice(0, 4), [result]);

  useEffect(() => { setPage(1) }, [query, activeTags])

  const isLoading = !exercises.length
  const isEmpty = !isLoading && result.length === 0
  const hasActiveFilters = query.trim() !== '' || (activeTags?.length ?? 0) > 0

  const clearFilters = () => {
    setQuery('')
    setActiveTags(null)
  }

  return (
    <div className="catalogue">
      <div className="catalogue-search">
        <SearchInput query={query} onChange={setQuery} />
        <TagChips activeTags={activeTags} onChange={setActiveTags}/>
      </div>

      {me && result.length > 0 && (
        <>
          <RailSection titleKey="pages.catalogue.resume"      exercises={resumable} />
          <RailSection titleKey="pages.catalogue.recommended" exercises={recommended} />
          <RailSection titleKey="pages.catalogue.completed"   exercises={completed} />
        </>
      )}

      <div className="catalogue-count">
        <span className="font-monospace text-uppercase">
          <T>pages.catalogue.catalogue</T>
        </span>
        <span className="font-monospace">
          {result.length ?? '—'} <T>pages.catalogue.topics</T>
        </span>
      </div>

      {isEmpty ? (
        <div className="catalogue-empty">
          <i className="bi bi-search" aria-hidden="true" />
          <h2><T>pages.catalogue.empty_title</T></h2>
          <p><T>pages.catalogue.empty_body</T></p>
          {hasActiveFilters && (
            <button type="button" className="btn btn-primary rounded-pill" onClick={clearFilters}>
              <T>pages.catalogue.empty_clear</T>
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="catalogue-grid" aria-busy={isLoading}>
            {result.slice((page - 1) * 12, page * 12).map((exercise) => (
              <ExerciseCard key={exercise.slug} exercise={exercise} />
            ))}
            {isLoading && Array.from(new Array(12)).map((_, i) => (
              <ExerciseCard key={i} skeleton />
            ))}
          </div>

          <Paginator page={page} size={12} total={result.length} onChange={setPage} />
        </>
      )}
    </div>
  )
}

