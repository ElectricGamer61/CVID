import type { DocPageContent } from '../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Local AI Tools',
  description: 'Browser-side AI models, text-to-speech, music generation, cache, and unload.',
  category: 'Creative Tools',
  sections: [
    {
      title: 'How local AI works',
      items: [
        'Local AI runs in the browser when the required APIs and hardware support are available.',
        'The first model download can be large and is cached locally afterward.',
        'The Local AI status pill shows loading, active, ready, and error states.',
      ],
    },
    {
      title: 'Generation tools',
      items: [
        'Use Text to Speech to synthesize speech from text and insert linked audio.',
        'Choose supported TTS engines, languages, voices, expressive tags, and speed where available.',
        'Use Music Generation with prompts that describe genre, mood, tempo, and instrumentation.',
        'Save generated music to the media library or insert it into the timeline.',
      ],
    },
    {
      title: 'Cache and runtime control',
      items: [
        'Use Local AI Model Cache to inspect or clear cached downloads.',
        'Use Unload Local Models to release resident runtimes.',
        'Cancel long-running jobs when you no longer need the result.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
