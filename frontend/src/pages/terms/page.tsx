import { useLocale } from '@galalem/react-localization'
import { MarkdownDoc } from '~/components'
import { LEGAL_VARS } from '~/lib/legal-vars'

const sources = import.meta.glob('./terms.*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function TermsPage() {
  const { locale } = useLocale()
  return <MarkdownDoc sources={sources} locale={locale ?? 'en'} vars={LEGAL_VARS} />
}
