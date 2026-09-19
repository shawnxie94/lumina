import Link from "next/link";
import type { ReactNode } from "react";

import { MindMapTree } from "@/components/article/MindMap";
import {
	IconBolt,
	IconCopy,
	IconEdit,
	IconRefresh,
} from "@/components/icons";
import { canManuallyGenerateAIContent } from "@/lib/aiTaskStatus";
import { useI18n } from "@/lib/i18n";
import { parseMindMapOutline } from "@/lib/mindMap";
import { renderSafeMarkdown } from "@/lib/safeHtml";

interface AIContentSectionProps {
	title: string;
	content: string | null | undefined;
	status: string | null | undefined;
	onGenerate: () => void;
	onCopy: () => void;
	copyTitle?: string;
	canEdit?: boolean;
	canUpdate?: boolean;
	onUpdate?: (content: string) => void;
	renderMarkdown?: boolean;
	renderMindMap?: boolean;
	onMindMapOpen?: () => void;
	showStatus?: boolean;
	statusLink?: string;
	showHeader?: boolean;
	canCopy?: boolean;
	customContent?: ReactNode;
	extraActions?: ReactNode;
	footerContent?: ReactNode;
}

function AIContentSection({
	title,
	content,
	status,
	onGenerate,
	onCopy,
	copyTitle,
	canEdit = false,
	canUpdate = false,
	onUpdate,
	renderMarkdown = false,
	renderMindMap = false,
	onMindMapOpen,
	showStatus = false,
	statusLink,
	showHeader = true,
	canCopy = true,
	customContent,
	extraActions,
	footerContent,
}: AIContentSectionProps) {
	const { t } = useI18n();
	const getStatusBadge = () => {
		if (!status) return null;
		const statusConfig: Record<
			string,
			{ bg: string; text: string; label: string }
		> = {
			pending: { bg: "bg-muted", text: "text-text-2", label: t("等待处理") },
			processing: {
				bg: "bg-info-soft",
				text: "text-info-ink",
				label: t("生成中..."),
			},
			completed: {
				bg: "bg-success-soft",
				text: "text-success-ink",
				label: t("已完成"),
			},
			partial_completed: {
				bg: "bg-warning-soft",
				text: "text-warning-ink",
				label: t("部分完成"),
			},
			skipped: {
				bg: "bg-muted",
				text: "text-text-3",
				label: t("已跳过"),
			},
			failed: {
				bg: "bg-danger-soft",
				text: "text-danger-ink",
				label: t("失败"),
			},
		};
		const config = statusConfig[status];
		if (!config) return null;
		return (
			<span
				className={`px-2 py-0.5 rounded text-xs ${config.bg} ${config.text}`}
			>
				{config.label}
			</span>
		);
	};

	const showGenerateButton =
		canEdit && canManuallyGenerateAIContent(status, content);
	const statusBadge = showStatus ? getStatusBadge() : null;

	return (
		<div>
			{showHeader && (
				<div className="flex items-center justify-between gap-4 mb-2">
					<div className="flex items-center gap-2 pr-2">
						<h3 className="font-semibold text-text-1">{title}</h3>
					</div>
					<div className="flex items-center gap-2">
						{statusBadge && statusLink ? (
							<Link href={statusLink} className="hover:opacity-80 transition">
								{statusBadge}
							</Link>
						) : (
							statusBadge
						)}
						{extraActions}
						{showGenerateButton && (
							<button
								onClick={onGenerate}
								className="text-text-3 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
								title={content ? t("重新生成") : t("生成")}
								aria-label={content ? t("重新生成") : t("生成")}
								type="button"
							>
								{content ? (
									<IconRefresh className="h-4 w-4" />
								) : (
									<IconBolt className="h-4 w-4" />
								)}
							</button>
						)}
						{content && canCopy && (
							<button
								onClick={onCopy}
								className="text-text-3 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
								title={copyTitle || t("复制内容")}
								aria-label={copyTitle || t("复制内容")}
								type="button"
							>
								<IconCopy className="h-4 w-4" />
							</button>
						)}
						{content && canUpdate && onUpdate && (
							<button
								onClick={() => onUpdate(content)}
								className="text-text-3 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
								title={t("编辑内容")}
								aria-label={t("编辑内容")}
								type="button"
							>
								<IconEdit className="h-4 w-4" />
							</button>
						)}
					</div>
				</div>
			)}
			{content ? (
				customContent ? (
					customContent
				) : renderMindMap ? (
					(() => {
						const tree = parseMindMapOutline(content);
						return tree ? (
							<div className="rounded-lg border border-border bg-muted p-2">
								<div className="max-h-[28rem] overflow-auto">
									<MindMapTree
										node={tree}
										compact
										defaultExpandedDepth={2}
										showToolbar
										onOpenFullscreen={onMindMapOpen}
									/>
								</div>
							</div>
						) : (
							<div className="text-text-2 text-sm whitespace-pre-wrap">
								{content}
							</div>
						);
					})()
				) : renderMarkdown ? (
					<div
						className="prose prose-sm max-w-none rounded-lg border border-border bg-muted p-3 text-text-2"
						dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(content) }}
					/>
				) : (
					<div className="text-text-2 text-sm whitespace-pre-wrap">
						{content}
					</div>
				)
			) : showStatus ? (
				<p className="text-text-3 text-sm">
					{status === "processing" ? t("正在生成...") : t("未生成")}
				</p>
			) : null}
			{footerContent ? <div className="mt-3">{footerContent}</div> : null}
		</div>
	);
}

export default AIContentSection;
