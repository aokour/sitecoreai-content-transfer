// Build-time feature flags. NEXT_PUBLIC_* vars are inlined by Next.js at
// build time, so these are plain constants, not something read dynamically
// at runtime — flipping one requires a rebuild/restart of the dev server.

/**
 * Allows a local Docker environment to be selected as a transfer/restore
 * *destination*. Off by default: the Content Transfer API's chunk-staging
 * pipeline requires a valid Azure Blob Storage connection string configured
 * on the destination container, which most local Docker setups won't have —
 * set this in your own .env.local (or the deployment's env vars) once
 * that's configured, to re-enable it for your own testing.
 */
export const ALLOW_LOCAL_DOCKER_DESTINATION =
  process.env.NEXT_PUBLIC_ALLOW_LOCAL_DOCKER_DESTINATION === "true";
