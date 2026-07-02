# Translation partials

Partials live in per-language subdirectories. Each file contains only that
language's slice of the translation tree (no language wrapper key).

## Layout

```
partials/
  en/          ← eagerly bundled into app-shell at build time
    editor.json
    effects.json
    ...
  de/          ← loaded on demand when the user switches to German
    editor.json
    effects.json
    ...
  es/
  fr/
  ja/
  ko/
  pt-BR/
  tr/
  zh/
```

## File shape

Each file contains the translation slice directly (no language wrapper):

```json
{ "myFeature": { "title": "Title", "save": "Save" } }
```

This is different from the old combined format. Each file is for one language
only and does NOT wrap the content in a `{ "<lang>": ... }` object.

## Usage

In components, reference keys like any other: `t('myFeature.title')`.

Supported language codes: `en`, `es`, `fr`, `de`, `pt-BR`, `ja`, `ko`, `zh`, `tr`.

## Loading strategy

- `en` partials are statically imported (eager) and bundled into `app-shell` —
  English strings are always available synchronously.
- All other languages are loaded on demand via `loadLanguageResources(lang)` or
  `changeAppLanguage(lang)` from `src/i18n/index.ts`. The user's persisted
  language is preloaded before first render via `i18nReady`.

## Adding new strings

When adding a new partial or new keys, create/edit the file in all 9 language
directories (`en`, `es`, `fr`, `de`, `pt-BR`, `ja`, `ko`, `tr`, `zh`).
The structural-parity test in `src/i18n/lazy-locales.test.ts` will catch a
missing language directory for a partial.

Never put a bare ASCII `"` inside a JSON string value.
