// Build-time feature flags. NEXT_PUBLIC_* vars are inlined by Next.js at
// build time, so these are plain constants, not something read dynamically
// at runtime — flipping one requires a rebuild/restart of the dev server.

/**
 * Enables local Docker SitecoreAI environments everywhere — registering them,
 * and using them as a transfer/backup/restore source or destination. Off by
 * default: this capability is available on request from Americaneagle.com
 * (see LOCAL_DOCKER_CONTACT_URL). Note that using one as a *destination* also
 * needs a valid Azure Blob Storage connection string configured on that
 * container, since the Content Transfer API's chunk-staging pipeline uses it.
 */
export const LOCAL_DOCKER_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DOCKER === "true";

/** Where users are pointed to request local Docker support. */
export const LOCAL_DOCKER_CONTACT_URL = "https://www.americaneagle.com";
