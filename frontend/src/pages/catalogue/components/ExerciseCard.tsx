import { T } from '@galalem/react-localization'
import { Link } from '@galalem/react-router'
import { MathText, type Skeletonable } from '~/components'
import { useTags } from '~/hooks'
import type { Exercise } from '../types'

export interface ExerciseCardProps extends Skeletonable {
  exercise?: Exercise
}

// Continue > Replay > Play — resumable in-flight attempts win, then
// "you've done this before, want another run?", then the default.
function ctaKey(exercise: Exercise): string {
  if (exercise.resumable) return 'pages.catalogue.continue'
  if (exercise.completed) return 'pages.catalogue.replay'
  return 'pages.catalogue.play'
}

function Skeleton() {
  return (
    <Link to="#" className="exercise-card text-reset text-decoration-none placeholder-wave">
      <header>
        <span className="placeholder w-100 h-100"></span>
      </header>
      <div className="body">
        <h3>
          <span className="placeholder w-100"></span>
        </h3>
        <div className="tag-chips scroll-shadow-x">
          {Array.from(new Array(3)).map((_, i) => (
            <span key={i} className="font-monospace placeholder">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
          ))}
        </div>
        <div className="footer font-monospace">
          <span>
            ... <T>pages.catalogue.stages</T>
          </span>
          <span className="play-link">
            <T>pages.catalogue.play</T> <span className="icon-rtl-flip">→</span>
          </span>
        </div>
      </div>
    </Link>
  )
}

// field is shown as the header domain, so the remaining chips render pattern first, then level.
const CHIP_GROUP_ORDER = ['pattern', 'level']
const chipRank = (compound: string) => {
  const i = CHIP_GROUP_ORDER.indexOf(compound.split(':')[0] ?? '')
  return i === -1 ? CHIP_GROUP_ORDER.length : i
}

function Content({ exercise }: { exercise: Exercise }) {
  const { labelTag } = useTags()
  // Playable = free tier for anyone, or a paid tier the user has entitlement
  // for (accessible=true). Absent `accessible` on unauth'd list responses
  // still lights up free-tier exercises.
  const isPlayable = exercise.tier === 'free' || exercise.accessible === true

  const domainCompound = exercise.tags.find((t) => t.startsWith('field:'))
  const domainLabel = domainCompound ? labelTag(domainCompound) : null

  const nonDomainTags = exercise.tags
    .filter((t) => !t.startsWith('field:'))
    .sort((a, b) => chipRank(a) - chipRank(b))

  return (
    <Link to={`/exercises/${exercise.slug}`} className="exercise-card text-reset text-decoration-none">
      <header>
        {isPlayable && (
          <span className="badge-featured font-monospace text-uppercase">
            <T>pages.catalogue.playable_now</T>
          </span>
        )}
        <span className="formula font-monospace"><MathText stacked>{exercise.formula}</MathText></span>
        {domainLabel && (
          <span className="domain font-monospace text-uppercase">{domainLabel}</span>
        )}
      </header>
      <div className="body">
        <h3>{exercise.title}</h3>
        <div className="tag-chips scroll-shadow-x">
          {nonDomainTags.map((compound) => {
            const label = labelTag(compound) ?? compound
            return (
              <span key={compound} className="font-monospace">
                {label}
              </span>
            )
          })}
        </div>
        <div className="footer font-monospace">
          <span>
            3 <T>pages.catalogue.stages</T>
          </span>
          <span className="play-link">
            <T>{ctaKey(exercise)}</T> <span className="icon-rtl-flip">→</span>
          </span>
        </div>
      </div>
    </Link>
  )
}

export function ExerciseCard({ exercise, skeleton }: ExerciseCardProps) {
  if (skeleton || !exercise) return <Skeleton />
  return <Content exercise={exercise} />
}
