import { ApiClient } from "../utils/api";
import { logError } from "../utils/errorLogger";
import { addToHistory } from "../utils/history";
import { htmlToMarkdown } from "../utils/markdownConverter";
import { ensureContentScriptLoaded } from "../utils/contentScript";
import { resolveLanguage, translate } from "../utils/i18n";

const normalizeUrlCandidate = (value: string): string =>
	value
		.trim()
		.replace(/^<|>$/g, "")
		.replace(/[),.;:!?]+$/, "");

const isHttpUrl = (value: string | null | undefined): value is string =>
	Boolean(value && /^https?:\/\/\S+$/i.test(value.trim()));

const extractSelectedUrl = (selectionText: string | undefined): string | null => {
	if (!selectionText) return null;
	const normalized = normalizeUrlCandidate(selectionText);
	return isHttpUrl(normalized) ? normalized : null;
};

const getDomainFromUrl = (value: string): string => {
	try {
		return new URL(value).hostname || "";
	} catch {
		return "";
	}
};

const resolveHttpUrl = (
	value: string | null | undefined,
	baseUrl: string | null | undefined,
): string => {
	const raw = normalizeUrlCandidate(value || "");
	if (!raw) return "";
	try {
		const resolved = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
		if (!/^https?:$/i.test(resolved.protocol)) return "";
		return normalizeUrlCandidate(resolved.href);
	} catch {
		return "";
	}
};

const getContextLinkUrlFromContent = async (tabId: number): Promise<string> => {
	try {
		const response = await chrome.tabs.sendMessage(tabId, {
			type: "GET_LAST_CONTEXT_LINK",
		});
		return typeof response?.url === "string" ? response.url : "";
	} catch {
		return "";
	}
};

const extractLuminaArticleSlug = (
	value: string,
	frontendUrl: string,
): string | null => {
	try {
		const target = new URL(value);
		const frontend = new URL(frontendUrl);
		if (target.origin !== frontend.origin) return null;
		const matched = target.pathname.match(/^\/article\/([^/?#]+)/);
		if (!matched?.[1]) return null;
		return decodeURIComponent(matched[1]);
	} catch {
		return null;
	}
};

export default defineBackground(() => {
	const resetCollectContextMenu = async (language: string): Promise<void> => {
		const t = (key: string) => translate(language, key);
		await new Promise<void>((resolve) => {
			chrome.contextMenus.removeAll(() => resolve());
		});
		chrome.contextMenus.create({
			id: "collect-article",
			title: t("采集到 Lumina"),
			contexts: ["page", "selection", "link"],
		});
	};

	const bootstrapContextMenu = async () => {
		const language = await resolveLanguage();
		await resetCollectContextMenu(language);
	};

	bootstrapContextMenu().catch((error) => {
		logError("background", error instanceof Error ? error : new Error(String(error)), {
			action: "bootstrapContextMenu",
		});
	});

	chrome.runtime.onInstalled.addListener(() => {
		bootstrapContextMenu().catch((error) => {
			logError("background", error instanceof Error ? error : new Error(String(error)), {
				action: "onInstalledContextMenu",
			});
		});
	});
	chrome.runtime.onStartup.addListener(() => {
		bootstrapContextMenu().catch((error) => {
			logError("background", error instanceof Error ? error : new Error(String(error)), {
				action: "onStartupContextMenu",
			});
		});
	});

	// 监听来自网页的消息（用于接收授权 token）
	chrome.runtime.onMessageExternal.addListener(
		async (message, sender, sendResponse) => {
			if (message.type === "AUTH_TOKEN" && message.token) {
				try {
					await ApiClient.saveToken(message.token);
					const senderTabId = sender.tab?.id;
					if (typeof senderTabId === "number") {
						try {
							await chrome.tabs.remove(senderTabId);
						} catch (closeErr) {
							logError(
								"background",
								closeErr instanceof Error
									? closeErr
									: new Error(String(closeErr)),
								{ action: "closeAuthTab", senderTabId },
							);
						}
					}
					sendResponse({ success: true });
				} catch (err) {
					console.error("Failed to save token:", err);
					logError(
						"background",
						err instanceof Error ? err : new Error(String(err)),
						{
							action: "saveAuthToken",
							senderTabId: sender.tab?.id,
						},
					);
					sendResponse({ success: false, error: String(err) });
				}
			}
			return true;
		},
	);

	chrome.contextMenus.onClicked.addListener(async (info, tab) => {
		if (info.menuItemId !== "collect-article" || !tab?.id) return;

		const language = await resolveLanguage();
		const t = (key: string) => translate(language, key);
		let reportUrlForError = "";

		try {
			const apiHost = await ApiClient.loadApiHost();
			const token = await ApiClient.loadToken();
			const apiClient = new ApiClient(apiHost);
			if (token) {
				apiClient.setToken(token);
			}

			const runtimeLinkUrl = await getContextLinkUrlFromContent(tab.id);
			const linkUrl = resolveHttpUrl(
				info.linkUrl || runtimeLinkUrl,
				tab.url || "",
			);
			const selectedUrl = extractSelectedUrl(info.selectionText);
			const reportUrl = linkUrl || selectedUrl || "";
			reportUrlForError = reportUrl;

			if (reportUrl) {
				const luminaSlug = extractLuminaArticleSlug(
					reportUrl,
					apiClient.frontendUrl,
				);
				if (luminaSlug) {
					const articleUrl = `${apiClient.frontendUrl}/article/${luminaSlug}`;
					await addToHistory({
						articleId: luminaSlug,
						slug: luminaSlug,
						title: tab.title || t("未命名"),
						url: reportUrl,
						domain: getDomainFromUrl(reportUrl),
					});
					chrome.tabs.create({ url: articleUrl });
					return;
				}

				const reportResult = await apiClient.reportArticleByUrl({ url: reportUrl });
				const isDuplicate =
					"code" in reportResult && reportResult.code === "source_url_exists";
				const articleSlug = isDuplicate
					? reportResult.existing?.slug || reportResult.existing?.id
					: reportResult.slug || reportResult.id;
				const articleId = isDuplicate
					? reportResult.existing?.id
					: reportResult.id;
				const articleTitle =
					(isDuplicate ? reportResult.existing?.title : "") ||
					tab.title ||
					t("未命名");

				await addToHistory({
					articleId: articleId ? String(articleId) : String(articleSlug || ""),
					slug: articleSlug ? String(articleSlug) : undefined,
					title: articleTitle,
					url: reportUrl,
					domain: getDomainFromUrl(reportUrl),
				});

				if (articleSlug) {
					const articleUrl = `${apiClient.frontendUrl}/article/${articleSlug}`;
					chrome.tabs.create({ url: articleUrl });
				}
				return;
			}

			const scriptLoaded = await ensureContentScriptLoaded(tab.id, {
				onError: (error) =>
					logError("background", error, {
						action: "injectContentScript",
						tabId: tab.id,
					}),
			});
			if (!scriptLoaded) {
				chrome.notifications.create({
					type: "basic",
					iconUrl: "icon/128.png",
					title: t("采集失败"),
					message: t("无法在此页面运行，请刷新页面后重试"),
				});
				return;
			}

			let extractedData: { content_html?: string } | null = null;
			const hasSelection =
				info.selectionText && info.selectionText.trim().length > 0;

			if (hasSelection) {
				try {
					const selectionData = await chrome.tabs.sendMessage(tab.id, {
						type: "EXTRACT_SELECTION",
					});
					if (selectionData && selectionData.content_html) {
						extractedData = selectionData;
					}
				} catch (err) {
					console.log("Selection extraction failed:", err);
				}
			}

			if (!extractedData) {
				extractedData = await chrome.tabs.sendMessage(tab.id, {
					type: "EXTRACT_ARTICLE",
				});
			}

			if (!extractedData || !extractedData.content_html) {
				chrome.notifications.create({
					type: "basic",
					iconUrl: "icon/128.png",
					title: t("采集失败"),
					message: t("未能提取到文章内容，请确认页面已加载完成"),
				});
				return;
			}

			const contentMd = htmlToMarkdown(extractedData.content_html || "", {
				source: "background",
				logError,
			});
			const sourceDomain =
				extractedData.source_domain ||
				(tab.url ? new URL(tab.url).hostname : "");

			const result = await apiClient.createArticle({
				title: extractedData.title || tab.title || t("未命名"),
				content_html: extractedData.content_html,
				content_md: contentMd,
				source_url: extractedData.source_url || tab.url || "",
				top_image: extractedData.top_image || null,
				author: extractedData.author || "",
				published_at: extractedData.published_at || "",
				source_domain: sourceDomain,
				content_structured: extractedData.content_structured || null,
			});

			const articleSlug = result?.slug || result?.id;
			await addToHistory({
				articleId: result?.id ? String(result.id) : String(articleSlug || ""),
				slug: articleSlug ? String(articleSlug) : undefined,
				title: extractedData.title || tab.title || t("未命名"),
				url: extractedData.source_url || tab.url || "",
				domain: sourceDomain,
				topImage: extractedData.top_image || undefined,
			});

			if (articleSlug) {
				const articleUrl = `${apiClient.frontendUrl}/article/${articleSlug}`;
				chrome.tabs.create({ url: articleUrl });
			}
		} catch (error) {
			console.error("Context menu extraction failed:", error);
			if (error instanceof Error && error.message === "UNAUTHORIZED") {
				chrome.notifications.create({
					type: "basic",
					iconUrl: "icon/128.png",
					title: t("采集失败"),
					message: t("登录已过期，请重新登录"),
				});
				return;
			}
			if (
				reportUrlForError &&
				error instanceof Error &&
				error.message.includes("不允许访问内网或本机地址")
			) {
				chrome.notifications.create({
					type: "basic",
					iconUrl: "icon/128.png",
					title: t("采集失败"),
					message: t("当前链接属于本机或内网地址，URL上报已禁用"),
				});
				return;
			}
			logError(
				"background",
				error instanceof Error ? error : new Error(String(error)),
				{ action: "contextMenuExtract", url: tab?.url },
			);
			chrome.notifications.create({
				type: "basic",
				iconUrl: "icon/128.png",
				title: t("采集失败"),
				message: t("提取内容时出错，请刷新页面后重试"),
			});
		}
	});
});
