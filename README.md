# Geul common

Shared TypeScript contracts and helpers for Geul editors, collaboration,
localized content, media blocks, pages, posts, and runtime events.

```sh
pnpm add @echovisionlab/geul-common
```

The package exports TypeScript source. Consumers must support `.ts` package
exports. `yjs` is a peer dependency.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm package:smoke
```

`@echovisionlab/geul-proto` is the contract source of truth. For coordinated
local changes, `typecheck:local-contracts` and `test:local-contracts` resolve it
from the sibling `geul-event-contracts` checkout.

## Block Room inline content

Use `reconcileBlockRoomInlineContent` to set rich-text inline runs, including
their marks. It keeps the existing collaborative `Y.Text` handles and projects
character-level Y.Text attributes over the legacy per-run `styles` maps.
Deploy readers of character-level inline attributes before enabling writers.
The Web and Collab consumers use Block-room protocol version 2 to reject an
older editor before admission; the persisted canonical protobuf schema stays
unchanged.

`setAIDocumentField` routes whole inline `content` updates through this same
reconciler. `setBlockRoomAtomicValue` only writes catalog-declared scalar
fields; there is no generic payload-field setter for inline styles.

`replaceBlockRoomCollaborativeText` replaces the entire value of one
collaborative text leaf. It is intended for scalar text fields such as Page
section captions. On an inline text leaf, replacing the whole value also
removes that leaf's character-level Y.Text formatting while leaving any legacy
`styles` map in place. Use the inline reconciler when replacing inline text
that must retain or change marks.

## Release

Release Please creates releases from `main`. npm publication uses GitHub
Actions trusted publishing without a repository npm token.

## License

PolyForm Noncommercial 1.0.0. Commercial use requires a separate license from
Echo Vision Lab. See [LICENSE.md](LICENSE.md).
