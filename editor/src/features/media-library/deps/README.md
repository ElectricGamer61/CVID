# media-library/deps

Media-library-local adapters for external feature dependencies.

- `timeline-contract.ts`: broader internal media-library->timeline seam binding
  for modules that still need a mixed timeline surface.
- `timeline-stores-contract.ts`: narrow internal media-library->timeline store
  seam binding.
- `timeline-stores.ts`: timeline stores/types used by media-library modules.
- `timeline-actions-contract.ts`: narrow internal media-library->timeline action
  seam binding.
- `timeline-caption-utils-contract.ts`: narrow internal media-library->timeline
  caption utility seam binding.
- `timeline-utils.ts`: timeline utility helpers used by media-library modules.
- `timeline-services-contract.ts`: narrow internal media-library->timeline
  service seam binding.
- `timeline-services.ts`: narrow timeline service helpers used by
  media-library modules.
- `projects.ts`: the preferred entry point for media-library modules that need
  project metadata/state stores.
- `storage.ts`: the preferred entry point for media-library modules that need
  workspace-backed storage APIs; keep direct `workspace-fs/*` imports out of
  services.
