export type ExtensionLanguage = "zh-CN" | "en";
export type ExtensionLanguageOption = ExtensionLanguage | "system";

const LANGUAGE_STORAGE_KEY = "ui_language";

const translations: Record<ExtensionLanguage, Record<string, string>> = {
	"zh-CN": {},
	en: {
		"打开 Lumina 首页": "Open Lumina home",
		"Lumina 未授权": "Lumina not authorized",
		授权: "Authorize",
		取消授权: "Revoke access",
		"检测中...": "Checking...",
		设置: "Settings",
		关闭: "Close",
		"需要 Lumina 管理员权限才能采集文章":
			"Admin access required to collect articles.",
		去授权: "Authorize",
		"修改 API 地址": "Edit API URL",
		采集范围: "Collection range",
		"正在检测选区...": "Checking selection...",
		采集: "Collect",
		最近采集: "Recent",
		清空: "Clear",
		错误记录: "Error log",
		配置: "Configuration",
		"Lumina API 地址": "Lumina API URL",
		保存: "Save",
		取消: "Cancel",
		初始化失败: "Initialization failed",
		已登录: "Logged in",
		未登录: "Logged out",
		"请先登录管理员账号": "Please sign in as admin.",
		"已连接 ({latency}ms)": "Connected ({latency}ms)",
		"无法连接到服务器，请检查配置":
			"Cannot reach server. Check configuration.",
		无法在此页面提取内容: "Cannot extract content from this page.",
		"已检测到选区 · 将采集选中内容":
			"Selection detected · will collect selection.",
		"未检测到选区 · 将采集全文":
			"No selection · will collect full article.",
		"正在连接页面...": "Connecting to page...",
		无法获取当前标签页: "Unable to get current tab.",
		"检测到 X 长文章，正在跳转到专注模式...":
			"Long X article detected, opening reader view...",
		"正在提取选区...": "Extracting selection...",
		"正在提取全文...": "Extracting full article...",
		"未能提取到文章内容，请确认页面已加载完成":
			"Failed to extract content. Make sure the page is fully loaded.",
		"正在上传内容...": "Uploading content...",
		已转入后台采集: "Collecting in background...",
		"正在解析链接...": "Parsing URL...",
		采集成功: "Collected",
		文章已存在: "Article already exists",
		"(无标题)": "(Untitled)",
		"登录已过期，请重新登录": "Login expired. Please sign in again.",
		"采集失败，请重试": "Collection failed. Please retry.",
		"请输入有效的 API 地址": "Please enter a valid API URL.",
		"配置已保存，页面将重新加载": "Saved. The page will reload.",
		保存配置失败: "Failed to save configuration.",
		语言: "Language",
		"采集到 Lumina": "Captured to Lumina",
		采集失败: "Collection failed",
		"无法在此页面运行，请刷新页面后重试":
			"Cannot run on this page. Refresh and try again.",
		未命名: "Untitled",
		"提取内容时出错，请刷新页面后重试":
			"Extraction failed. Refresh and try again.",
		"当前链接属于本机或内网地址，URL上报已禁用":
			"This link points to localhost or private network, URL report is blocked.",
		暂存: "Stash",
		暂存箱: "Inbox",
		"未登录 · 暂存仅保存在浏览器本地，采集需先授权":
			"Signed out · Stash stays in this browser. Authorize to collect.",
		"正在提取内容...": "Extracting content...",
		"已暂存到收件箱（本地）": "Saved to inbox (local)",
		"暂存失败，请重试": "Stash failed. Please retry.",
		暂存箱为空: "Inbox is empty",
		"在网页上点击插件弹窗中的「暂存」，即可把链接和正文保存到这里，阅读后再推送到 Lumina":
			"Click “Stash” in the extension popup to save the link and content here. Read it later, then decide whether to push to Lumina.",
		"打开原链接": "Open source",
		"推送到 Lumina": "Push to Lumina",
		删除: "Delete",
		"未登录 Lumina · 可正常暂存和编辑，授权后可推送到 Lumina":
			"Not signed in to Lumina · stash and editing work locally. Authorize to push.",
		标题: "Title",
		请输入文章标题: "Enter article title",
		作者: "Author",
		请输入作者: "Enter author",
		发表时间: "Published",
		"来源 URL": "Source URL",
		请输入来源链接: "Enter source link",
		"头图 URL": "Cover image URL",
		请输入头图链接: "Enter cover image link",
		"内容（Markdown）": "Content (Markdown)",
		编辑: "Edit",
		预览: "Preview",
		暂无内容: "Nothing to preview yet",
		"仅链接 · 未提取到正文": "Link only · no content captured",
		暂存于: "Saved",
		已自动保存: "Autosaved",
		"暂存缺少链接和正文，无法推送":
			"Item has neither link nor content; cannot push.",
		请输入标题: "Please enter a title.",
		"推送成功，正在打开文章...": "Pushed. Opening article...",
		"文章已存在，已打开现有文章": "Article exists; opened the existing one.",
		推送失败: "Push failed",
		"确认删除这条暂存？": "Delete this stashed item?",
		已删除: "Deleted",
		删除失败: "Failed to delete",
		"确认清空暂存箱？该操作不可恢复": "Clear the inbox? This cannot be undone.",
		已清空: "Cleared",
		清空失败: "Failed to clear",
	},
};

export const translate = (language: ExtensionLanguage, key: string): string => {
	if (language === "zh-CN") return key;
	const map = translations.en;
	return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
};

export const getSystemLanguage = (): ExtensionLanguage | null => {
	const raw =
		typeof chrome !== "undefined" && chrome.i18n?.getUILanguage
			? chrome.i18n.getUILanguage()
			: typeof navigator !== "undefined"
				? navigator.language
				: "";
	const normalized = raw.toLowerCase();
	if (normalized.startsWith("zh")) return "zh-CN";
	if (normalized.startsWith("en")) return "en";
	return null;
};

export const getStoredLanguage = async (): Promise<ExtensionLanguage | null> =>
	new Promise((resolve) => {
		chrome.storage.local.get([LANGUAGE_STORAGE_KEY], (result) => {
			const value = result[LANGUAGE_STORAGE_KEY];
			resolve(value === "zh-CN" || value === "en" ? value : null);
		});
	});

export const setStoredLanguage = async (
	next: ExtensionLanguageOption,
): Promise<void> => {
	if (next === "system") {
		return new Promise((resolve) => {
			chrome.storage.local.remove([LANGUAGE_STORAGE_KEY], () => resolve());
		});
	}
	return new Promise((resolve) => {
		chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: next }, () => resolve());
	});
};

export const resolveLanguage = async (): Promise<ExtensionLanguage> => {
	const stored = await getStoredLanguage();
	return stored || getSystemLanguage() || "zh-CN";
};
