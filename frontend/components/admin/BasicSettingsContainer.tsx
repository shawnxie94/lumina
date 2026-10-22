import { useEffect, useRef, useState } from "react";
import BasicSettingsSection from "./BasicSettingsSection";
import { basicSettingsApi, type BasicSettings } from "@/lib/api";
import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/lib/i18n";

export default function BasicSettingsContainer() {
	const { basicSettings, updateBasicSettings } = useBasicSettings();
	const [form, setForm] = useState<BasicSettings>(basicSettings);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const { showToast } = useToast();
	const { t } = useI18n();
	// Locale changes update notifications, never restart the form's load lifecycle.
	const notifications = useRef({ t, showToast });
	notifications.current = { t, showToast };
	useEffect(() => {
		let active = true;
		basicSettingsApi
			.getSettings()
			.then((data) => {
				if (active)
					setForm({
						...data,
						header_custom_links: data.header_custom_links || [],
					});
			})
			.catch((error) => {
				if (active) {
					console.error(error);
					const { t, showToast } = notifications.current;
					showToast(t("基础配置加载失败"), "error");
				}
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, []);
	const save = async () => {
		setSaving(true);
		try {
			await basicSettingsApi.updateSettings(form);
			updateBasicSettings(form);
			const { t, showToast } = notifications.current;
			showToast(t("基础配置已保存"));
		} catch (error) {
			console.error(error);
			const { t, showToast } = notifications.current;
			showToast(t("基础配置保存失败"), "error");
		} finally {
			setSaving(false);
		}
	};
	return (
		<BasicSettingsSection
			basicSettingsForm={form}
			setBasicSettingsForm={setForm}
			basicSettingsLoading={loading}
			basicSettingsSaving={saving}
			handleSaveBasicSettings={save}
			handleAddHeaderCustomLink={() =>
				setForm((prev) => ({
					...prev,
					header_custom_links: [
						...(prev.header_custom_links || []),
						{ label: "", url: "" },
					],
				}))
			}
			handleUpdateHeaderCustomLink={(index, field, value) =>
				setForm((prev) => ({
					...prev,
					header_custom_links: (prev.header_custom_links || []).map(
						(item, i) => (i === index ? { ...item, [field]: value } : item),
					),
				}))
			}
			handleRemoveHeaderCustomLink={(index) =>
				setForm((prev) => ({
					...prev,
					header_custom_links: (prev.header_custom_links || []).filter(
						(_, i) => i !== index,
					),
				}))
			}
		/>
	);
}
