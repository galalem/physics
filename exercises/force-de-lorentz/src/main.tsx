import { defineExercise } from '@physics/sdk'
import Scene from './Scene'

const config = {
  id: 'force-de-lorentz',
  version: '0.1.0',
  render: Scene,
}

if (import.meta.env.DEV) {
  const { withPreview } = await import('@physics/preview')
  withPreview(config)
} else {
  defineExercise(config)
}
