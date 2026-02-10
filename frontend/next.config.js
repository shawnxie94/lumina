/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: false,
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

module.exports = nextConfig;
