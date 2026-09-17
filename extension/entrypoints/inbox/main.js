import "../../styles/inbox.css";
import { ApiClient } from "../../utils/api";
import { addToHistory, formatHistoryDate } from "../../utils/history";
import { logError, setupGlobalErrorHandler } from "../../utils/errorLogger";
import {
	clearInbox,
	getInboxItemSnippet,
	getInboxItems,
	removeInboxItem,
	updateInboxItem,
} from "../../utils/inbox";
import { resolveLanguage, translate } from "../../utils/i18n";

setupGlobalErrorHandler("inbox");

class InboxController {
	#apiClient = new ApiClient();
	#language = "zh-CN";
	#items = [];
	#selectedId = null;
	#dirty = false;
	#isLoggedIn = false;
	#pushing = false;
	#toastTimer = null;
	#saveTimer = null;
	#autosaveTimer = null;

	async init() {
		try {
			await this.loadLanguage();
			this.applyTranslations();
			await this.loadConfig();
			await this.checkLoginStatus();
			this.setupEventListeners();
			this.bindDirtyTracking();
			await this.loadItems();
		} catch (error) {
			console.error("Failed to initialize inbox:", error);
			logError("inbox", error, { action: "init" });
			this.showToast(this.t("初始化失败"), "error");
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
	}

	async checkLoginStatus() {
		const result = await this.#apiClient.verifyToken();
		this.#isLoggedIn = result.valid && result.role === "admin";
		this.updateLoginUI();
	}

	updateLoginUI() {
		const banner = document.getElementById("loginBanner");
		const pushBtn = document.getElementById("pushItemBtn");
		if (banner) banner.classList.toggle("hidden", this.#isLoggedIn);
		if (pushBtn) {
			pushBtn.disabled = !this.#isLoggedIn;
			pushBtn.title = this.#isLoggedIn
				? ""
				: this.t("未登录 Lumina · 可正常暂存和编辑，授权后可推送到 Lumina");
		}
	}

	setupEventListeners() {
		document
			.getElementById("pushItemBtn")
			?.addEventListener("click", () => this.pushItem());
		document
			.getElementById("deleteItemBtn")
			?.addEventListener("click", () => this.deleteItem());
		document
			.getElementById("clearInboxBtn")
			?.addEventListener("click", () => this.clearAll());
		window.addEventListener("pagehide", () => {
			// Fire-and-forget flush; storage writes usually complete during unload.
			this.flushPendingSave();
		});
	}

	bindDirtyTracking() {
		for (const id of [
			"fieldTitle",
			"fieldAuthor",
			"fieldPublishedAt",
			"fieldSourceUrl",
			"fieldTopImage",
			"fieldContent",
		]) {
			const el = document.getElementById(id);
			el?.addEventListener("input", () => this.scheduleAutoSave());
			el?.addEventListener("change", () => this.scheduleAutoSave());
		}
	}

	/** Debounced auto-persist: edits land in chrome.storage without a save button. */
	scheduleAutoSave() {
		this.#dirty = true;
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			this.autoSave().catch((error) => {
				console.error("Auto-save failed:", error);
				logError("inbox", error, { action: "autoSave" });
			});
		}, 600);
	}

	async flushPendingSave() {
		clearTimeout(this.#saveTimer);
		if (!this.#dirty) return;
		await this.autoSave();
	}

	async autoSave() {
		const selected = this.getSelectedItem();
		if (!selected) return;

		const patch = this.readEditorPatch();
		// Mid-typing the title can be transiently empty; keep the stored one.
		if (!patch.title) return;

		const saved = await updateInboxItem(selected.id, patch);
		this.#dirty = false;
		if (!saved) return;

		Object.assign(selected, patch);
		this.renderList();
		this.showAutosaveIndicator();
	}

	showAutosaveIndicator() {
		const el = document.getElementById("autosaveStatus");
		if (!el) return;
		el.textContent = this.t("已自动保存");
		el.classList.add("visible");
		clearTimeout(this.#autosaveTimer);
		this.#autosaveTimer = setTimeout(() => el.classList.remove("visible"), 2000);
	}

	async loadItems() {
		this.#items = await getInboxItems();

		if (
			this.#selectedId &&
			!this.#items.some((item) => item.id === this.#selectedId)
		) {
			this.#selectedId = null;
			this.#dirty = false;
		}
		if (!this.#selectedId && this.#items.length > 0) {
			this.#selectedId = this.#items[0].id;
		}

		this.renderList();
		this.renderEditor();
	}

	renderList() {
		const listEl = document.getElementById("inboxList");
		const countEl = document.getElementById("inboxCount");
		if (!listEl) return;
		if (countEl) countEl.textContent = String(this.#items.length);

		listEl.innerHTML = "";
		if (this.#items.length === 0) {
			listEl.innerHTML = "";
			return;
		}

		for (const item of this.#items) {
			const itemEl = document.createElement("div");
			itemEl.className =
				"inbox-item" + (item.id === this.#selectedId ? " active" : "");
			itemEl.onclick = () => this.maybeSelectItem(item.id);

			const snippetText = getInboxItemSnippet(item);
			const snippet = this.escapeHtml(
				snippetText || this.t("仅链接 · 未提取到正文"),
			);
			const thumbnailHtml = item.topImage
				? `<img class="inbox-item-thumbnail" src="${this.escapeHtml(item.topImage)}" alt="" />`
				: "";

			itemEl.innerHTML = `
        ${thumbnailHtml}
        <div class="inbox-item-content">
          <div class="inbox-item-title">${this.escapeHtml(item.title)}</div>
          <div class="inbox-item-snippet${snippetText ? "" : " empty"}">${snippet}</div>
          <div class="inbox-item-meta">
            <span>${this.escapeHtml(item.domain || "")}</span>
            <span>${formatHistoryDate(item.savedAt, this.#language)}</span>
          </div>
        </div>
      `;

			listEl.appendChild(itemEl);
		}
	}

	renderEditor() {
		const emptyEl = document.getElementById("editorEmpty");
		const wrapEl = document.getElementById("editorWrap");
		const selected = this.getSelectedItem();

		if (!selected) {
			if (emptyEl) emptyEl.classList.remove("hidden");
			if (wrapEl) wrapEl.classList.add("hidden");
			return;
		}

		if (emptyEl) emptyEl.classList.add("hidden");
		if (wrapEl) wrapEl.classList.remove("hidden");

		document.getElementById("fieldTitle").value = selected.title || "";
		document.getElementById("fieldAuthor").value = selected.author || "";
		document.getElementById("fieldPublishedAt").value = this.toDateInputValue(
			selected.publishedAt,
		);
		document.getElementById("fieldSourceUrl").value = selected.url || "";
		document.getElementById("fieldTopImage").value = selected.topImage || "";
		document.getElementById("fieldContent").value = selected.contentMd || "";

		const savedAtEl = document.getElementById("editorSavedAt");
		if (savedAtEl) {
			savedAtEl.textContent = `${this.t("暂存于")} ${formatHistoryDate(selected.savedAt, this.#language)}`;
		}
		const sourceLink = document.getElementById("openSourceLink");
		if (sourceLink) {
			if (selected.url && /^https?:\/\//i.test(selected.url)) {
				sourceLink.href = selected.url;
				sourceLink.classList.remove("hidden");
			} else {
				sourceLink.removeAttribute("href");
				sourceLink.classList.add("hidden");
			}
		}

		const autosaveEl = document.getElementById("autosaveStatus");
		if (autosaveEl) autosaveEl.classList.remove("visible");
		clearTimeout(this.#saveTimer);
		this.#dirty = false;
	}

	getSelectedItem() {
		return this.#items.find((item) => item.id === this.#selectedId) || null;
	}

	toDateInputValue(value) {
		const raw = (value || "").trim();
		if (!raw) return "";
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
		const date = new Date(raw);
		if (Number.isNaN(date.getTime())) return "";
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${date.getFullYear()}-${month}-${day}`;
	}

	async maybeSelectItem(id) {
		if (id === this.#selectedId) return;
		await this.flushPendingSave();
		this.#selectedId = id;
		this.renderList();
		this.renderEditor();
	}

	readEditorPatch() {
		const title = document.getElementById("fieldTitle").value.trim();
		const url = document.getElementById("fieldSourceUrl").value.trim();
		let domain = this.getSelectedItem()?.domain || "";
		if (url) {
			try {
				domain = new URL(url).hostname || domain;
			} catch {
				// keep previous domain for non-URL text
			}
		}
		return {
			title,
			url,
			domain,
			author: document.getElementById("fieldAuthor").value.trim(),
			publishedAt: document.getElementById("fieldPublishedAt").value,
			topImage: document.getElementById("fieldTopImage").value.trim() || null,
			contentMd: document.getElementById("fieldContent").value,
		};
	}

	async pushItem() {
		const selected = this.getSelectedItem();
		if (!selected || this.#pushing) return;

		// Flush debounced edits so the push and the inbox carry the latest text.
		await this.flushPendingSave();

		const patch = this.readEditorPatch();
		if (!patch.title) {
			this.showToast(this.t("请输入标题"), "error");
			return;
		}
		const item = { ...selected, ...patch };

		this.#pushing = true;
		const pushBtn = document.getElementById("pushItemBtn");
		if (pushBtn) pushBtn.disabled = true;

		try {
			const contentMd = (item.contentMd || "").trim();
			const publishedAt = item.publishedAt
				? item.publishedAt
				: new Date().toISOString();

			let result;
			if (contentMd) {
				// Edited markdown is the final body; backend renders from md.
				// No skip_ai_processing: summary/classification/translation
				// follow admin settings, same as the extension collect path.
				result = await this.#apiClient.createArticle({
					title: item.title,
					content_html: "",
					content_md: contentMd,
					source_url: item.url || "",
					top_image: item.topImage || null,
					author: item.author || "",
					published_at: publishedAt,
					source_domain: item.domain || "",
				});
			} else {
				if (!item.url) {
					this.showToast(this.t("暂存缺少链接和正文，无法推送"), "error");
					return;
				}
				result = await this.#apiClient.reportArticleByUrl({ url: item.url });
			}

			const isDuplicate =
				result &&
				typeof result === "object" &&
				"code" in result &&
				result.code === "source_url_exists" &&
				result.existing;
			const articleSlug = isDuplicate
				? result.existing?.slug || result.existing?.id
				: result.slug || result.id;
			const articleId = isDuplicate ? result.existing?.id : result.id;
			const articleTitle =
				(isDuplicate ? result.existing?.title : "") || item.title;

			await addToHistory({
				articleId: articleId ? String(articleId) : "",
				slug: articleSlug ? String(articleSlug) : undefined,
				title: articleTitle,
				url: item.url || "",
				domain: item.domain || "",
				topImage: item.topImage || undefined,
			});

			await removeInboxItem(selected.id);
			await this.loadItems();
			this.showToast(
				isDuplicate ? this.t("文章已存在，已打开现有文章") : this.t("推送成功，正在打开文章..."),
				"success",
			);

			if (articleSlug) {
				chrome.tabs.create({
					url: `${this.#apiClient.frontendUrl}/article/${articleSlug}`,
				});
			}
		} catch (error) {
			console.error("Failed to push inbox item:", error);
			if (error?.message === "UNAUTHORIZED") {
				await ApiClient.removeToken();
				this.#apiClient.setToken(null);
				this.#isLoggedIn = false;
				this.updateLoginUI();
				this.showToast(this.t("登录已过期，请重新登录"), "error");
				return;
			}
			logError("inbox", error, { action: "pushItem", itemId: selected.id });
			this.showToast(this.t("推送失败"), "error");
		} finally {
			this.#pushing = false;
			if (pushBtn) pushBtn.disabled = !this.#isLoggedIn;
		}
	}

	async deleteItem() {
		const selected = this.getSelectedItem();
		if (!selected) return;
		if (!confirm(this.t("确认删除这条暂存？"))) return;

		try {
			clearTimeout(this.#saveTimer);
			await removeInboxItem(selected.id);
			this.#selectedId = null;
			this.#dirty = false;
			await this.loadItems();
			this.showToast(this.t("已删除"), "success");
		} catch (error) {
			console.error("Failed to delete inbox item:", error);
			logError("inbox", error, { action: "deleteItem", itemId: selected.id });
			this.showToast(this.t("删除失败"), "error");
		}
	}

	async clearAll() {
		if (this.#items.length === 0) return;
		if (!confirm(this.t("确认清空暂存箱？该操作不可恢复"))) return;

		try {
			clearTimeout(this.#saveTimer);
			await clearInbox();
			this.#selectedId = null;
			this.#dirty = false;
			await this.loadItems();
			this.showToast(this.t("已清空"), "success");
		} catch (error) {
			console.error("Failed to clear inbox:", error);
			logError("inbox", error, { action: "clearInbox" });
			this.showToast(this.t("清空失败"), "error");
		}
	}

	escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text || "";
		return div.innerHTML;
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
		}, 2200);
	}
}

document.addEventListener("DOMContentLoaded", () => {
	const controller = new InboxController();
	controller.init();
});

export default InboxController;
