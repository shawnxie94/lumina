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
		采集成功: "Collected",
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
