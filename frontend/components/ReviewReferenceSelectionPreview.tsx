import { useEffect, useMemo, useRef, useState } from "react";

import { IconCheck } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import {
	buildReviewContentReferenceMarkdown,
	normalizeReviewReferenceSelectionText,
} from "@/lib/reviewReference";
import { renderSafeMarkdown } from "@/lib/safeHtml";

interface ReviewReferenceSelectionPreviewProps {
	articleSlug: string;
	articleTitle: string;
	markdown: string;
	onInsert: (markdown: string) => void;
}

interface ToolbarPosition {
	x: number;
	y: number;
}

export default function ReviewReferenceSelectionPreview({
	articleSlug,
	articleTitle,
	markdown,
	onInsert,
}: ReviewReferenceSelectionPreviewProps) {
	const { t } = useI18n();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [selectedText, setSelectedText] = useState("");
	const [toolbarPos, setToolbarPos] = useState<ToolbarPosition | null>(null);

	const previewHtml = useMemo(
		() => renderSafeMarkdown(markdown || "", { enableMediaEmbed: true }),
		[markdown],
	);

	useEffect(() => {
		setSelectedText("");
		setToolbarPos(null);
	}, [articleSlug, markdown]);

	useEffect(() => {
		const handleSelectionChange = () => {
			if (!containerRef.current) return;
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) {
				setSelectedText("");
				setToolbarPos(null);
				return;
			}

			const range = selection.getRangeAt(0);
			if (range.collapsed || !containerRef.current.contains(range.commonAncestorContainer)) {
				setSelectedText("");
				setToolbarPos(null);
				return;
			}

			const normalizedText = normalizeReviewReferenceSelectionText(selection.toString());
			if (!normalizedText) {
				setSelectedText("");
				setToolbarPos(null);
				return;
			}

			const rect = range.getBoundingClientRect();
			setSelectedText(normalizedText);
			setToolbarPos({
				x: Math.min(window.innerWidth - 132, Math.max(12, rect.right + 8)),
				y: Math.max(12, rect.top - 40),
			});
		};

		document.addEventListener("selectionchange", handleSelectionChange);
		return () => {
			document.removeEventListener("selectionchange", handleSelectionChange);
		};
	}, []);

	const handleInsert = () => {
		if (!selectedText) return;
		onInsert(
			buildReviewContentReferenceMarkdown({
				title: articleTitle,
				slug: articleSlug,
				excerpt: selectedText,
			}),
		);
		setSelectedText("");
		setToolbarPos(null);
		window.getSelection()?.removeAllRanges();
	};

	return (
		<div className="relative">
			<div
				ref={containerRef}
				className="review-reference-preview review-reference-preview--text-only prose prose-sm max-w-none min-h-[480px] max-h-[72vh] overflow-y-auto rounded-sm border border-border bg-surface px-5 py-5 text-text-2"
				dangerouslySetInnerHTML={{ __html: previewHtml }}
			/>

			{selectedText && toolbarPos ? (
				<div
					className="fixed z-50"
					style={{ left: toolbarPos.x, top: toolbarPos.y }}
				>
					<button
						type="button"
						onClick={handleInsert}
						aria-label={t("插入引用")}
						title={t("插入引用")}
						className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/95 text-primary shadow-lg transition hover:bg-primary-soft hover:text-primary-ink"
					>
						<IconCheck className="h-4 w-4" />
					</button>
				</div>
			) : null}
		</div>
	);
}
