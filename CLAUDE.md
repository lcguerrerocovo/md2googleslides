# md2googleslides

Fork of `googleworkspace/md2googleslides` with template slide support, d2 diagrams, and code block image rendering.

## Build

- **Compile:** `npm run compile` (runs `tsc` for type-checking + `babel` for JS emit to `lib/`)
- **IMPORTANT:** The CLI (`bin/md2gslides.js`) loads from `lib/`, NOT from `src/`. You MUST run `npm run compile` after any source change before testing with the CLI. `tsc` alone does NOT emit files (`noEmit: true` in tsconfig).
- **Tests:** `npx mocha --require ./test/register --timeout 5000 "test/**/*.spec.ts"` (102 tests)
- **Lint:** `npm run lint` (uses gts/eslint — may conflict in worktrees, safe to skip)

## Architecture

- `src/parser/extract_slides.ts` — Markdown-to-slide parser (token handlers for fence, image, heading, etc.)
- `src/parser/env.ts` — `Context` class that accumulates slide state during parsing
- `src/images/generate.ts` — Image renderer registry (`svg`, `math`, `d2`, `code`)
- `src/images/code.ts` — Silicon-based code block renderer (syntax-highlighted PNG)
- `src/images/d2.ts` — D2 diagram renderer
- `src/layout/generic_layout.ts` — Template slide content placement (image_area, text slots)
- `src/slides.ts` — Type definitions (`SlideDefinition`, `ImageDefinition`, `BodyDefinition`)
- `bin/md2gslides.js` — CLI entrypoint (plain JS, requires from `../lib/`)
- `bin/export-thumbnails.js` — Export slide thumbnails as PNG for review

## Key patterns

- Image renderers follow the pattern in `d2.ts`: async function taking `ImageDefinition`, returning output file path
- Register new renderers in `generate.ts`'s `renderers` map
- Template slide code blocks: fence tokens on slides with `templateSlide` set produce `ImageDefinition` with `type: 'code'` instead of inline text
- `Context.images` collects images during parsing; they're flushed to a body in `endSlide()`

## Testing a deck

```bash
# Generate/update a deck
npm run compile && node bin/md2gslides.js path/to/deck.md --use-fileio

# Export thumbnails for visual review
node bin/export-thumbnails.js <PRESENTATION_ID> /tmp/deck-review
```

## Credentials

- OAuth credentials stored at `~/.md2googleslides/`
- GCP project: `hades-xpn`
- Drive API enabled for file upload (`--use-fileio`)
