import type { DocPageContent } from '../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Workspaces and Storage',
  description: 'Workspace folders, permissions, local files, and project storage.',
  category: 'Start',
  sections: [
    {
      title: 'Workspace model',
      items: [
        'A workspace is the folder FreeCut can read from and write to.',
        'Project data, generated assets, transcripts, scene cuts, caches, and exports live there.',
        'Imported local media remains linked from disk unless packaged into a project bundle.',
      ],
    },
    {
      title: 'Permissions',
      items: [
        'The browser may ask FreeCut to reconnect to the workspace between sessions.',
        'Use Reconnect to grant access to the same folder.',
        'Use Choose a different folder when the workspace moved or no longer exists.',
      ],
    },
    {
      title: 'Maintenance',
      items: [
        'Switch, add, or remove known workspaces from the Workspaces control.',
        'Clear cache data without deleting source media.',
        'Use project bundles when a project needs to move with its media files.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
