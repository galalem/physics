import { T } from '@galalem/react-localization'
import { CataloguePage } from '~/pages/catalogue/page'

export function CatalogueSection() {
  return (
    <section id="catalogue">
        <div className="text-center mx-auto" style={{ maxWidth: '34em', marginBottom: '34px' }}>
            <div className="section-eyebrow font-monospace">
                <T>pages.home.catalogue_eyebrow</T>
            </div>
            <h2 className="section-heading m-0">
                <T>pages.home.catalogue_heading</T>
            </h2>
        </div>

        <CataloguePage />
    </section>
  )
}
