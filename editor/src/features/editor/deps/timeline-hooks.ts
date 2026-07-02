/**
 * Adapter exports for timeline hook dependencies.
 * Editor modules should import timeline feature hooks from here.
 */

export {
  useTimelineShortcuts,
  useTransitionBreakageNotifications,
  useFilmstrip,
} from './timeline-contract'
export type { FilmstripFrame } from './timeline-contract'
