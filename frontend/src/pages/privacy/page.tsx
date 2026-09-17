import { useLocale } from '@galalem/react-localization'
import { MarkdownDoc } from '~/components'
import { useDocumentHead } from '~/hooks'
import { LEGAL_VARS } from '~/lib/legal-vars'

const sources = import.meta.glob('./privacy.*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function PrivacyPage() {
  const { locale, __ } = useLocale()
  useDocumentHead({
    title: __('seo.privacy.title'),
    description: __('seo.privacy.description'),
    path: '/privacy',
  })
  return <MarkdownDoc sources={sources} locale={locale ?? 'en'} vars={LEGAL_VARS} />
}
