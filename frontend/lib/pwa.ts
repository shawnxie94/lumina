type LocationLike = Pick<Location, "hostname" | "href">;

type ServiceWorkerRegistrationLike = {
  active?: { scriptURL?: string } | null;
  unregister: () => Promise<boolean>;
};

type ServiceWorkerContainerLike = {
  getRegistrations: () => Promise<readonly ServiceWorkerRegistrationLike[]>;
  register: (scriptURL: string) => Promise<unknown>;
};

type CacheStorageLike = {
  keys: () => Promise<string[]>;
  delete: (cacheName: string) => Promise<boolean>;
};

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PWA_CACHE_PREFIXES = ["lumina-", "workbox-precache", "workbox-runtime"];

export function shouldDisablePwaForLocation(locationLike: LocationLike | null | undefined): boolean {
  if (!locationLike?.hostname) {
    return false;
  }
  return LOCALHOST_HOSTNAMES.has(locationLike.hostname);
}

export async function clearPwaCaches(cacheStorage: CacheStorageLike): Promise<boolean> {
  const cacheNames = await cacheStorage.keys();
  const pwaCacheNames = cacheNames.filter((cacheName) =>
    PWA_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix)),
  );

  if (pwaCacheNames.length === 0) {
    return false;
  }

  const results = await Promise.all(pwaCacheNames.map((cacheName) => cacheStorage.delete(cacheName)));
  return results.some(Boolean);
}

export async function resetLocalPwaState(options: {
  location: LocationLike;
  serviceWorker?: ServiceWorkerContainerLike | null;
  cacheStorage?: CacheStorageLike | null;
}): Promise<boolean> {
  if (!shouldDisablePwaForLocation(options.location)) {
    return false;
  }

  let changed = false;

  if (options.serviceWorker) {
    const registrations = await options.serviceWorker.getRegistrations();
    if (registrations.length > 0) {
      const results = await Promise.all(
        registrations.map((registration) => registration.unregister()),
      );
      changed = changed || results.some(Boolean) || registrations.length > 0;
    }
  }

  if (options.cacheStorage) {
    changed = (await clearPwaCaches(options.cacheStorage)) || changed;
  }

  return changed;
}

export async function syncPwaRegistration(options: {
  location: LocationLike;
  serviceWorker?: ServiceWorkerContainerLike | null;
  cacheStorage?: CacheStorageLike | null;
}): Promise<"disabled" | "registered" | "unchanged"> {
  const {
    location,
    serviceWorker = null,
    cacheStorage = null,
  } = options;

  if (!serviceWorker) {
    return "unchanged";
  }

  if (shouldDisablePwaForLocation(location)) {
    await resetLocalPwaState({ location, serviceWorker, cacheStorage });
    return "disabled";
  }

  const registrations = await serviceWorker.getRegistrations();
  const hasLuminaServiceWorker = registrations.some((registration) =>
    registration.active?.scriptURL?.includes("/sw.js"),
  );
  if (hasLuminaServiceWorker) {
    return "unchanged";
  }

  await serviceWorker.register("/sw.js");
  return "registered";
}

export function buildLocalPwaCleanupScript(): string {
  const hostnames = JSON.stringify(Array.from(LOCALHOST_HOSTNAMES));
  const prefixes = JSON.stringify(PWA_CACHE_PREFIXES);
  return `
(function () {
  try {
    var localHosts = ${hostnames};
    if (localHosts.indexOf(window.location.hostname) === -1) return;
    if (!("serviceWorker" in navigator)) return;
    var cachePrefixes = ${prefixes};
    var clearCaches = function () {
      if (!("caches" in window)) return Promise.resolve();
      return caches.keys().then(function (cacheNames) {
        var targets = cacheNames.filter(function (cacheName) {
          return cachePrefixes.some(function (prefix) {
            return cacheName.indexOf(prefix) === 0;
          });
        });
        return Promise.all(targets.map(function (cacheName) {
          return caches.delete(cacheName);
        }));
      });
    };
    navigator.serviceWorker.getRegistrations()
      .then(function (registrations) {
        return Promise.all(registrations.map(function (registration) {
          return registration.unregister();
        }));
      })
      .then(clearCaches)
      .catch(function () {});
  } catch (error) {}
})();
`.trim();
}
