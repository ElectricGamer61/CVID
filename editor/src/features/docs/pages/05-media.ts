import type { DocPageContent } from '../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Media Library',
  description: 'Import media, inspect files, generate proxies, transcripts, and captions.',
  category: 'Core Editing',
  sections: [
    {
      title: 'Import paths',
      items: [
        'Import video, audio, images, GIFs, SVGs, and generated assets.',
        'Drag media files into the Media panel when the browser supports drag and drop.',
        'Use Import Media From URL for direct media-file URLs.',
      ],
    },
    {
      title: 'Media inspection',
      items: [
        'Use Media info to inspect codec, dimensions, duration, frame rate, size, type, and transcript status.',
        'Open media in the Source Monitor before editing it into the timeline.',
        'Sort, filter, and group assets by type when the project library grows.',
      ],
    },
    {
      title: 'Generated support data',
      items: [
        'Generate proxies for heavy video files.',
        'Generate or refresh transcripts for speech text.',
        'Extract embedded subtitles when the file includes subtitle tracks.',
        'Run Analyze with AI to prepare scene and caption workflows.',
      ],
    },
    {
      title: 'Missing media',
      items: [
        'Use Grant Access when the file needs renewed browser permission.',
        'Use Locate or Locate Folder when the source moved.',
        'Use Work Offline only when you intend to relink later.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
