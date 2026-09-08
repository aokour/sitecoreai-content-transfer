# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server at https://localhost:3000
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint
```

> The app uses `https://localhost:3000` (not http). `@/*` resolves to the repo root (tsconfig path alias).

## Architecture

This is a **Next.js 16 app-router** application for transferring content between SitecoreAI environments. All orchestration runs **entirely in the browser** — there is no server-side persistence or database. API calls go directly to SitecoreAI via the Marketplace SDK. (`app/api/**` exists only as empty, git-untracked scaffolding directories — no `route.ts` files, no real backend routes.)

### Core Flow

**Dashboard** (`app/page.tsx`) → environment quick-launch → **Transfer Wizard** (`app/transfer/new/page.tsx`, all client-side in `components/content-transfer/transfer-wizard.tsx`)

There is no separate transfer-detail route — the wizard is a single page driven by `currentStep` (0-3):
0. **Environments** — select source and destination tenants
1. **Items** — pick item paths via the dual tree, scope (item only vs. item + descendants), and merge strategy
2. **Review** — confirm configuration
3. **Progress** — kicks off the transfer on entry and polls to completion/failure in place (`useContentTransfer`)

No transfer history is persisted anywhere (no localStorage, no `TransferRecord` type) — leaving the progress step abandons that transfer's state.

### Key Hooks (`hooks/`)

- **`use-content-transfer.ts`** — orchestrates the entire transfer lifecycle in 5 phases: Creating → Preparing (polls source until packaged) → Transferring (streams binary chunks source→destination) → Importing (polls destination until imported) → Completed/Failed
- **`use-transfer-status.ts`** — polls transfer status every 3 seconds, 6-minute timeout
- **`use-dual-tree.ts`** — drives the side-by-side source/destination item tree picker. Fetches children from both environments in parallel per path, merging into `DualTreeNode[]` flagged `existsInSource`/`existsInDestination`/`isDifferent` (via `__Revision`/`__Updated`). Paginates 1000 items/page per side with cursors tracked in a ref, only refetching sides with more pages. Distinguishes hard errors (whole side query failed) from partial errors (GraphQL null-propagated a single broken item) per path/side; retry is a manual refetch.
- **`use-item-fields.ts`** — fetches all fields for an item from both environments via GraphQL and builds a `FieldComparison[]` diff (flags standard `__`-prefixed fields), powering `item-field-comparison.tsx`
- **`use-environments.ts`** — thin wrapper reading `appContext.resourceAccess` into `ResourceAccessEntry[]`

### Binary Chunk Streaming

The transfer streams binary data as `Blob` objects (not `ArrayBuffer`) to preserve integrity. Chunks are assembled on the destination side. This is a critical detail when modifying the transfer logic.

### Types and Constants

Shared types (`TransferConfig`, `TransferPhase`, `DataTreeItem`, `ResourceAccessEntry`, etc.) and constants (polling intervals, merge strategies, scope options) are in `lib/content-transfer.ts`.

### Sitecore Marketplace SDK

The SDK client and app context are provided via React Context in `components/providers/marketplace.tsx`. Access via the `useMarketplace` hook. SDK documentation is in `docs/Sitecore_XMC_MARKETPLACE_SDK_GUIDE.md`.

### UI

shadcn/ui components (Radix UI + Tailwind) live in `components/ui/`. The style is "new-york". Add new shadcn components with `npx shadcn@latest add <component>`. Transfer-specific components are in `components/content-transfer/` (notably `sitecore-item-tree.tsx` / `sitecore-tree-picker.tsx` for the dual tree, `item-field-comparison.tsx`).
