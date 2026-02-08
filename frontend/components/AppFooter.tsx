import { useBasicSettings } from "@/contexts/BasicSettingsContext";
import { useI18n } from "@/lib/i18n";

export default function AppFooter() {
  const year = new Date().getFullYear();
  const { t } = useI18n();
  const { basicSettings } = useBasicSettings();
  const siteName = basicSettings.site_name || "Lumina";

  return (
    <footer className="bg-surface border-t border-border">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="text-center text-sm text-text-3">
          © {year}{" "}
          <a
            href="https://github.com/shawnxie94/lumina"
            target="_blank"
            rel="noreferrer"
            className="text-text-2 hover:text-primary transition"
          >
            {t("由 Lumina 驱动").replace("Lumina", siteName)}
          </a>
        </div>
      </div>
    </footer>
  );
}
