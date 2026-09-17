import { useLocale } from '@galalem/react-localization'
import { useDocumentHead } from '~/hooks'
import { CatalogueSection } from './components/CatalogueSection'
import { ForTeachersSection } from './components/ForTeachersSection'
import { HeroSection } from './components/HeroSection'
import { HowItWorksSection } from './components/HowItWorksSection'
import './styles.scss'

export function HomePage() {
  const { __ } = useLocale()
  useDocumentHead({
    title: __('seo.home.title'),
    description: __('seo.home.description'),
    path: '/',
  })

  return (
    <div className="home-page">
      <HeroSection />
      <CatalogueSection />
      <HowItWorksSection />
      <ForTeachersSection />
    </div>
  )
}
