import { useTranslation } from 'react-i18next'
import { Timer } from 'lucide-react'

interface DopesheetEmptyStateProps {
  showGuidance: boolean
  fallbackMessage: string
}

export function DopesheetEmptyState({ showGuidance, fallbackMessage }: DopesheetEmptyStateProps) {
  const { t } = useTranslation()

  if (!showGuidance) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {fallbackMessage}
      </div>
    )
  }

  return (
    <div
      data-testid="dopesheet-empty-state-guidance"
      className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <p className="text-sm font-medium text-foreground/90">
        {t('timeline.keyframeEditor.emptyState.title')}
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {t('timeline.keyframeEditor.emptyState.intro')}
      </p>
      <ul className="max-w-sm space-y-1 text-left text-xs text-muted-foreground">
        <li>{t('timeline.keyframeEditor.emptyState.hintValue')}</li>
        <li>{t('timeline.keyframeEditor.emptyState.hintDiamond')}</li>
        <li className="flex items-start gap-1">
          <Timer className="mt-px h-3 w-3 flex-shrink-0" />
          <span>{t('timeline.keyframeEditor.emptyState.hintAutoKey')}</span>
        </li>
      </ul>
    </div>
  )
}
