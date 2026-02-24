const defaultRuntimeCaching = require("next-pwa/cache");
const withPWA = require("next-pwa")({
	dest: "public",
	disable: process.env.NODE_ENV === "development",
	register: true,
	skipWaiting: true,
	runtimeCaching: [
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
		...defaultRuntimeCaching,
	],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: false,
	output: "standalone",
	images: {
		unoptimized: true,
	},
	async rewrites() {
		return [
			{
				source: "/admin/:path*",
				destination: "/admin",
			},
		];
	},
	transpilePackages: [
		"antd",
		"@ant-design/icons",
		"@ant-design/icons-svg",
		"@ant-design/cssinjs",
		"rc-util",
		"rc-pagination",
		"rc-picker",
		"rc-trigger",
		"rc-dropdown",
		"rc-select",
		"rc-tree",
		"rc-table",
		"rc-tooltip",
		"rc-notification",
		"rc-motion",
		"rc-virtual-list",
		"rc-resize-observer",
		"rc-input-number",
		"rc-dialog",
	],
};

module.exports = withPWA(nextConfig);
