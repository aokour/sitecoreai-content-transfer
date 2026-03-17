# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server at https://localhost:3000
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint
```

> The app uses `https://localhost:3000` (not http). The `.env.local` file configures Auth0/Sitecore Identity and tenant IDs.

## Architecture

This is a **Next.js 16 app-router** application for transferring content between Sitecore XM Cloud environments. All orchestration runs **entirely in the browser** — there is no custom backend. API calls go directly to Sitecore XM Cloud via the Marketplace SDK.

### Core Flow

**Dashboard** (`app/page.tsx`) → user selects source/destination environments → **Transfer Wizard** (`app/transfer/new/page.tsx`) → **Transfer Detail** (`app/transfer/[id]/page.tsx`)

The wizard is 4 steps:
1. **Environments** — select source and destination tenants
2. **Items** — choose item paths, scope (item only vs. item + descendants), and merge strategy
3. **Review** — confirm configuration
4. **Progress** — real-time status polling

### Key Hooks

- **`hooks/use-content-transfer.ts`** — orchestrates the entire transfer lifecycle in 5 phases: Creating → Preparing (polls source until packaged) → Transferring (streams binary chunks source→destination) → Importing (polls destination until imported) → Completed/Failed
- **`hooks/use-transfer-status.ts`** — polls transfer status every 3 seconds, 6-minute timeout
- **`hooks/use-transfer-history.ts`** — localStorage-based persistence of transfer records

### Binary Chunk Streaming

The transfer streams binary data as `Blob` objects (not `ArrayBuffer`) to preserve integrity. Chunks are assembled on the destination side. This is a critical detail when modifying the transfer logic.

### Types and Constants

All shared types (`TransferConfig`, `TransferRecord`, `TransferPhase`, etc.) and constants (polling intervals, merge strategies, scope options) are in `lib/content-transfer.ts`.

### Sitecore Marketplace SDK

The SDK client and app context are provided via React Context in `components/providers/marketplace.tsx`. Access via the `useMarketplace` hook. SDK documentation is in `docs/Sitecore_XMC_MARKETPLACE_SDK_GUIDE.md`.

### UI

shadcn/ui components (Radix UI + Tailwind) live in `components/ui/`. The style is "new-york". Add new shadcn components with `npx shadcn@latest add <component>`. Transfer-specific components are in `components/content-transfer/`.

### State Persistence

Transfer history is stored in **localStorage** only — no database or server-side storage. The `useTransferHistory` hook manages reads/writes.
