import Head from "next/head";
import Link from "next/link";

import { useI18n } from "@/lib/i18n";

export default function OfflinePage() {
	const { language } = useI18n();
	const isEnglish = language === "en";

	return (
		<>
			<Head>
				<title>{isEnglish ? "Offline | Lumina" : "离线状态 | Lumina"}</title>
			</Head>
			<main className="min-h-screen bg-app px-4 py-10 flex items-center justify-center">
				<section className="w-full max-w-xl rounded-2xl border border-border-strong bg-surface shadow-md p-8 text-center">
					<h1 className="text-3xl font-semibold text-text-1">
						{isEnglish ? "You are offline" : "你当前处于离线状态"}
					</h1>
					<p className="mt-3 text-base text-text-2">
						{isEnglish
							? "Lumina cannot reach the network right now. You can return to home or retry once online."
							: "Lumina 当前无法连接网络。你可以返回首页，或在联网后重试。"}
					</p>
					<div className="mt-6 flex flex-wrap gap-3 justify-center">
						<Link
							href="/"
							className="inline-flex items-center rounded-full border border-border-strong px-5 py-2.5 text-sm font-medium text-text-1 hover:border-primary hover:text-primary transition"
						>
							{isEnglish ? "Back to Home" : "返回首页"}
						</Link>
						<button
							type="button"
							onClick={() => window.location.reload()}
							className="inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition"
						>
							{isEnglish ? "Retry" : "重试"}
						</button>
					</div>
				</section>
			</main>
		</>
	);
}
