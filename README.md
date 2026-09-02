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

## Release

Release Please creates releases from `main`. npm publication uses GitHub
Actions trusted publishing without a repository npm token.

## License

PolyForm Noncommercial 1.0.0. Commercial use requires a separate license from
Echo Vision Lab. See [LICENSE.md](LICENSE.md).
