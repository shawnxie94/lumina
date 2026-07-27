import type {
	CreateArticleResult,
	ReportArticleByUrlDuplicateResponse,
	StructuredContent,
} from "../types";
import { ApiClient } from "../utils/api";
import { logError } from "../utils/errorLogger";
import { addToHistory } from "../utils/history";
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

const buildAdminPreviewArticleUrl = (
	frontendUrl: string,
	slug: string,
): string => `${frontendUrl}/article/${slug}`;

export default defineBackground(() => {
	type CollectArticleFromTabOptions = {
		tab: chrome.tabs.Tab;
		/** Real selected text (context menu). Not a sentinel. */
		selectionText?: string;
		/** Prefer selection capture mode for EXTRACT_CAPTURE (popup/context menu). */
		preferSelection?: boolean;
		linkUrl?: string;
		allowContextLink?: boolean;
		errorAction: string;
	};

	// Serialize menu registration: SW wake + onInstalled + onStartup can race
	// and otherwise throw "Cannot create item with duplicate id collect-article".
	let contextMenuResetChain: Promise<void> = Promise.resolve();

	const resetCollectContextMenu = (language: string): Promise<void> => {
		const run = async () => {
			const t = (key: string) => translate(language, key);
			const title = t("采集到 Lumina");
			const contexts: chrome.contextMenus.ContextType[] = [
				"page",
				"selection",
				"link",
			];

			await new Promise<void>((resolve) => {
				chrome.contextMenus.removeAll(() => {
					// Consume lastError so it is never "unchecked".
					void chrome.runtime.lastError;
					resolve();
				});
			});

			await new Promise<void>((resolve) => {
				chrome.contextMenus.create(
					{
						id: "collect-article",
						title,
						contexts,
					},
					() => {
						const createError = chrome.runtime.lastError;
						if (!createError) {
							resolve();
							return;
						}

						// Another concurrent path may have created it first.
						const message = createError.message || "";
						if (/duplicate id/i.test(message)) {
							chrome.contextMenus.update(
								"collect-article",
								{ title, contexts },
								() => {
									void chrome.runtime.lastError;
									resolve();
								},
							);
							return;
						}

						logError(
							"background",
							new Error(message || "contextMenus.create failed"),
							{ action: "createCollectContextMenu" },
						);
						resolve();
					},
				);
			});
		};

		contextMenuResetChain = contextMenuResetChain.then(run, run);
		return contextMenuResetChain;
	};

	const bootstrapContextMenu = async () => {
		const language = await resolveLanguage();
		await resetCollectContextMenu(language);
	};

	// Register once on SW start; onInstalled/onStartup re-sync title/language.
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

	const stripHtmlToText = (html: string | undefined): string =>
		(html || "")
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();

	type DomExtractPayload = {
		title?: string;
		content_html?: string;
		/** Prefer this when present (converted in content script with real DOM). */
		content_md?: string;
		content_structured?: unknown;
		source_url?: string;
		top_image?: string | null;
		author?: string;
		published_at?: string;
		source_domain?: string;
		quality?: {
			score?: number;
			wordCount?: number;
			warnings?: string[];
		};
		extract_debug?: {
			strategy_final?: string;
			retries?: Array<{ strategy: string; reason: string }>;
		};
		isSelection?: boolean;
	};

	/** True when plugin extraction returned real text (not empty shell HTML). */
	const hasDomContent = (
		data: DomExtractPayload | null | undefined,
	): boolean => {
		if (!data?.content_html?.trim()) return false;
		return stripHtmlToText(data.content_html).length > 0;
	};

	const isDuplicateArticleResult = (
		result: CreateArticleResult | ReportArticleByUrlDuplicateResponse,
	): result is ReportArticleByUrlDuplicateResponse =>
		Boolean(
			result &&
				typeof result === "object" &&
				"code" in result &&
				result.code === "source_url_exists" &&
				result.existing,
		);

	/** Persist soft quality + extract_debug for backend observability only. */
	const buildExtractionMetadata = (
		data: DomExtractPayload,
	): string | undefined => {
		const payload: Record<string, unknown> = {
			source: "browser_extension",
		};
		if (data.quality) {
			payload.quality = data.quality;
		}
		if (data.extract_debug) {
			payload.extract_debug = data.extract_debug;
		}
		if (data.isSelection) {
			payload.is_selection = true;
		}
		if (!payload.quality && !payload.extract_debug && !payload.is_selection) {
			return undefined;
		}
		try {
			return JSON.stringify(payload);
		} catch {
			return undefined;
		}
	};

	const openCollectedArticle = async (
		apiClient: ApiClient,
		params: {
			articleId?: string | number | null;
			articleSlug?: string | number | null;
			title: string;
			url: string;
			domain: string;
			topImage?: string | null;
		},
	): Promise<void> => {
		const articleSlug = params.articleSlug || params.articleId;
		await addToHistory({
			articleId: params.articleId
				? String(params.articleId)
				: String(articleSlug || ""),
			slug: articleSlug ? String(articleSlug) : undefined,
			title: params.title,
			url: params.url,
			domain: params.domain,
			topImage: params.topImage || undefined,
		});
		if (articleSlug) {
			const articleUrl = buildAdminPreviewArticleUrl(
				apiClient.frontendUrl,
				String(articleSlug),
			);
			chrome.tabs.create({ url: articleUrl });
		}
	};

	const collectViaUrlReport = async (
		apiClient: ApiClient,
		reportUrl: string,
		fallbackTitle: string,
		t: (key: string) => string,
	): Promise<void> => {
		const reportResult = await apiClient.reportArticleByUrl({ url: reportUrl });
		const isDuplicate = isDuplicateArticleResult(reportResult);
		const articleSlug = isDuplicate
			? reportResult.existing?.slug || reportResult.existing?.id
			: reportResult.slug || reportResult.id;
		const articleId = isDuplicate ? reportResult.existing?.id : reportResult.id;
		const articleTitle =
			(isDuplicate ? reportResult.existing?.title : "") ||
			fallbackTitle ||
			t("未命名");

		await openCollectedArticle(apiClient, {
			articleId,
			articleSlug,
			title: articleTitle,
			url: reportUrl,
			domain: getDomainFromUrl(reportUrl),
		});
	};

	const collectViaDomCreate = async (
		apiClient: ApiClient,
		extractedData: DomExtractPayload,
		tab: chrome.tabs.Tab,
		t: (key: string) => string,
	): Promise<void> => {
		// content_md is produced in the content script via Defuddle markdown.
		// Service worker has no DOM and no longer ships a custom turndown pipeline.
		const contentMd = (extractedData.content_md || "").trim();
		const sourceDomain =
			extractedData.source_domain ||
			(tab.url ? new URL(tab.url).hostname : "");
		const sourceUrl = extractedData.source_url || tab.url || "";
		const title = extractedData.title || tab.title || t("未命名");

		const result = await apiClient.createArticle({
			title,
			content_html: extractedData.content_html || "",
			content_md: contentMd,
			source_url: sourceUrl,
			top_image: extractedData.top_image || null,
			author: extractedData.author || "",
			published_at: extractedData.published_at || "",
			source_domain: sourceDomain,
			content_structured:
				(extractedData.content_structured as StructuredContent | null | undefined) ||
				null,
			// Mark as final browser-captured body so backend keeps it as-is.
			extraction_provider: "browser_extension",
			extraction_status: "completed",
			extraction_metadata: buildExtractionMetadata(extractedData),
		});

		const isDuplicate = isDuplicateArticleResult(result);
		const articleSlug = isDuplicate
			? result.existing?.slug || result.existing?.id
			: result.slug || result.id;
		const articleId = isDuplicate ? result.existing?.id : result.id;
		const openTitle = (isDuplicate ? result.existing?.title : "") || title;

		await openCollectedArticle(apiClient, {
			articleId,
			articleSlug,
			title: openTitle,
			url: sourceUrl,
			domain: sourceDomain,
			topImage: extractedData.top_image || null,
		});
	};

	const collectArticleFromTab = async ({
		tab,
		selectionText,
		preferSelection = false,
		linkUrl: requestedLinkUrl,
		allowContextLink = false,
		errorAction,
	}: CollectArticleFromTabOptions): Promise<void> => {
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

			const selectionTextTrimmed = (selectionText || "").trim();
			// Real text from context menu, or popup boolean preferSelection.
			// Avoid sentinel strings like "__selection__".
			const wantsSelection =
				preferSelection || Boolean(selectionTextTrimmed);
			const runtimeLinkUrl =
				allowContextLink && typeof tab.id === "number"
					? await getContextLinkUrlFromContent(tab.id)
					: "";
			const linkUrl = resolveHttpUrl(
				requestedLinkUrl || runtimeLinkUrl,
				tab.url || "",
			);
			// Only parse URL from real selection text (not popup boolean path).
			const selectedUrl = extractSelectedUrl(
				selectionTextTrimmed ? selectionTextTrimmed : undefined,
			);
			const currentPageUrl = resolveHttpUrl(tab.url, "");
			// Prefer explicit link/selected URL target; otherwise current page.
			const reportUrl = linkUrl || selectedUrl || currentPageUrl;
			const targetingCurrentPage = Boolean(
				currentPageUrl && reportUrl === currentPageUrl,
			);
			// Can run content-script extraction on this tab.
			const canExtractDom =
				typeof tab.id === "number" &&
				(wantsSelection || targetingCurrentPage || !reportUrl);
			reportUrlForError = reportUrl;

			if (reportUrl) {
				const luminaSlug = extractLuminaArticleSlug(
					reportUrl,
					apiClient.frontendUrl,
				);
				if (luminaSlug) {
					await openCollectedArticle(apiClient, {
						articleId: luminaSlug,
						articleSlug: luminaSlug,
						title: tab.title || t("未命名"),
						url: reportUrl,
						domain: getDomainFromUrl(reportUrl),
					});
					return;
				}
			}

			// --- Primary path: single DOM capture entry (always finalized) ---
			let extractedData: DomExtractPayload | null = null;
			if (canExtractDom && typeof tab.id === "number") {
				const scriptLoaded = await ensureContentScriptLoaded(tab.id, {
					onError: (error) =>
						logError("background", error, {
							action: "injectContentScript",
							tabId: tab.id,
						}),
				});
				if (!scriptLoaded) {
					// Fall through to URL report if possible.
					console.warn("Content script unavailable; will try URL report if allowed");
				} else {
					const runCapture = async (
						captureMode: "selection" | "article",
					): Promise<DomExtractPayload | null> => {
						const captureData = (await chrome.tabs.sendMessage(tab.id!, {
							type: "EXTRACT_CAPTURE",
							mode: captureMode,
						})) as DomExtractPayload | null;
						if (!captureData) return null;
						const normalized: DomExtractPayload = {
							...captureData,
							isSelection:
								Boolean(captureData.isSelection) ||
								captureData.extract_debug?.strategy_final === "selection",
						};
						// Finalized capture should include markdown. Missing md is a contract warning.
						if (
							hasDomContent(normalized) &&
							!(normalized.content_md || "").trim()
						) {
							console.warn(
								"EXTRACT_CAPTURE returned HTML without content_md; proceeding with HTML only",
								{
									mode: captureMode,
									strategy: normalized.extract_debug?.strategy_final,
								},
							);
						}
						return normalized;
					};

					try {
						if (wantsSelection) {
							extractedData = await runCapture("selection");
						}
						// Selection miss/empty falls back to full-article capture.
						if (!hasDomContent(extractedData)) {
							extractedData = await runCapture("article");
						}
					} catch (err) {
						console.log("Capture extraction failed:", err);
						extractedData = null;
					}

					if (hasDomContent(extractedData)) {
						await collectViaDomCreate(apiClient, extractedData!, tab, t);
						return;
					}
				}
			}

			// --- Secondary path: backend URL report only when DOM extracted nothing ---
			if (reportUrl) {
				try {
					await collectViaUrlReport(
						apiClient,
						reportUrl,
						tab.title || t("未命名"),
						t,
					);
					return;
				} catch (error) {
					throw error;
				}
			}

			chrome.notifications.create({
				type: "basic",
				iconUrl: "icon/128.png",
				title: t("采集失败"),
				message: t("未能提取到文章内容，请确认页面已加载完成"),
			});
		} catch (error) {
			console.error("Article collection failed:", error);
			if (error instanceof Error && error.message === "UNAUTHORIZED") {
				chrome.notifications.create({
					type: "basic",
					iconUrl: "icon/128.png",
					title: t("采集失败"),
					message: t("登录已过期，请重新登录"),
				});
				return;
			}
			logError(
				"background",
				error instanceof Error ? error : new Error(String(error)),
				{ action: errorAction, url: reportUrlForError || tab?.url },
			);
			chrome.notifications.create({
				type: "basic",
				iconUrl: "icon/128.png",
				title: t("采集失败"),
				message: t("提取内容时出错，请刷新页面后重试"),
			});
		}
	};

	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (message?.type !== "COLLECT_TAB_IN_BACKGROUND") return false;
		if (typeof message.tabId !== "number") {
			sendResponse({ success: false, error: "INVALID_TAB_ID" });
			return false;
		}

		(async () => {
			const tab = await chrome.tabs.get(message.tabId);
			await collectArticleFromTab({
				tab,
				preferSelection: Boolean(message.hasSelection),
				allowContextLink: false,
				errorAction: "popupBackgroundCollect",
			});
			sendResponse({ success: true });
		})().catch((error) => {
			logError(
				"background",
				error instanceof Error ? error : new Error(String(error)),
				{
					action: "popupBackgroundCollectDispatch",
					tabId: message.tabId,
				},
			);
			sendResponse({ success: false, error: String(error) });
		});

		return true;
	});

	chrome.contextMenus.onClicked.addListener(async (info, tab) => {
		if (info.menuItemId !== "collect-article" || !tab?.id) return;

		await collectArticleFromTab({
			tab,
			selectionText: info.selectionText,
			linkUrl: info.linkUrl,
			allowContextLink: true,
			errorAction: "contextMenuExtract",
		});
	});
});
