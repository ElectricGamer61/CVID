import type { DocPageContent } from '../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: 'Exporting',
  description: 'Render video or audio locally with formats, codecs, ranges, and preflight.',
  category: 'Output',
  sections: [
    {
      title: 'Export setup',
      items: [
        'Choose Export Video for rendered video.',
        'Choose Export Audio for audio-only output.',
        'Render the whole project or the current in/out range.',
        'Choose resolution and quality based on review, sharing, or final delivery needs.',
      ],
    },
    {
      title: 'Formats and codecs',
      items: [
        'Video containers include MP4, MOV, WebM, and MKV.',
        'Audio formats include MP3, AAC, and WAV.',
        'Codec availability depends on the current browser.',
        'FreeCut can warn or fall back when a selected codec is unavailable.',
      ],
    },
    {
      title: 'Preflight and progress',
      items: [
        'Fix missing media before exporting.',
        'Review empty range, codec, worker fallback, large file, and long export warnings.',
        'Keep the tab open until export completes.',
        'Download the finished file when the export is complete.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
