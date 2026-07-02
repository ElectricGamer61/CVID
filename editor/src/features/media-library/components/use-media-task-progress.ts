import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getTranscriptionOverallProgress,
  getTranscriptionStageLabel,
} from '@/shared/utils/transcription-progress'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { useMediaPreparationStore } from '../stores/media-preparation-store'

/**
 * Derives all background-task progress display state (proxy generation,
 * transcription, AI analysis, and media preparation): aggregate counts, average
 * progress, single-item stage labels, and the per-item rows shown when a
 * progress bar is expanded. Pure derivations extracted verbatim from
 * `MediaLibrary`; reads its own store slices.
 */
export function useMediaTaskProgress() {
  const { t } = useTranslation()
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus)
  const proxyProgress = useMediaLibraryStore((s) => s.proxyProgress)
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus)
  const transcriptProgress = useMediaLibraryStore((s) => s.transcriptProgress)
  const analysisProgress = useMediaLibraryStore((s) => s.analysisProgress)
  const mediaById = useMediaLibraryStore((s) => s.mediaById)
  const preparationTasks = useMediaPreparationStore((s) => s.tasks)

  const generatingCount = useMemo(() => {
    let count = 0
    for (const status of proxyStatus.values()) {
      if (status === 'generating') count++
    }
    return count
  }, [proxyStatus])

  const analysisPercent =
    analysisProgress && analysisProgress.total > 0
      ? (analysisProgress.completed / analysisProgress.total) * 100
      : 0

  const activePreparationTasks = useMemo(
    () =>
      [...preparationTasks.values()].filter(
        (task) => task.type !== 'import' && (task.status === 'queued' || task.status === 'running'),
      ),
    [preparationTasks],
  )

  const transcribingCount = useMemo(() => {
    let count = 0
    for (const status of transcriptStatus.values()) {
      if (status === 'queued' || status === 'transcribing') count++
    }
    return count
  }, [transcriptStatus])

  // Average progress of all generating proxies
  const generatingAvgProgress = useMemo(() => {
    if (generatingCount === 0) return 0
    let total = 0
    let count = 0
    for (const [id, status] of proxyStatus.entries()) {
      if (status === 'generating') {
        total += proxyProgress.get(id) ?? 0
        count++
      }
    }
    return count > 0 ? total / count : 0
  }, [proxyStatus, proxyProgress, generatingCount])

  const transcribingAvgProgress = useMemo(() => {
    if (transcribingCount === 0) return 0
    let total = 0
    let count = 0
    for (const [id, status] of transcriptStatus.entries()) {
      if (status === 'queued' || status === 'transcribing') {
        const progress = transcriptProgress.get(id)
        total += progress ? getTranscriptionOverallProgress(progress) : 0
        count++
      }
    }
    return count > 0 ? total / count : 0
  }, [transcriptStatus, transcriptProgress, transcribingCount])

  const singleTranscriptionStageLabel = useMemo(() => {
    if (transcribingCount !== 1) return null
    for (const [id, status] of transcriptStatus.entries()) {
      if (status === 'queued' || status === 'transcribing') {
        const progress = transcriptProgress.get(id)
        return progress ? getTranscriptionStageLabel(progress.stage) : null
      }
    }
    return null
  }, [transcriptStatus, transcriptProgress, transcribingCount])

  // Per-item breakdowns shown when the aggregate progress bar is expanded.
  const proxyItemRows = useMemo(() => {
    const rows: Array<{ id: string; name: string; percent: number }> = []
    for (const [id, status] of proxyStatus.entries()) {
      if (status === 'generating') {
        rows.push({
          id,
          name: mediaById[id]?.fileName ?? id,
          percent: Math.round((proxyProgress.get(id) ?? 0) * 100),
        })
      }
    }
    return rows
  }, [proxyStatus, proxyProgress, mediaById])

  const transcriptionItemRows = useMemo(() => {
    const rows: Array<{ id: string; name: string; percent: number; stage: string | null }> = []
    for (const [id, status] of transcriptStatus.entries()) {
      if (status === 'queued' || status === 'transcribing') {
        const progress = transcriptProgress.get(id)
        rows.push({
          id,
          name: mediaById[id]?.fileName ?? id,
          percent: progress ? Math.round(getTranscriptionOverallProgress(progress) * 100) : 0,
          stage: progress ? getTranscriptionStageLabel(progress.stage) : null,
        })
      }
    }
    return rows
  }, [transcriptStatus, transcriptProgress, mediaById])

  const preparationItemRows = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string
        name: string
        kinds: string[]
        progress: number
        status: 'queued' | 'running'
        taskCount: number
      }
    >()

    for (const task of activePreparationTasks) {
      const kind =
        task.type === 'import'
          ? t('media.library.preparationType.import')
          : task.type === 'filmstrip'
            ? t('media.library.preparationType.filmstrip')
            : t('media.library.preparationType.waveform')
      const existing = groups.get(task.mediaId)
      if (existing) {
        existing.kinds.push(kind)
        existing.progress += task.progress
        existing.taskCount += 1
        if (task.status === 'running') {
          existing.status = 'running'
        }
        continue
      }

      groups.set(task.mediaId, {
        id: task.mediaId,
        name: mediaById[task.mediaId]?.fileName ?? task.mediaId,
        kinds: [kind],
        progress: task.progress,
        status: task.status === 'running' ? 'running' : 'queued',
        taskCount: 1,
      })
    }

    return [...groups.values()].map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kinds.join(' + '),
      percent: Math.round((row.progress / row.taskCount) * 100),
      progress: row.progress / row.taskCount,
      status: row.status,
    }))
  }, [activePreparationTasks, mediaById, t])

  const preparingCount = preparationItemRows.length
  const preparingAvgProgress = useMemo(() => {
    if (preparationItemRows.length === 0) return 0
    const total = preparationItemRows.reduce((sum, row) => sum + row.progress, 0)
    return total / preparationItemRows.length
  }, [preparationItemRows])
  const hasRunningPreparationTasks = preparationItemRows.some((row) => row.status === 'running')

  return {
    analysisProgress,
    analysisPercent,
    generatingCount,
    generatingAvgProgress,
    proxyItemRows,
    transcribingCount,
    transcribingAvgProgress,
    singleTranscriptionStageLabel,
    transcriptionItemRows,
    preparationItemRows,
    preparingCount,
    preparingAvgProgress,
    hasRunningPreparationTasks,
  }
}
