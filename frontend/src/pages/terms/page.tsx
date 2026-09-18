import { useLocale } from '@galalem/react-localization'
import { MarkdownDoc } from '~/components'
import { useDocumentHead } from '~/hooks'
import { LEGAL_VARS } from '~/lib/legal-vars'

const sources = import.meta.glob('./terms.*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function TermsPage() {
  const { locale, __ } = useLocale()
  useDocumentHead({
    title: __('seo.terms.title'),
    description: __('seo.terms.description'),
    path: '/terms',
  })
  return <MarkdownDoc sources={sources} locale={locale ?? 'en'} vars={LEGAL_VARS} />
}
