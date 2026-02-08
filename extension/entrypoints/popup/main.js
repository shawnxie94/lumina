import "../../styles/popup.css";
import { ApiClient } from "../../utils/api";
import {
	addToHistory,
	clearHistory,
	formatHistoryDate,
	getHistory,
} from "../../utils/history";
import {
	clearErrorLogs,
	formatLogTime,
	getErrorLogs,
	logError,
	setupGlobalErrorHandler,
} from "../../utils/errorLogger";
import { htmlToMarkdown } from "../../utils/markdownConverter";
import { ensureContentScriptLoaded } from "../../utils/contentScript";
import {
	resolveLanguage,
	setStoredLanguage,
	translate,
} from "../../utils/i18n";

setupGlobalErrorHandler("popup");

class PopupController {
	#apiClient;
	#isLoggedIn = false;
	#currentTab = null;
	#selectionAvailable = false;
	#toastTimer = null;
	#language = "zh-CN";

	constructor() {
		this.#apiClient = new ApiClient();
	}

	async init() {
		try {
			await this.loadLanguage();
			this.applyTranslations();
			await this.loadConfig();
			await this.setupEventListeners();
			this.checkApiHealth();
			await this.checkLoginStatus();

			if (!this.#isLoggedIn) {
				this.showLoginRequired();
				return;
			}

			await this.refreshSelectionState();
			await this.loadHistory();
			await this.loadErrorLogs();
		} catch (error) {
			console.error("Failed to initialize popup:", error);
			logError("popup", error, { action: "init" });
			this.updateStatus("error", this.t("初始化失败"));
		}
	}

	async loadLanguage() {
		this.#language = await resolveLanguage();
		if (document?.documentElement) {
			document.documentElement.lang = this.#language;
		}
	}

	t(key) {
		return translate(this.#language, key);
	}

	applyTranslations() {
		const elements = document.querySelectorAll("[data-i18n]");
		elements.forEach((el) => {
			const key = el.getAttribute("data-i18n");
			if (!key) return;
			const attrList = el.getAttribute("data-i18n-attr");
			if (attrList) {
				attrList.split(",").forEach((attr) => {
					const trimmed = attr.trim();
					if (!trimmed) return;
					el.setAttribute(trimmed, this.t(key));
				});
			}
			if (el.getAttribute("data-i18n-text") === "false") return;
			el.textContent = this.t(key);
		});
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
			loginStatus.textContent = this.#isLoggedIn
				? this.t("已登录")
				: this.t("未登录");
			loginStatus.className = `login-status ${this.#isLoggedIn ? "logged-in" : "logged-out"}`;
		}
	}

	showLoginRequired() {
		const mainContent = document.getElementById("mainContent");
		const loginPrompt = document.getElementById("loginPrompt");

		if (mainContent) mainContent.classList.add("hidden");
		if (loginPrompt) loginPrompt.classList.remove("hidden");

		this.updateStatus("warning", this.t("请先登录管理员账号"));
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
			statusEl.title = this.t("已连接 ({latency}ms)").replace(
				"{latency}",
				latency,
			);
		} else {
			dotEl.classList.add("disconnected");
			statusEl.title = this.t("无法连接到服务器，请检查配置");
		}
	}

	async setupEventListeners() {
		document.getElementById("closeBtn")?.addEventListener("click", () => {
			window.close();
		});

		document
			.getElementById("collectBtn")
			?.addEventListener("click", () => this.collectArticle());

		document
			.getElementById("configBtn")
			?.addEventListener("click", () => this.openConfigModal());
		document
			.getElementById("languageBtn")
			?.addEventListener("click", () => this.toggleLanguage());
		document
			.getElementById("homeLink")
			?.addEventListener("click", (event) => {
				event.preventDefault();
				this.openHomePage();
			});

		document
			.getElementById("saveConfigBtn")
			?.addEventListener("click", () => this.saveConfig());

		document
			.getElementById("cancelConfigBtn")
			?.addEventListener("click", () => this.closeConfigModal());


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

		document
			.getElementById("clearHistoryBtn")
			?.addEventListener("click", () => this.clearHistoryList());
		document
			.getElementById("clearErrorLogBtn")
			?.addEventListener("click", () => this.clearErrorLogList());
	}

	openHomePage() {
		chrome.tabs.create({ url: this.#apiClient.frontendUrl });
		window.close();
	}

	async refreshSelectionState() {
		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			this.#currentTab = tab;
			if (!tab?.id) return;
			const scriptLoaded = await ensureContentScriptLoaded(tab.id, {
				onError: (error) =>
					logError("popup", error, {
						action: "injectContentScript",
						tabId: tab.id,
					}),
			});
			if (!scriptLoaded) {
				this.updateStatus("error", this.t("无法在此页面提取内容"));
				return;
			}
			const selectionCheck = await chrome.tabs.sendMessage(tab.id, {
				type: "CHECK_SELECTION",
			});
			this.#selectionAvailable = Boolean(selectionCheck?.hasSelection);
			this.updateSelectionHint();
		} catch (error) {
			console.warn("Selection check failed:", error);
			this.#selectionAvailable = false;
			this.updateSelectionHint();
		}
	}

	updateSelectionHint() {
		const hintEl = document.getElementById("selectionHint");
		if (hintEl) {
			hintEl.textContent = this.#selectionAvailable
				? this.t("已检测到选区 · 将采集选中内容")
				: this.t("未检测到选区 · 将采集全文");
		}
	}

	async collectArticle() {
		this.updateStatus("loading", this.t("正在连接页面..."));

		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			this.#currentTab = tab;

			if (!tab?.id) {
				this.updateStatus("error", this.t("无法获取当前标签页"));
				return;
			}

			if (
				tab.url?.startsWith("chrome://") ||
				tab.url?.startsWith("chrome-extension://")
			) {
				this.updateStatus("error", this.t("无法在此页面提取内容"));
				return;
			}

			const scriptLoaded = await ensureContentScriptLoaded(tab.id, {
				onError: (error) =>
					logError("popup", error, {
						action: "injectContentScript",
						tabId: tab.id,
					}),
			});
			if (!scriptLoaded) {
				this.updateStatus("error", this.t("无法在此页面提取内容"));
				return;
			}

			let selectionCheck = null;
			try {
				selectionCheck = await chrome.tabs.sendMessage(tab.id, {
					type: "CHECK_SELECTION",
				});
			} catch (err) {
				console.log("Selection check failed:", err);
			}

			const hasSelection = Boolean(selectionCheck?.hasSelection);
			this.#selectionAvailable = hasSelection;
			this.updateSelectionHint();

			try {
				const xArticleCheck = await chrome.tabs.sendMessage(tab.id, {
					type: "CHECK_X_ARTICLE",
				});
				if (xArticleCheck?.shouldRedirect && xArticleCheck?.articleUrl) {
					this.updateStatus(
						"loading",
						this.t("检测到 X 长文章，正在跳转到专注模式..."),
					);
					await chrome.tabs.update(tab.id, { url: xArticleCheck.articleUrl });
					await new Promise((resolve) => setTimeout(resolve, 3000));
					await ensureContentScriptLoaded(tab.id, {
						onError: (error) =>
							logError("popup", error, {
								action: "injectContentScript",
								tabId: tab.id,
							}),
					});
				}
			} catch (err) {
				console.log("X article check failed:", err);
			}

			this.updateStatus(
				"loading",
				hasSelection ? this.t("正在提取选区...") : this.t("正在提取全文..."),
			);

			const extractedData = await chrome.tabs.sendMessage(tab.id, {
				type: hasSelection ? "EXTRACT_SELECTION" : "EXTRACT_ARTICLE",
				forceRefresh: !hasSelection,
			});

			if (!extractedData || !extractedData.content_html) {
				this.updateStatus(
					"error",
					this.t("未能提取到文章内容，请确认页面已加载完成"),
				);
				return;
			}

			const contentMd = this.htmlToMarkdown(extractedData.content_html);

			this.updateStatus("loading", this.t("正在上传内容..."));

			const result = await this.#apiClient.createArticle({
				title: extractedData.title || document.title,
				content_html: extractedData.content_html,
				content_md: contentMd,
				source_url: extractedData.source_url || tab.url,
				top_image: extractedData.top_image || null,
				author: extractedData.author || "",
				published_at: extractedData.published_at || this.getTodayDate(),
				source_domain: extractedData.source_domain || new URL(tab.url).hostname,
				content_structured: extractedData.content_structured || null,
			});

			this.updateStatus("success", this.t("采集成功"));
			await this.clearErrorLogList();

			const articleSlug = result?.slug || result?.id;
			await addToHistory({
				articleId: result?.id ? String(result.id) : String(articleSlug || ""),
				slug: articleSlug ? String(articleSlug) : undefined,
				title: extractedData.title || document.title || this.t("(无标题)"),
				url: extractedData.source_url || tab.url,
				domain: extractedData.source_domain || new URL(tab.url).hostname,
				topImage: extractedData.top_image || undefined,
			});
			await this.loadHistory();

			if (articleSlug) {
				const articleUrl = `${this.#apiClient.frontendUrl}/article/${articleSlug}`;
				chrome.tabs.create({ url: articleUrl });
				window.close();
			}
		} catch (error) {
			console.error("Failed to collect article:", error);
			logError("popup", error, {
				action: "collectArticle",
				url: this.#currentTab?.url,
			});

			if (error?.message === "UNAUTHORIZED") {
				await ApiClient.removeToken();
				this.#isLoggedIn = false;
				this.updateLoginUI();
				this.updateStatus("error", this.t("登录已过期，请重新登录"));
				return;
			}

			this.updateStatus("error", this.t("采集失败，请重试"));
		}
	}

	htmlToMarkdown(html) {
		return htmlToMarkdown(html, { source: "popup", logError });
	}

	getTodayDate() {
		try {
			const now = new Date();
			const year = now.getFullYear();
			const month = String(now.getMonth() + 1).padStart(2, "0");
			const day = String(now.getDate()).padStart(2, "0");
			return `${year}-${month}-${day}`;
		} catch (error) {
			logError("popup", error, { action: "getTodayDate" });
			return "";
		}
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

	async toggleLanguage() {
		const next = this.#language === "zh-CN" ? "en" : "zh-CN";
		await setStoredLanguage(next);
		this.#language = next;
		if (document?.documentElement) {
			document.documentElement.lang = this.#language;
		}
		this.applyTranslations();
		this.updateLoginUI();
		this.updateSelectionHint();
		this.checkApiHealth();
		await this.loadHistory();
		await this.loadErrorLogs();
		try {
			chrome.contextMenus?.update("collect-article", {
				title: this.t("采集到 Lumina"),
			});
		} catch {
			// ignore
		}
	}

	async saveConfig() {
		const apiHostInput = document.getElementById("apiHostInput");
		const newApiHost = apiHostInput?.value.trim();

		if (!newApiHost) {
			this.showToast(this.t("请输入有效的 API 地址"), "error");
			return;
		}

		try {
			await ApiClient.saveApiHost(newApiHost);
			this.showToast(this.t("配置已保存，页面将重新加载"), "success");
			this.closeConfigModal();
			setTimeout(() => location.reload(), 600);
		} catch (error) {
			console.error("Failed to save config:", error);
			logError("popup", error, { action: "saveConfig" });
			this.showToast(this.t("保存配置失败"), "error");
		}
	}

	updateStatus(type, message) {
		const statusEl = document.getElementById("status");
		const errorBox = document.getElementById("errorBox");
		if (statusEl) {
			if (!message) {
				statusEl.className = "status hidden";
				statusEl.textContent = "";
			} else {
				statusEl.className = `status ${type}`;
				statusEl.textContent = message;
			}
		}
		if (errorBox) {
			if (type === "error" && message) {
				errorBox.textContent = message;
				errorBox.classList.remove("hidden");
			} else {
				errorBox.textContent = "";
				errorBox.classList.add("hidden");
			}
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

		for (const item of history.slice(0, 3)) {
			const itemEl = document.createElement("div");
			itemEl.className = "history-item";
			itemEl.onclick = () => {
				const targetSlug = item.slug || item.articleId;
				const targetUrl = targetSlug
					? `${this.#apiClient.frontendUrl}/article/${targetSlug}`
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
            <span>${formatHistoryDate(item.collectedAt, this.#language)}</span>
          </div>
        </div>
      `;

			historyList.appendChild(itemEl);
		}
	}

	escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text || "";
		return div.innerHTML;
	}

	async clearHistoryList() {
		await clearHistory();
		await this.loadHistory();
	}

	showToast(message, type = "info") {
		const toast = document.getElementById("toast");
		if (!toast) return;
		toast.textContent = message;
		toast.className = `toast ${type}`;
		toast.classList.remove("hidden");
		requestAnimationFrame(() => toast.classList.add("show"));
		clearTimeout(this.#toastTimer);
		this.#toastTimer = setTimeout(() => {
			toast.classList.remove("show");
			setTimeout(() => toast.classList.add("hidden"), 200);
		}, 1800);
	}

	async loadErrorLogs() {
		const logSection = document.getElementById("errorLog");
		const logList = document.getElementById("errorLogList");
		if (!logSection || !logList) return;

		const logs = await getErrorLogs();
		const visible = logs.filter((log) => log.type === "error").slice(0, 3);
		if (visible.length === 0) {
			logSection.classList.add("hidden");
			logList.innerHTML = "";
			return;
		}

		logSection.classList.remove("hidden");
		logList.innerHTML = visible
			.map((log) => {
				const time = formatLogTime(log.timestamp);
				const source = log.source;
				const message = this.escapeHtml(log.message || "");
				return `
          <div class="error-log-item">
            <div class="error-log-meta">
              <span>${time}</span>
              <span>${source}</span>
            </div>
            <div class="error-log-message">${message}</div>
          </div>
        `;
			})
			.join("");
	}

	async clearErrorLogList() {
		await clearErrorLogs();
		await this.loadErrorLogs();
	}
}

document.addEventListener("DOMContentLoaded", () => {
	const controller = new PopupController();
	controller.init();
});

export default PopupController;
