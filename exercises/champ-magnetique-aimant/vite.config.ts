import { defineConfig, mergeConfig } from 'vite'
import base from '../../runtime/vite.config.base'

export default mergeConfig(
  base,
  defineConfig({
    // exercise-specific overrides here
  }),
)
