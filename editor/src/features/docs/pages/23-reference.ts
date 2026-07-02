import type { DocPageContent } from '../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: 'Reference',
  description: 'Supported formats, terms, controls, preflight messages, and glossary.',
  category: 'Reference',
  sections: [
    {
      title: 'Format reference',
      items: [
        'Import categories include video, audio, image, GIF, SVG, generated assets, and compound clips.',
        'Export containers include MP4, MOV, WebM, and MKV.',
        'Audio exports include MP3, AAC, and WAV.',
        'Codec support depends on browser decode and encode capabilities.',
      ],
    },
    {
      title: 'Editor glossary',
      items: [
        'Ripple edit: edit that closes or opens timeline space by shifting later material.',
        'Rolling edit: edit that moves the cut between two neighboring clips.',
        'Slip edit: edit that changes source timing inside a clip without moving the clip.',
        'Slide edit: edit that moves a clip while adjusting neighboring cuts.',
        'In/out range: marked start and end used for source or export ranges.',
        'Proxy: lighter generated media used for easier preview playback.',
      ],
    },
    {
      title: 'Feature glossary',
      items: [
        'LUT: lookup table used for color transforms.',
        'Keyframe: value at a specific time used to animate a property.',
        'Compound clip: grouped timeline content represented as reusable media.',
        'Adjustment layer: visual layer whose effects apply to items below.',
        'Render queue: ordered list of exports saved to the workspace.',
        'Preflight: export readiness check before rendering starts.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
