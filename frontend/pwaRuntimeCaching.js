const defaultRuntimeCaching = require("next-pwa/cache");

const DISABLED_DEFAULT_CACHE_NAMES = [
	"apis",
	"next-data",
	"others",
	"static-js-assets",
	"static-style-assets",
];

const isDisabledDefaultCache = (entry) =>
	DISABLED_DEFAULT_CACHE_NAMES.includes(entry?.options?.cacheName);

const buildRuntimeCaching = (fallbackRuntimeCaching = defaultRuntimeCaching) => [
	{
		urlPattern: ({ request }) => request?.mode === "navigate",
		handler: "NetworkOnly",
		method: "GET",
		options: {},
	},
	{
		urlPattern: ({ url }) => url.pathname.startsWith("/_next/data/"),
		handler: "NetworkOnly",
		method: "GET",
		options: {},
	},
	{
		urlPattern: ({ url }) => url.pathname === "/runtime-config.js",
		handler: "NetworkOnly",
		method: "GET",
		options: {},
	},
	{
		urlPattern: ({ url }) => {
			const pathname = url.pathname;
			if (!pathname.startsWith("/backend/api/")) return false;
			if (/^\/backend\/api\/articles(?:\/.*)?$/.test(pathname)) return true;
			return (
				pathname === "/backend/api/sources" ||
				pathname === "/backend/api/authors" ||
				pathname === "/backend/api/categories" ||
				pathname === "/backend/api/categories/stats" ||
				pathname === "/backend/api/settings/basic/public"
			);
		},
		handler: "NetworkFirst",
		method: "GET",
		options: {
			cacheName: "lumina-api-readonly-v1",
			networkTimeoutSeconds: 3,
			cacheableResponse: {
				statuses: [0, 200],
			},
			expiration: {
				maxEntries: 120,
				maxAgeSeconds: 6 * 60 * 60,
			},
		},
	},
	{
		urlPattern: ({ url }) => url.pathname.startsWith("/backend/api/"),
		handler: "NetworkOnly",
		method: "GET",
		options: {},
	},
	{
		urlPattern: ({ url }) => url.pathname.startsWith("/backend/media/"),
		handler: "CacheFirst",
		method: "GET",
		options: {
			cacheName: "lumina-media-v1",
			cacheableResponse: {
				statuses: [0, 200],
			},
			expiration: {
				maxEntries: 120,
				maxAgeSeconds: 7 * 24 * 60 * 60,
			},
		},
	},
	...fallbackRuntimeCaching.filter((entry) => !isDisabledDefaultCache(entry)),
];

module.exports = {
	DISABLED_DEFAULT_CACHE_NAMES,
	buildRuntimeCaching,
};
