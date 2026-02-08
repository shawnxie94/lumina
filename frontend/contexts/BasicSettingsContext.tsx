import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { basicSettingsApi, type BasicSettings } from "@/lib/api";

const LANGUAGE_STORAGE_KEY = "ui_language";

const DEFAULT_BASIC_SETTINGS: BasicSettings = {
	default_language: "zh-CN",
	site_name: "Lumina",
	site_description: "信息灯塔",
	site_logo_url: "",
};

type LanguagePreference = "zh-CN" | "en" | null;
type LanguageOption = "zh-CN" | "en" | "system";

interface BasicSettingsContextType {
	basicSettings: BasicSettings;
	language: "zh-CN" | "en";
	languagePreference: LanguagePreference;
	setLanguagePreference: (next: LanguageOption) => void;
	refreshBasicSettings: () => Promise<BasicSettings>;
	updateBasicSettings: (next: BasicSettings) => void;
}

const BasicSettingsContext = createContext<BasicSettingsContextType | undefined>(
	undefined,
);

const getSystemLanguage = (): "zh-CN" | "en" | null => {
	if (typeof window === "undefined") return null;
	const browserLang = navigator.language?.toLowerCase() || "";
	if (browserLang.startsWith("zh")) return "zh-CN";
	if (browserLang.startsWith("en")) return "en";
	return null;
};

const resolveLanguage = (
	preference: LanguagePreference,
	settings: BasicSettings,
): "zh-CN" | "en" => {
	if (preference) return preference;
	return getSystemLanguage() || settings.default_language;
};

export function BasicSettingsProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [basicSettings, setBasicSettings] =
		useState<BasicSettings>(DEFAULT_BASIC_SETTINGS);
	const basicSettingsRef = useRef<BasicSettings>(DEFAULT_BASIC_SETTINGS);
	const [languagePreference, setLanguagePreferenceState] =
		useState<LanguagePreference>(null);
	const [language, setLanguage] = useState<"zh-CN" | "en">(
		DEFAULT_BASIC_SETTINGS.default_language,
	);

	const applyLanguage = useCallback(
		(nextPreference: LanguagePreference, settings: BasicSettings) => {
			const resolved = resolveLanguage(nextPreference, settings);
			setLanguage(resolved);
		},
		[],
	);

	const refreshBasicSettings = useCallback(async () => {
		try {
			const data = await basicSettingsApi.getPublicSettings();
			setBasicSettings(data);
			return data;
		} catch {
			return basicSettingsRef.current;
		}
	}, []);

	const updateBasicSettings = useCallback(
		(next: BasicSettings) => {
			setBasicSettings(next);
			if (!languagePreference) {
				setLanguage(next.default_language);
			}
		},
		[languagePreference],
	);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
		const storedPreference: LanguagePreference =
			stored === "zh-CN" || stored === "en" ? stored : null;
		setLanguagePreferenceState(storedPreference);
		(async () => {
			const data = await refreshBasicSettings();
			applyLanguage(storedPreference, data);
		})();
	}, [applyLanguage, refreshBasicSettings]);

	useEffect(() => {
		basicSettingsRef.current = basicSettings;
	}, [basicSettings]);

	useEffect(() => {
		if (languagePreference) return;
		setLanguage(resolveLanguage(null, basicSettings));
	}, [basicSettings.default_language, languagePreference]);

	const setLanguagePreference = useCallback(
		(next: LanguageOption) => {
			if (typeof window === "undefined") return;
			if (next === "system") {
				localStorage.removeItem(LANGUAGE_STORAGE_KEY);
				setLanguagePreferenceState(null);
				setLanguage(resolveLanguage(null, basicSettings));
				return;
			}
			localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
			setLanguagePreferenceState(next);
			setLanguage(next);
		},
		[basicSettings.default_language],
	);

	const value = useMemo(
		() => ({
			basicSettings,
			language,
			languagePreference,
			setLanguagePreference,
			refreshBasicSettings,
			updateBasicSettings,
		}),
		[
			basicSettings,
			language,
			languagePreference,
			setLanguagePreference,
			refreshBasicSettings,
			updateBasicSettings,
		],
	);

	return (
		<BasicSettingsContext.Provider value={value}>
			{children}
		</BasicSettingsContext.Provider>
	);
}

export function useBasicSettings() {
	const context = useContext(BasicSettingsContext);
	if (!context) {
		throw new Error("useBasicSettings must be used within a BasicSettingsProvider");
	}
	return context;
}
