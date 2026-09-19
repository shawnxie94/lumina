import { IconChevronRight } from "@/components/icons";
import { useI18n } from "@/lib/i18n";

interface ArticleLightboxProps {
	images: string[];
	index: number;
	onClose: () => void;
	onShift: (direction: -1 | 1) => void;
}

export default function ArticleLightbox({
	images,
	index,
	onClose,
	onShift,
}: ArticleLightboxProps) {
	const { t } = useI18n();
	const lightboxImage = images[index] || null;
	const hasLightboxMultiple = images.length > 1;

	if (!lightboxImage) return null;

	return (
		<div
			className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-[1px]"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-label={t("预览")}
		>
			<div
				className="relative flex h-full w-full items-center justify-center p-4 sm:p-6"
				onClick={(event) => event.stopPropagation()}
			>
				<button
					type="button"
					onClick={onClose}
					className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white transition hover:bg-black/55"
					aria-label={t("关闭")}
				>
					×
				</button>
				<div className="absolute left-4 top-4 z-10 rounded-full bg-black/35 px-3 py-1 text-xs text-white">
					{index + 1} / {images.length}
				</div>
				{hasLightboxMultiple && (
					<button
						type="button"
						onClick={() => onShift(-1)}
						className="absolute left-3 sm:left-4 top-1/2 z-10 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white transition hover:bg-black/55"
						aria-label={t("上一篇")}
					>
						<IconChevronRight className="h-6 w-6 rotate-180" />
					</button>
				)}
				<img
					src={lightboxImage}
					alt={t("预览")}
					className="max-h-[92vh] w-auto max-w-[96vw] object-contain"
					decoding="async"
				/>
				{hasLightboxMultiple && (
					<button
						type="button"
						onClick={() => onShift(1)}
						className="absolute right-3 sm:right-4 top-1/2 z-10 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white transition hover:bg-black/55"
						aria-label={t("下一篇")}
					>
						<IconChevronRight className="h-6 w-6" />
					</button>
				)}
			</div>
		</div>
	);
}
