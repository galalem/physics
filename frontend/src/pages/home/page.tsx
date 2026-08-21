import { CatalogueSection } from './components/CatalogueSection'
import { ForTeachersSection } from './components/ForTeachersSection'
import { HeroSection } from './components/HeroSection'
import { HowItWorksSection } from './components/HowItWorksSection'
import './styles.scss'

export function HomePage() {
  return (
    <div className="home-page">
      <HeroSection />
      <CatalogueSection />
      <HowItWorksSection />
      <ForTeachersSection />
    </div>
  )
}
