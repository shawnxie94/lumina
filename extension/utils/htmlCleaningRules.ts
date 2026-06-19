export const HTML_CLEANING_URL_PATTERNS_KEY = "htmlCleaningUrlPatterns";
export const DEFAULT_HTML_CLEANING_URL_PATTERNS = "mp.weixin.qq.com";

const splitPatterns = (value: string): string[] =>
	value
		.split(/[\n,]+/)
		.map((item) => item.trim())
		.filter((item) => item && !item.startsWith("#"));

const escapeRegExp = (value: string): string =>
	value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");

const wildcardToRegExp = (pattern: string): RegExp => {
	const source = pattern
		.split("*")
		.map((part) => escapeRegExp(part))
		.join(".*");
	return new RegExp(`^${source}$`, "i");
};

const normalizeHost = (value: string): string => value.toLowerCase().replace(/\.+$/, "");

const matchHostRule = (url: URL, rawPattern: string): boolean => {
	const pattern = normalizeHost(rawPattern.replace(/^\*\./, ""));
	if (!pattern || pattern.includes("/") || pattern.includes(":")) {
		return false;
	}

	const hostname = normalizeHost(url.hostname);
	return hostname === pattern || hostname.endsWith(`.${pattern}`);
};

const matchHostPathRule = (url: URL, rawPattern: string): boolean => {
	if (!rawPattern.includes("/") || rawPattern.includes("://")) {
		return false;
	}
	const target = `${normalizeHost(url.hostname)}${url.pathname}${url.search}`;
	const pattern = rawPattern.toLowerCase().replace(/^\/+/, "");
	if (pattern.includes("*")) {
		return wildcardToRegExp(pattern).test(target);
	}
	return target === pattern || target.startsWith(pattern);
};

const matchUrlRule = (url: URL, rawPattern: string): boolean => {
	if (!rawPattern.includes("://")) {
		return false;
	}
	const target = url.href;
	if (rawPattern.includes("*")) {
		return wildcardToRegExp(rawPattern).test(target);
	}
	return target === rawPattern || target.startsWith(rawPattern);
};

export const normalizeHtmlCleaningUrlPatterns = (value: string): string =>
	splitPatterns(value).join("\n");

export const matchesHtmlCleaningUrl = (
	url: string | null | undefined,
	patterns: string | null | undefined,
): boolean => {
	if (!url || !patterns) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (!/^https?:$/i.test(parsed.protocol)) {
		return false;
	}

	return splitPatterns(patterns).some((pattern) => {
		if (pattern.includes("://")) {
			return matchUrlRule(parsed, pattern);
		}
		if (matchHostPathRule(parsed, pattern) || matchHostRule(parsed, pattern)) {
			return true;
		}
		if (pattern.includes("*") && pattern.includes("/")) {
			return wildcardToRegExp(pattern.toLowerCase()).test(
				`${normalizeHost(parsed.hostname)}${parsed.pathname}${parsed.search}`,
			);
		}
		if (pattern.includes("*")) {
			return wildcardToRegExp(pattern.toLowerCase()).test(
				normalizeHost(parsed.hostname),
			);
		}
		return false;
	});
};

export const loadHtmlCleaningUrlPatterns = async (): Promise<string> =>
	new Promise((resolve) => {
		chrome.storage.local.get([HTML_CLEANING_URL_PATTERNS_KEY], (result) => {
			if (Object.prototype.hasOwnProperty.call(result, HTML_CLEANING_URL_PATTERNS_KEY)) {
				resolve(String(result[HTML_CLEANING_URL_PATTERNS_KEY] || ""));
				return;
			}
			resolve(DEFAULT_HTML_CLEANING_URL_PATTERNS);
		});
	});

export const saveHtmlCleaningUrlPatterns = async (
	patterns: string,
): Promise<void> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.set(
			{
				[HTML_CLEANING_URL_PATTERNS_KEY]:
					normalizeHtmlCleaningUrlPatterns(patterns),
			},
			() => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
				} else {
					resolve();
				}
			},
		);
	});

export const shouldUseHtmlCleaningForUrl = async (
	url: string | null | undefined,
): Promise<boolean> => matchesHtmlCleaningUrl(url, await loadHtmlCleaningUrlPatterns());
