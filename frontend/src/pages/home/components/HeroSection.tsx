import { T } from '@galalem/react-localization'
import { Link } from '@galalem/react-router'
import { useState } from 'react'
import { HeroReflectionDemo } from './HeroReflectionDemo'

export function HeroSection() {
  const [litCount, setLitCount] = useState(0)

  return (
    <div className="hero-grid">
      <div>
        <div className="hero-eyebrow font-monospace d-flex align-items-center mb-3">
          <span />
          <T>pages.home.hero_eyebrow</T>
        </div>
        <h1 className="hero-title m-0">
          <T>pages.home.hero_title</T>
        </h1>
        <p className="hero-sub">
          <T>pages.home.hero_sub</T>
        </p>
        <div className="d-flex flex-wrap" style={{ gap: '12px' }}>
          <Link to="/exercises/reflexion-lumiere" className="btn btn-primary rounded-pill hero-cta">
            <T>pages.home.hero_cta</T>
          </Link>
          <a href="#how" className="btn btn-outline-dark rounded-pill hero-cta">
            <T>pages.home.hero_how</T>
          </a>
        </div>
      </div>

      <div className="hero-canvas">
        <div className="hero-canvas__label hero-canvas__label--top-start">
          <T>pages.home.hero_canvas_label</T>
        </div>
        <div className="hero-canvas__lit-count">
          {litCount}/2 <T>pages.home.hero_lit</T>
        </div>
        <HeroReflectionDemo onLitChange={setLitCount} />
        <div className="hero-canvas__label hero-canvas__label--bottom-start">
          <T>pages.home.hero_try</T>
        </div>
        <div className="hero-canvas__label hero-canvas__label--bottom-end">θᵢ = θᵣ</div>
      </div>
    </div>
  )
}
