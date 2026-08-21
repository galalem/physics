import { T } from '@galalem/react-localization'
import type { Exercise } from '../types'
import { ExerciseCard } from './ExerciseCard'

interface Props {
  titleKey: string
  exercises: Exercise[]
}

// Titled horizontally-scrollable strip. Renders nothing when empty so
// callers can list all three rails unconditionally.
export function RailSection({ titleKey, exercises }: Props) {
  if (exercises.length === 0) return null
  return (
    <>
      <div className="catalogue-count">
        <span className="font-monospace text-uppercase">
          <T>{titleKey}</T>
        </span>
        <span className="font-monospace">
          {exercises.length} <T>pages.catalogue.topics</T>
        </span>
      </div>
      <div className="catalogue-rail scroll-shadow-x">
        {exercises.map((ex) => (
          <ExerciseCard key={ex.slug} exercise={ex} />
        ))}
      </div>
    </>
  )
}
