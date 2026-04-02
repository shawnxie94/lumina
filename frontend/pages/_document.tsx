import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
	return (
		<Html lang="zh-CN">
			<Head />
			<body>
				<Main />
				<script defer src="/runtime-config.js" />
				<NextScript />
			</body>
		</Html>
	);
}
