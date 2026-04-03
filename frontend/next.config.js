const defaultRuntimeCaching = require("next-pwa/cache");
const { buildRuntimeCaching } = require("./pwaRuntimeCaching");
const normalizeUrl = (value) => (value || "").trim().replace(/\/+$/, "");
const backendRewriteBase =
	process.env.NODE_ENV === "development"
		? "http://localhost:8000/backend"
		: normalizeUrl(process.env.BACKEND_API_URL) ||
		  normalizeUrl(process.env.API_BASE_URL) ||
		  "http://api:8000/backend";

const withPWA = require("next-pwa")({
	dest: "public",
	disable: process.env.NODE_ENV === "development",
	register: true,
	skipWaiting: true,
	runtimeCaching: buildRuntimeCaching(defaultRuntimeCaching),
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
				source: "/backend/:path*",
				destination: `${backendRewriteBase}/:path*`,
			},
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
