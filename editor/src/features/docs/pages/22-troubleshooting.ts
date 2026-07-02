import type { DocPageContent } from '../docs-content'

const page = {
  order: 22,
  slug: 'troubleshooting',
  title: 'Troubleshooting',
  description: 'Browser, workspace, media, WebGPU, AI, import, and export issues.',
  category: 'Reference',
  sections: [
    {
      title: 'Browser and workspace',
      items: [
        'Use Chrome or Edge 113+ when the workspace picker is unavailable.',
        'Enable Brave File System Access API if Brave cannot choose a workspace folder.',
        'Reconnect the workspace when browser permission expires.',
        'Choose a normal writable folder when permission is denied.',
      ],
    },
    {
      title: 'Media issues',
      items: [
        'Relink missing media with Grant Access, Locate, Locate Folder, or Browse Another Folder.',
        'Use Work Offline only when you intend to repair broken references later.',
        'Try another browser-supported format when import fails or codec support is missing.',
        'Regenerate proxies, thumbnails, transcripts, or cache data when derived files are stale.',
      ],
    },
    {
      title: 'AI and export issues',
      items: [
        'Use a browser and GPU configuration that supports WebGPU for accelerated and local AI workflows.',
        'Retry or clear Local AI Model Cache when model downloads fail.',
        'Choose another export codec, format, resolution, or quality when preflight reports encoder support issues.',
        'Keep the tab focused during main-thread fallback exports.',
        'Export a shorter in/out range when files are large or renders are slow.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
