import { defineExercise } from '@physics/sdk'
import Scene from './Scene'

const config = {
  id: 'superposition-champs-electriques',
  version: '0.0.0',
  render: Scene,
}

if (import.meta.env.DEV) {
  const { withPreview } = await import('@physics/preview')
  withPreview(config)
} else {
  defineExercise(config)
}
