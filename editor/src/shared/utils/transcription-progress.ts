export type TranscriptionProgressStage = 'queued' | 'loading' | 'decoding' | 'transcribing'

export interface TranscriptionProgressSnapshot {
  stage: TranscriptionProgressStage
  progress: number
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress))
}

// Band widths reflect real wall-clock cost, not pipeline step count. Audio decode
// is ~1 s and model warmup ~6 s, while inference dominates (tens of seconds, scaling
// with duration). Giving the two prep stages a thin combined 14% keeps the bar from
// parking near "Preparing audio" while the model warms up; transcription owns the
// rest so the long phase is what actually fills the bar. Loading and decoding stay
// sequential (loading below decoding) so the monotonic merge never steps backward.
export function getTranscriptionOverallProgress(snapshot: TranscriptionProgressSnapshot): number {
  const normalizedProgress = clampProgress(snapshot.progress)

  switch (snapshot.stage) {
    case 'queued':
      return 0
    case 'loading':
      return normalizedProgress * 0.08
    case 'decoding':
      return 0.08 + normalizedProgress * 0.06
    case 'transcribing':
      return 0.14 + normalizedProgress * 0.86
  }
}

export function getTranscriptionOverallPercent(snapshot: TranscriptionProgressSnapshot): number {
  return getTranscriptionOverallProgress(snapshot) * 100
}

export function mergeTranscriptionProgress(
  previous: TranscriptionProgressSnapshot | undefined,
  next: TranscriptionProgressSnapshot,
): TranscriptionProgressSnapshot {
  const normalizedNext = {
    stage: next.stage,
    progress: clampProgress(next.progress),
  } satisfies TranscriptionProgressSnapshot

  if (!previous) {
    return normalizedNext
  }

  return getTranscriptionOverallProgress(normalizedNext) >=
    getTranscriptionOverallProgress(previous)
    ? normalizedNext
    : previous
}

export function getTranscriptionStageLabel(stage: TranscriptionProgressStage): string {
  switch (stage) {
    case 'queued':
      return 'Queued'
    case 'loading':
      return 'Loading model'
    case 'decoding':
      return 'Preparing audio'
    case 'transcribing':
      return 'Transcribing'
  }
}
