import { defineExercise } from '@physics/sdk'
import Scene from './Scene'

const config = {
  id: 'champ-electrique-charge-ponctuelle',
  version: '0.1.0',
  render: Scene,
}

if (import.meta.env.DEV) {
  const { withPreview } = await import('@physics/preview')
  withPreview(config)
} else {
  defineExercise(config)
}
