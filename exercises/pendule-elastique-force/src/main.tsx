import { defineExercise } from '@physics/sdk'
import Scene from './Scene'

const config = {
  id: 'pendule-elastique-force',
  version: '0.1.0',
  render: Scene,
}

if (import.meta.env.DEV) {
  const { withPreview } = await import('@physics/preview')
  withPreview(config)
} else {
  defineExercise(config)
}
