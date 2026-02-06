import "../../styles/popup.css";
import confetti from "canvas-confetti";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { ApiClient, DEFAULT_CATEGORIES } from "../../utils/api";
import { autoMatchCategory } from "../../utils/categoryKeywords";
import { logError, setupGlobalErrorHandler } from "../../utils/errorLogger";
import {
	addToHistory,
	clearHistory,
	formatHistoryDate,
	getHistory,
} from "../../utils/history";
import { icons } from "../../utils/icons";

setupGlobalErrorHandler("popup");

class PopupController {
	#apiClient;
	#turndown;
	#articleData = null;
	#currentTab = null;
	#categories = [];
	#isLoggedIn = false;

	constructor() {
		this.#apiClient = new ApiClient();
		this.#turndown = new TurndownService({
			headingStyle: "atx",
			codeBlockStyle: "fenced",
			fence: "```",
			bulletListMarker: "-",
			emDelimiter: "*",
			strongDelimiter: "**",
			linkStyle: "inlined",
		});

		this.#turndown.use(gfm);
		this.#turndown.remove([
			"script",
			"style",
			"noscript",
			"iframe",
			"nav",
			"footer",
			"aside",
		]);

		this.#turndown.addRule("fencedCodeBlockWithLanguage", {
			filter: (node, options) => {
				return (
					options.codeBlockStyle === "fenced" &&
					node.nodeName === "PRE" &&
					node.firstChild &&
					node.firstChild.nodeName === "CODE"
				);
			},
			replacement: (_content, node, options) => {
				const codeNode = node.firstChild;
				const className = codeNode.getAttribute("class") || "";
				const langMatch = className.match(/(?:language-|lang-)(\w+)/);
				const language = langMatch ? langMatch[1] : "";
				const code = codeNode.textContent || "";
				const fence = options.fence;
				return `\n\n${fence}${language}\n${code.replace(/\n$/, "")}\n${fence}\n\n`;
			},
		});

		this.#turndown.addRule("mathBlock", {
			filter: (node) => {
				if (node.nodeName === "DIV" || node.nodeName === "SPAN") {
					const className = node.className || "";
					if (
						className.match(/MathJax|mathjax|katex|math-display|math-block/i)
					) {
						return true;
					}
				}
				if (
					node.nodeName === "SCRIPT" &&
					node.getAttribute("type")?.includes("math/tex")
				) {
					return true;
				}
				if (node.nodeName === "MATH") {
					return true;
				}
				return false;
			},
			replacement: (_content, node) => {
				const annotation = node.querySelector(
					'annotation[encoding="application/x-tex"]',
				);
				if (annotation?.textContent) {
					const tex = annotation.textContent.trim();
					const isBlock =
						node.nodeName === "DIV" ||
						node.className?.includes("display") ||
						node.className?.includes("block");
					return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
				}

				if (node.nodeName === "SCRIPT") {
					const tex = node.textContent?.trim() || "";
					const isDisplay = node.getAttribute("type")?.includes("display");
					return isDisplay ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
				}

				const altText =
					node.getAttribute("alt") || node.getAttribute("data-formula");
				if (altText) {
					const isBlock =
						node.nodeName === "DIV" ||
						node.className?.includes("display") ||
						node.className?.includes("block");
					return isBlock ? `\n\n$$\n${altText}\n$$\n\n` : `$${altText}$`;
				}

				return _content;
			},
		});

		this.#turndown.addRule("mathImg", {
			filter: (node) => {
				if (node.nodeName === "IMG") {
					const alt = node.getAttribute("alt") || "";
					const src = node.getAttribute("src") || "";
					const className = node.className || "";
					return (
						alt.includes("\\") ||
						src.includes("latex") ||
						src.includes("codecogs") ||
						src.includes("math") ||
						className.includes("math") ||
						className.includes("latex")
					);
				}
				return false;
			},
			replacement: (_content, node) => {
				const alt = node.getAttribute("alt") || "";
				if (alt && alt.includes("\\")) {
					return `$${alt}$`;
				}
				const src = node.getAttribute("src") || "";
				const texMatch = src.match(/[?&]tex=([^&]+)/);
				if (texMatch) {
					return `$${decodeURIComponent(texMatch[1])}$`;
				}
				return `![math](${src})`;
			},
		});

		this.#turndown.addRule("videoEmbed", {
			filter: (node) => {
				if (node.nodeName === "IFRAME") {
					const src = node.getAttribute("src") || "";
					return (
						src.includes("youtube.com") ||
						src.includes("youtu.be") ||
						src.includes("bilibili.com") ||
						src.includes("vimeo.com") ||
						src.includes("player.bilibili.com")
					);
				}
				if (node.nodeName === "VIDEO") {
					return true;
				}
				return false;
			},
			replacement: (_content, node) => {
				const src = node.getAttribute("src") || "";
				const title = node.getAttribute("title") || "Video";

				let videoUrl = src;
				let videoId = "";

				const youtubeMatch = src.match(
					/(?:youtube\.com\/embed\/|youtu\.be\/)([^?&]+)/,
				);
				if (youtubeMatch) {
					videoId = youtubeMatch[1];
					videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
					return `\n\n[▶ ${title}](${videoUrl})\n\n`;
				}

				const bilibiliMatch = src.match(
					/player\.bilibili\.com\/player\.html\?.*?(?:bvid=|aid=)([^&]+)/,
				);
				if (bilibiliMatch) {
					videoId = bilibiliMatch[1];
					videoUrl = `https://www.bilibili.com/video/${videoId}`;
					return `\n\n[▶ ${title}](${videoUrl})\n\n`;
				}

				const vimeoMatch = src.match(/player\.vimeo\.com\/video\/(\d+)/);
				if (vimeoMatch) {
					videoId = vimeoMatch[1];
					videoUrl = `https://vimeo.com/${videoId}`;
					return `\n\n[▶ ${title}](${videoUrl})\n\n`;
				}

				if (node.nodeName === "VIDEO") {
					const videoSrc =
						node.getAttribute("src") ||
						node.querySelector("source")?.getAttribute("src") ||
						"";
					if (videoSrc) {
						return `\n\n[▶ Video](${videoSrc})\n\n`;
					}
				}

				return `\n\n[▶ ${title}](${src})\n\n`;
			},
		});

		this.#turndown.addRule("improvedImage", {
			filter: "img",
			replacement: (_content, node) => {
				let src = node.getAttribute("src") || "";

				const isPlaceholder = (s) => {
					if (!s) return true;
					if (s.startsWith("data:image/svg+xml")) return true;
					if (s.startsWith("data:image/gif;base64,R0lGOD")) return true;
					if (
						s.includes("1x1") ||
						s.includes("placeholder") ||
						s.includes("blank")
					)
						return true;
					if (s.includes("spacer") || s.includes("loading")) return true;
					return false;
				};

				if (isPlaceholder(src)) {
					src =
						node.getAttribute("data-src") ||
						node.getAttribute("data-original") ||
						node.getAttribute("data-lazy-src") ||
						node.getAttribute("data-croporisrc") ||
						"";
				}

				if (!src || isPlaceholder(src)) return "";

				let alt = node.getAttribute("alt") || "";

				if (
					!alt ||
					alt === "image" ||
					alt === "img" ||
					alt === "图片" ||
					alt === "图像" ||
					alt.length < 2
				) {
					alt =
						node.getAttribute("title") ||
						node.getAttribute("data-alt") ||
						node.getAttribute("aria-label") ||
						"";
				}

				if (!alt) {
					const figcaption = node
						.closest("figure")
						?.querySelector("figcaption");
					if (figcaption) {
						alt = figcaption.textContent?.trim() || "";
					}
				}

				if (!alt) {
					const filename = src.split("/").pop()?.split("?")[0] || "";
					const nameWithoutExt = filename
						.replace(/\.[^.]+$/, "")
						.replace(/[-_]/g, " ");
					if (
						nameWithoutExt &&
						nameWithoutExt.length > 2 &&
						nameWithoutExt.length < 50
					) {
						alt = nameWithoutExt;
					}
				}

				alt = alt.replace(/[[\]]/g, "").trim();

				const escapedAlt = alt.replace(/"/g, "&quot;");
				return `<img src="${src}" alt="${escapedAlt}" style="max-width: 600px;" />`;
			},
		});

		this.#turndown.addRule("imageOnlyLink", {
			filter: (node) => {
				if (node.nodeName !== "A") return false;
				const imgs = node.querySelectorAll("img");
				if (imgs.length === 0) return false;

				const textContent = node.textContent?.trim() || "";
				const imgAlts = Array.from(imgs)
					.map((img) => img.getAttribute("alt") || "")
					.join(" ")
					.trim();
				const nonImgText = textContent.replace(imgAlts, "").trim();

				if (
					nonImgText.length > 0 &&
					nonImgText !== "图像" &&
					nonImgText !== "图片" &&
					nonImgText !== "image"
				) {
					return false;
				}

				return true;
			},
			replacement: (content) => {
				return content;
			},
		});

		this.#turndown.addRule("nestedBlockquote", {
			filter: "blockquote",
			replacement: (content, node) => {
				let depth = 0;
				let parent = node.parentNode;
				while (parent) {
					if (parent.nodeName === "BLOCKQUOTE") {
						depth++;
					}
					parent = parent.parentNode;
				}

				const prefix = "> ".repeat(depth + 1);
				const lines = content.trim().split("\n");
				const quotedLines = lines.map((line) => {
					if (line.trim() === "") return prefix.trim();
					if (line.startsWith(">")) return prefix + line;
					return prefix + line;
				});

				return "\n\n" + quotedLines.join("\n") + "\n\n";
			},
		});
	}

	async init() {
		try {
			await this.loadConfig();
			await this.setupEventListeners();
			this.checkApiHealth();
			await this.checkLoginStatus();

			if (!this.#isLoggedIn) {
				this.showLoginRequired();
				return;
			}

			await this.loadCategories();
			await this.loadHistory();
			await this.extractArticle();
		} catch (error) {
			console.error("Failed to initialize popup:", error);
			logError("popup", error, { action: "init" });
			this.updateStatus("error", "初始化失败");
		}
	}

	async loadConfig() {
		const apiHost = await ApiClient.loadApiHost();
		const token = await ApiClient.loadToken();
		this.#apiClient = new ApiClient(apiHost);
		if (token) {
			this.#apiClient.setToken(token);
		}

		const apiHostInput = document.getElementById("apiHostInput");
		if (apiHostInput) {
			apiHostInput.value = apiHost;
		}
	}

	async checkLoginStatus() {
		const result = await this.#apiClient.verifyToken();
		this.#isLoggedIn = result.valid && result.role === "admin";
		this.updateLoginUI();
	}

	updateLoginUI() {
		const loginBtn = document.getElementById("loginBtn");
		const logoutBtn = document.getElementById("logoutBtn");
		const loginStatus = document.getElementById("loginStatus");

		if (loginBtn) loginBtn.classList.toggle("hidden", this.#isLoggedIn);
		if (logoutBtn) logoutBtn.classList.toggle("hidden", !this.#isLoggedIn);
		if (loginStatus) {
			loginStatus.textContent = this.#isLoggedIn ? "已登录" : "未登录";
			loginStatus.className = `login-status ${this.#isLoggedIn ? "logged-in" : "logged-out"}`;
		}
	}

	showLoginRequired() {
		const mainContent = document.getElementById("mainContent");
		const loginPrompt = document.getElementById("loginPrompt");

		if (mainContent) mainContent.classList.add("hidden");
		if (loginPrompt) loginPrompt.classList.remove("hidden");

		this.updateStatus("warning", "请先登录管理员账号");
	}

	async handleLogin() {
		const authUrl = `${this.#apiClient.frontendUrl}/auth/extension?extension_id=${chrome.runtime.id}`;
		chrome.tabs.create({ url: authUrl });
		window.close();
	}

	async handleLogout() {
		await ApiClient.removeToken();
		this.#apiClient.setToken(null);
		this.#isLoggedIn = false;
		this.updateLoginUI();
		this.showLoginRequired();
	}

	async checkApiHealth() {
		const statusEl = document.getElementById("connectionStatus");
		const dotEl = statusEl?.querySelector(".status-dot");
		if (!statusEl || !dotEl) return;

		const { ok, latency } = await this.#apiClient.checkHealth();

		dotEl.classList.remove("checking", "connected", "disconnected");

		if (ok) {
			dotEl.classList.add("connected");
			statusEl.title = `已连接 (${latency}ms)`;
		} else {
			dotEl.classList.add("disconnected");
			statusEl.title = "无法连接到服务器，请检查配置";
		}
	}

	async setupEventListeners() {
		document.getElementById("closeBtn")?.addEventListener("click", () => {
			window.close();
		});

		document.getElementById("cancelBtn")?.addEventListener("click", () => {
			window.close();
		});

		document
			.getElementById("collectBtn")
			?.addEventListener("click", () => this.collectArticle());

		document
			.getElementById("editAndCollectBtn")
			?.addEventListener("click", () => this.openEditorPage());

		document
			.getElementById("configBtn")
			?.addEventListener("click", () => this.openConfigModal());

		document
			.getElementById("saveConfigBtn")
			?.addEventListener("click", () => this.saveConfig());

		document
			.getElementById("cancelConfigBtn")
			?.addEventListener("click", () => this.closeConfigModal());

		document
			.getElementById("openSettingsBtn")
			?.addEventListener("click", () => this.openSettingsPage());

		document
			.getElementById("retryBtn")
			?.addEventListener("click", () => this.retryExtract());

		document
			.getElementById("clearHistoryBtn")
			?.addEventListener("click", () => this.clearHistoryList());

		document
			.getElementById("viewAllHistoryBtn")
			?.addEventListener("click", () => this.openHistoryPage());

		document
			.getElementById("loginBtn")
			?.addEventListener("click", () => this.handleLogin());

		document
			.getElementById("logoutBtn")
			?.addEventListener("click", () => this.handleLogout());

		document
			.getElementById("loginPromptBtn")
			?.addEventListener("click", () => this.handleLogin());
		document
			.getElementById("loginPromptConfigBtn")
			?.addEventListener("click", () => this.openConfigModal());
	}

	openHistoryPage() {
		chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
		window.close();
	}

	openSettingsPage() {
		chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
		window.close();
	}

	async ensureContentScriptLoaded(tabId) {
		try {
			await chrome.tabs.sendMessage(tabId, { type: "PING" });
		} catch {
			await chrome.scripting.executeScript({
				target: { tabId },
				files: ["content-scripts/content.js"],
			});
		}
	}

	async retryExtract() {
		this.hideRetryButton();
		if (this.#currentTab?.id) {
			try {
				await chrome.tabs.sendMessage(this.#currentTab.id, {
					type: "EXTRACT_ARTICLE",
					forceRefresh: true,
				});
			} catch {
				// Ignore, will use fallback
			}
		}
		await this.extractArticle();
	}

	showRetryButton() {
		const retryBtn = document.getElementById("retryBtn");
		if (retryBtn) {
			retryBtn.classList.remove("hidden");
		}
	}

	hideRetryButton() {
		const retryBtn = document.getElementById("retryBtn");
		if (retryBtn) {
			retryBtn.classList.add("hidden");
		}
	}

	async loadCategories() {
		try {
			const categories = await this.#apiClient.getCategories();
			this.#categories = categories;
			this.populateCategories(categories);
		} catch (error) {
			console.error("Failed to load categories:", error);
			logError("popup", error, { action: "loadCategories" });
			this.updateStatus("warning", "加载分类失败，使用默认分类");
			this.#categories = DEFAULT_CATEGORIES;
			this.populateCategories(DEFAULT_CATEGORIES);
		}
	}

	populateCategories(categories) {
		const select = document.getElementById("categorySelect");
		if (!select) return;

		select.innerHTML = '<option value="">选择分类...</option>';

		categories.forEach((category) => {
			const option = document.createElement("option");
			option.value = category.id;
			option.textContent = category.name;
			select.appendChild(option);
		});

		if (categories.length > 0) {
			select.value = categories[0].id;
		}
	}

	async extractArticle() {
		this.updateStatus("loading", "正在连接页面...");

		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			this.#currentTab = tab;

			if (!tab.id) {
				this.updateStatus("error", "无法获取当前标签页");
				return;
			}

			if (
				tab.url?.startsWith("chrome://") ||
				tab.url?.startsWith("chrome-extension://")
			) {
				this.updateStatus("error", "无法在此页面提取内容");
				return;
			}

			await this.ensureContentScriptLoaded(tab.id);

			try {
				const xArticleCheck = await chrome.tabs.sendMessage(tab.id, {
					type: "CHECK_X_ARTICLE",
				});
				if (xArticleCheck?.shouldRedirect && xArticleCheck?.articleUrl) {
					this.updateStatus(
						"loading",
						"检测到 X 长文章，正在跳转到专注模式...",
					);
					await chrome.tabs.update(tab.id, { url: xArticleCheck.articleUrl });
					await new Promise((resolve) => setTimeout(resolve, 3000));
					await this.ensureContentScriptLoaded(tab.id);
				}
			} catch (err) {
				console.log("X article check failed:", err);
			}

			let extractedData;
			let isSelection = false;

			try {
				const selectionCheck = await chrome.tabs.sendMessage(tab.id, {
					type: "CHECK_SELECTION",
				});
				if (selectionCheck?.hasSelection) {
					this.updateStatus("loading", "正在提取选中内容...");
					const selectionData = await chrome.tabs.sendMessage(tab.id, {
						type: "EXTRACT_SELECTION",
					});
					if (selectionData && selectionData.content_html) {
						extractedData = selectionData;
						isSelection = true;
					}
				}
			} catch (err) {
				console.log("Selection check failed:", err);
			}

			if (!extractedData) {
				extractedData = await this.extractWithRetry(tab.id);
			}

			if (!extractedData || !extractedData.content_html) {
				this.updateStatus("error", "未能提取到文章内容，请确认页面已加载完成");
				this.showRetryButton();
				return;
			}

			this.updateStatus("loading", "正在转换为 Markdown...");

			const contentMd = this.#turndown.turndown(extractedData.content_html);

			this.#articleData = {
				...extractedData,
				content_md: contentMd,
			};

			this.updatePreview(isSelection);
			await this.autoSelectCategory(contentMd, extractedData.title);

			const wordCount = contentMd.length;
			const readingTime = Math.ceil(wordCount / 500);
			const selectionHint = isSelection ? "已选中部分内容 · " : "";

			let statusMessage = `${selectionHint}准备就绪 · 约 ${readingTime} 分钟阅读`;

			if (extractedData.quality) {
				this.displayQualityWarnings(extractedData.quality);
				if (extractedData.quality.score < 70) {
					statusMessage += " · ⚠️ 内容质量较低";
				}
			}

			this.updateStatus("idle", statusMessage);
		} catch (error) {
			console.error("Failed to extract article:", error);
			logError("popup", error, {
				action: "extractArticle",
				url: this.#currentTab?.url,
			});
			this.handleExtractionError(error);
		}
	}

	async extractWithRetry(tabId, maxRetries = 2) {
		let lastError = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				if (attempt > 0) {
					this.updateStatus(
						"loading",
						`正在重试提取 (${attempt}/${maxRetries})...`,
					);
					await new Promise((r) => setTimeout(r, 500 * attempt));
				} else {
					this.updateStatus("loading", "正在提取文章内容...");
				}

				const result = await chrome.tabs.sendMessage(tabId, {
					type: "EXTRACT_ARTICLE",
					forceRefresh: attempt > 0,
				});

				if (result && result.content_html) {
					return result;
				}
			} catch (err) {
				lastError = err;
				console.log(`Extraction attempt ${attempt + 1} failed:`, err);
			}
		}

		this.updateStatus("loading", "正在使用备用方式提取...");
		try {
			return await this.extractViaScript(tabId);
		} catch (err) {
			console.error("Fallback extraction failed:", err);
			logError("popup", err, { action: "extractWithRetry.fallback", tabId });
			throw lastError || err;
		}
	}

	displayQualityWarnings(quality) {
		if (!quality || !quality.warnings || quality.warnings.length === 0) return;

		const warningsContainer = document.getElementById("qualityWarnings");
		if (!warningsContainer) return;

		warningsContainer.innerHTML = quality.warnings
			.map((w) => `<div class="quality-warning">${icons.warning} ${w}</div>`)
			.join("");
		warningsContainer.classList.remove("hidden");
	}

	updatePreview(isSelection = false) {
		const previewTitle = document.getElementById("previewTitle");
		const previewMeta = document.getElementById("previewMeta");
		const previewThumbnail = document.getElementById("previewThumbnail");

		if (previewThumbnail && this.#articleData) {
			if (this.#articleData.top_image) {
				previewThumbnail.src = this.#articleData.top_image;
				previewThumbnail.classList.remove("hidden");
			} else {
				previewThumbnail.classList.add("hidden");
			}
		}

		if (previewTitle && this.#articleData) {
			const title = this.escapeHtml(this.#articleData.title || "(无标题)");
			previewTitle.innerHTML = `${isSelection ? `${icons.doc} ` : ""}${title}`;
		}

		if (previewMeta && this.#articleData) {
			const metaParts = [];

			if (this.#articleData.author) {
				metaParts.push(
					`<span>${icons.pen} ${this.escapeHtml(this.#articleData.author)}</span>`,
				);
			}

			if (this.#articleData.published_at) {
				metaParts.push(
					`<span>${icons.calendar} ${this.escapeHtml(this.#articleData.published_at)}</span>`,
				);
			}

			if (this.#articleData.source_domain) {
				metaParts.push(
					`<span>${icons.link} ${this.escapeHtml(this.#articleData.source_domain)}</span>`,
				);
			}

			const wordCount = this.#articleData.content_md?.length || 0;
			if (wordCount > 0) {
				metaParts.push(`<span>${icons.doc} ${wordCount} 字</span>`);
			}

			previewMeta.innerHTML = metaParts.join(
				'<span class="meta-divider">·</span>',
			);
		}
	}

	async autoSelectCategory(content, title) {
		if (!this.#categories || this.#categories.length === 0) return;

		const text = `${title || ""} ${content || ""}`;
		const select = document.getElementById("categorySelect");
		if (!select) return;

		const matchedCategoryId = await autoMatchCategory(text, this.#categories);
		if (matchedCategoryId) {
			select.value = matchedCategoryId;
		}
	}

	handleExtractionError(error) {
		const message = error?.message || String(error);

		if (message.includes("Cannot access") || message.includes("not allowed")) {
			this.updateStatus("error", "无权限访问此页面");
		} else if (message.includes("No tab") || message.includes("No active")) {
			this.updateStatus("error", "无法获取当前标签页");
		} else if (
			message.includes("connection") ||
			message.includes("Receiving end")
		) {
			this.updateStatus("error", "页面连接失败，请刷新页面后重试");
			this.showRetryButton();
		} else {
			this.updateStatus("error", "提取失败，请刷新页面后重试");
			this.showRetryButton();
		}
	}

	async extractViaScript(tabId) {
		const results = await chrome.scripting.executeScript({
			target: { tabId },
			func: () => {
				const lazyAttrs = [
					"data-src",
					"data-lazy-src",
					"data-original",
					"data-lazy",
					"data-url",
					"data-croporisrc",
				];
				const isPlaceholder = (s) => {
					if (!s) return true;
					if (s.startsWith("data:image/svg+xml")) return true;
					if (s.startsWith("data:image/gif;base64,R0lGOD")) return true;
					if (
						s.includes("1x1") ||
						s.includes("placeholder") ||
						s.includes("blank")
					)
						return true;
					return false;
				};
				document.querySelectorAll("img").forEach((img) => {
					const src = img.getAttribute("src") || "";
					if (isPlaceholder(src)) {
						for (const attr of lazyAttrs) {
							const lazySrc = img.getAttribute(attr);
							if (lazySrc) {
								img.setAttribute("src", lazySrc);
								break;
							}
						}
					}
				});

				const getMeta = (selectors) => {
					for (const selector of selectors) {
						const el = document.querySelector(selector);
						if (el?.content) return el.content;
						if (el?.textContent) return el.textContent.trim();
					}
					return "";
				};

				const title =
					getMeta([
						'meta[property="og:title"]',
						'meta[name="twitter:title"]',
					]) || document.title;
				const author = getMeta([
					'meta[name="author"]',
					'meta[property="article:author"]',
					".author",
					".byline",
				]);
				const publishedAt = getMeta([
					'meta[property="article:published_time"]',
					'meta[name="date"]',
					"time[datetime]",
				]);
				const topImage = getMeta([
					'meta[property="og:image"]',
					'meta[name="twitter:image"]',
				]);

				const selectorsToTry = [
					"article",
					'[role="main"]',
					"main",
					".post-content",
					".article-content",
					".content",
					"#content",
				];
				let articleElement = null;
				for (const selector of selectorsToTry) {
					const el = document.querySelector(selector);
					if (el && el.textContent.trim().length > 200) {
						articleElement = el;
						break;
					}
				}
				if (!articleElement) articleElement = document.body;

				const clone = articleElement.cloneNode(true);
				[
					"script",
					"style",
					"noscript",
					"nav",
					"footer",
					"aside",
					".ads",
					".comments",
					".share",
					".related",
				].forEach((sel) => {
					clone.querySelectorAll(sel).forEach((el) => el.remove());
				});

				return {
					title,
					content_html: clone.innerHTML,
					source_url: window.location.href,
					top_image: topImage || clone.querySelector("img")?.src || null,
					author,
					published_at: publishedAt,
					source_domain: new URL(window.location.href).hostname,
					excerpt: getMeta([
						'meta[property="og:description"]',
						'meta[name="description"]',
					]),
				};
			},
		});
		return results[0].result;
	}

	extractTopImage(content) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(content, "text/html");
		const img = doc.querySelector("img");

		if (img && img.src) {
			return img.src;
		}

		return null;
	}

	async convertImageToBase64(imageUrl) {
		if (!imageUrl) return null;

		try {
			if (imageUrl.startsWith("data:")) {
				return imageUrl;
			}

			const response = await fetch(imageUrl, {
				method: "GET",
				mode: "cors",
				cache: "no-cache",
			});

			if (!response.ok) {
				console.warn("Failed to fetch image:", imageUrl, response.status);
				return imageUrl;
			}

			const blob = await response.blob();

			const MAX_SIZE = 2 * 1024 * 1024;
			if (blob.size > MAX_SIZE) {
				console.warn("Image too large, skipping conversion:", blob.size);
				return imageUrl;
			}

			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
		} catch (error) {
			console.warn("Failed to convert image to base64:", error);
			return imageUrl;
		}
	}

	async collectArticle() {
		const categoryIdSelect = document.getElementById("categorySelect");
		const categoryId = categoryIdSelect?.value;

		if (!categoryId) {
			this.updateStatus("error", "请选择分类");
			return;
		}

		if (!this.#articleData) {
			this.updateStatus("error", "没有文章数据");
			return;
		}

		if (!this.#articleData.author || !this.#articleData.author.trim()) {
			this.updateStatus("warning", "缺少作者信息，请点击「编辑后采集」补充");
			return;
		}

		this.updateStatus("loading", "正在上传文章...");

		try {
			const topImageBase64 = await this.convertImageToBase64(
				this.#articleData.top_image,
			);

			const result = await this.#apiClient.createArticle({
				title: this.#articleData.title,
				content_md: this.#articleData.content_md,
				source_url: this.#articleData.source_url,
				top_image: topImageBase64,
				author: this.#articleData.author,
				published_at: this.#articleData.published_at,
				source_domain: this.#articleData.source_domain,
				category_id: categoryId,
			});

			const category = this.#categories.find((c) => c.id === categoryId);
			await addToHistory({
				articleId: result.id,
				slug: result.slug,
				title: this.#articleData.title,
				url: this.#articleData.source_url,
				domain: this.#articleData.source_domain,
				categoryName: category?.name,
				topImage: this.#articleData.top_image,
			});
			await this.loadHistory();

			const articleSlug = result.slug || result.id;
			const articleUrl = `${this.#apiClient.frontendUrl}/article/${articleSlug}`;
			this.showSuccessStatus(articleUrl);
			this.triggerConfetti();
			this.showSuccessButtons(result.id);
		} catch (error) {
			console.error("Failed to collect article:", error);
			logError("popup", error, {
				action: "collectArticle",
				title: this.#articleData?.title,
			});

			if (error.message === "UNAUTHORIZED") {
				await ApiClient.removeToken();
				this.#isLoggedIn = false;
				this.updateLoginUI();
				this.updateStatus("error", "登录已过期，请重新登录");
				return;
			}

			this.updateStatus("error", "采集失败，请重试");
		}
	}

	async openEditorPage() {
		const categoryIdSelect = document.getElementById("categorySelect");
		const categoryId = categoryIdSelect?.value;

		if (!categoryId) {
			this.updateStatus("error", "请选择分类");
			return;
		}

		if (!this.#articleData) {
			this.updateStatus("error", "没有文章数据");
			return;
		}

		try {
			const articleData = {
				...this.#articleData,
				category_id: categoryId,
			};

			const articleId = `editor_${Date.now()}`;

			await new Promise((resolve, reject) => {
				chrome.storage.local.set({ [articleId]: articleData }, () => {
					if (chrome.runtime.lastError) {
						reject(chrome.runtime.lastError);
					} else {
						resolve();
					}
				});
			});

			const editorUrl = `${chrome.runtime.getURL("editor.html")}?id=${articleId}`;

			chrome.tabs.create({ url: editorUrl });
			window.close();
		} catch (error) {
			console.error("Failed to open editor:", error);
			logError("popup", error, { action: "openEditorPage" });
			this.updateStatus("error", "打开编辑页面失败");
		}
	}

	showSuccessButtons(articleId) {
		const buttonsDiv = document.querySelector(".buttons");
		if (!buttonsDiv) return;

		buttonsDiv.innerHTML = "";

		const editBtn = document.createElement("button");
		editBtn.className = "btn btn-primary";
		editBtn.textContent = "编辑文章";
		editBtn.onclick = () => {
			chrome.tabs.create({
				url: `${this.#apiClient.frontendUrl}/article/${articleId}`,
			});
			window.close();
		};
		buttonsDiv.appendChild(editBtn);

		const closeBtn = document.createElement("button");
		closeBtn.className = "btn btn-secondary";
		closeBtn.textContent = "关闭";
		closeBtn.onclick = () => window.close();
		buttonsDiv.appendChild(closeBtn);
	}

	triggerConfetti() {
		const duration = 2000;
		const end = Date.now() + duration;

		const frame = () => {
			confetti({
				particleCount: 3,
				angle: 60,
				spread: 55,
				origin: { x: 0, y: 0.6 },
				colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
			});
			confetti({
				particleCount: 3,
				angle: 120,
				spread: 55,
				origin: { x: 1, y: 0.6 },
				colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
			});

			if (Date.now() < end) {
				requestAnimationFrame(frame);
			}
		};

		frame();
	}

	openConfigModal() {
		const modal = document.getElementById("configModal");
		if (modal) {
			modal.classList.add("show");
		}
	}

	closeConfigModal() {
		const modal = document.getElementById("configModal");
		if (modal) {
			modal.classList.remove("show");
		}
	}

	async saveConfig() {
		const apiHostInput = document.getElementById("apiHostInput");
		const newApiHost = apiHostInput?.value.trim();

		if (!newApiHost) {
			alert("请输入有效的 API 地址");
			return;
		}

		try {
			await ApiClient.saveApiHost(newApiHost);
			alert("配置已保存，页面将重新加载");
			this.closeConfigModal();
			location.reload();
		} catch (error) {
			console.error("Failed to save config:", error);
			logError("popup", error, { action: "saveConfig" });
			alert("保存配置失败");
		}
	}

	updateStatus(type, message) {
		const statusEl = document.getElementById("status");
		if (statusEl) {
			statusEl.className = `status ${type}`;
			statusEl.textContent = message;
		}
	}

	showSuccessStatus(articleUrl) {
		const statusEl = document.getElementById("status");
		if (statusEl) {
			statusEl.className = "status success";
			statusEl.innerHTML = `采集成功！<a href="${articleUrl}" target="_blank" class="status-link">查看文章 →</a>`;
		}
	}

	async loadHistory() {
		const historySection = document.getElementById("historySection");
		const historyList = document.getElementById("historyList");

		if (!historySection || !historyList) return;

		const history = await getHistory();

		if (history.length === 0) {
			historySection.classList.add("hidden");
			return;
		}

		historySection.classList.remove("hidden");
		historyList.innerHTML = "";

		for (const item of history.slice(0, 5)) {
			const itemEl = document.createElement("div");
			itemEl.className = "history-item";
			itemEl.onclick = () => {
				const targetUrl = item.articleId
					? `${this.#apiClient.frontendUrl}/article/${item.articleId}`
					: item.url;
				chrome.tabs.create({ url: targetUrl });
			};

			const thumbnailHtml = item.topImage
				? `<img class="history-item-thumbnail" src="${this.escapeHtml(item.topImage)}" alt="" />`
				: "";

			itemEl.innerHTML = `
        ${thumbnailHtml}
        <div class="history-item-content">
          <div class="history-item-title">${this.escapeHtml(item.title)}</div>
          <div class="history-item-meta">
            <span>${item.domain}</span>
            <span>${formatHistoryDate(item.collectedAt)}</span>
          </div>
        </div>
        ${item.categoryName ? `<span class="history-item-category">${this.escapeHtml(item.categoryName)}</span>` : ""}
      `;

			historyList.appendChild(itemEl);
		}
	}

	async clearHistoryList() {
		if (confirm("确定要清空采集历史吗？")) {
			await clearHistory();
			await this.loadHistory();
		}
	}

	escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text || "";
		return div.innerHTML;
	}
}

document.addEventListener("DOMContentLoaded", () => {
	const controller = new PopupController();
	controller.init();
});

export default PopupController;
