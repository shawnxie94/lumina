import { ApiClient } from "../utils/api";
import { logError } from "../utils/errorLogger";
import { addToHistory } from "../utils/history";
import { htmlToMarkdown } from "../utils/markdownConverter";
import { ensureContentScriptLoaded } from "../utils/contentScript";

export default defineBackground(() => {
	chrome.runtime.onInstalled.addListener(() => {
		chrome.contextMenus.create({
			id: "collect-article",
			title: "采集到 Lumina",
			contexts: ["page", "selection"],
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

		try {
			const apiHost = await ApiClient.loadApiHost();
			const token = await ApiClient.loadToken();
			const apiClient = new ApiClient(apiHost);
			if (token) {
				apiClient.setToken(token);
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
					title: "采集失败",
					message: "无法在此页面运行，请刷新页面后重试",
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
					title: "采集失败",
					message: "未能提取到文章内容，请确认页面已加载完成",
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
				title: extractedData.title || tab.title || "未命名",
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
				title: extractedData.title || tab.title || "未命名",
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
					title: "采集失败",
					message: "登录已过期，请重新登录",
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
				title: "采集失败",
				message: "提取内容时出错，请刷新页面后重试",
			});
		}
	});
});
