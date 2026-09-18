import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
} from "react";

import ModalShell from "@/components/ui/ModalShell";
import { useI18n } from "@/lib/i18n";
import {
	buildDefaultOutlineExpandedPaths,
	collectOutlineExpandablePaths,
	countOutlineDescendants,
	parseMindMapOutline,
	type MindMapNode,
} from "@/lib/mindMap";

function OutlineTreeNode({
	node,
	path,
	depth,
	compact,
	expandedPaths,
	onToggle,
}: {
	node: MindMapNode;
	path: string;
	depth: number;
	compact: boolean;
	expandedPaths: Set<string>;
	onToggle: (path: string) => void;
}) {
	const { t } = useI18n();
	const hasTitle = Boolean(node.title && node.title.trim().length > 0);
	const children = node.children || [];
	const hasChildren = children.length > 0;
	const isExpanded = hasChildren && expandedPaths.has(path);
	const descendantCount = hasChildren ? countOutlineDescendants(node) : 0;
	const isRootNode = depth === 0;

	const palette = [
		"border-info-soft bg-info-soft text-info-ink",
		"border-success-soft bg-success-soft text-success-ink",
		"border-warning-soft bg-warning-soft text-warning-ink",
		"border-primary-soft bg-primary-soft text-primary-ink",
	];
	const colorClass = palette[depth % palette.length];

	const containerClass = isRootNode
		? compact
			? "space-y-2"
			: "space-y-4"
		: compact
			? "pl-3 border-l border-border space-y-2"
			: "pl-5 border-l border-border space-y-4";

	const chipClass = compact
		? `inline-flex max-w-full items-center rounded-md border px-2 py-1 text-xs shadow-sm ${colorClass}`
		: `inline-flex max-w-full items-center rounded-lg border px-3 py-1.5 text-sm shadow-sm ${colorClass}`;

	const handleToggle = (event: ReactMouseEvent | ReactKeyboardEvent) => {
		event.stopPropagation();
		if (!hasChildren) return;
		onToggle(path);
	};

	return (
		<div className={containerClass}>
			{hasTitle && (
				<div
					className={
						isRootNode
							? "flex items-start gap-1.5"
							: compact
								? "flex items-start gap-2 -ml-3"
								: "flex items-start gap-3 -ml-5"
					}
				>
					{!isRootNode && (
						<span
							className={
								compact
									? "mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border"
									: "mt-2 h-2 w-2 shrink-0 rounded-full bg-border"
							}
						/>
					)}
					{hasChildren ? (
						<button
							type="button"
							onClick={handleToggle}
							className={`${chipClass} text-left transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35`}
							aria-expanded={isExpanded}
							aria-label={isExpanded ? t("全部折叠") : t("全部展开")}
						>
							<span className="break-words">{node.title}</span>
							{!isExpanded && descendantCount > 0 && (
								<span className="ml-1.5 shrink-0 rounded-full bg-surface/70 px-1.5 py-0.5 text-[10px] font-medium opacity-80">
									+{descendantCount}
								</span>
							)}
							<span
								className={`ml-1.5 shrink-0 text-[10px] opacity-70 transition-transform ${
									isExpanded ? "rotate-90" : ""
								}`}
							>
								▶
							</span>
						</button>
					) : (
						<span className={`${chipClass} break-words`}>{node.title}</span>
					)}
				</div>
			)}
			{!hasTitle && hasChildren && (
				<button
					type="button"
					onClick={handleToggle}
					className="text-xs text-text-3 hover:text-text-1 transition"
					aria-expanded={isExpanded}
				>
					{isExpanded ? t("全部折叠") : `+${descendantCount}`}
				</button>
			)}
			{hasChildren && isExpanded && (
				<div className={compact ? "space-y-2" : "space-y-5"}>
					{children.map((child, index) => (
						<OutlineTreeNode
							key={`${path}.${index}-${child.title || "node"}`}
							node={child}
							path={`${path}.${index}`}
							depth={depth + 1}
							compact={compact}
							expandedPaths={expandedPaths}
							onToggle={onToggle}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export function MindMapTree({
	node,
	compact = false,
	defaultExpandedDepth = 2,
	showToolbar = false,
	onOpenFullscreen,
}: {
	node: MindMapNode;
	compact?: boolean;
	/** Visible structure through this depth; deeper nodes start collapsed. */
	defaultExpandedDepth?: number;
	showToolbar?: boolean;
	onOpenFullscreen?: () => void;
}) {
	const { t } = useI18n();
	const allExpandablePaths = useMemo(
		() => collectOutlineExpandablePaths(node),
		[node],
	);
	const defaultExpandedPaths = useMemo(
		() => buildDefaultOutlineExpandedPaths(node, defaultExpandedDepth),
		[node, defaultExpandedDepth],
	);
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
		() => new Set(defaultExpandedPaths),
	);

	useEffect(() => {
		setExpandedPaths(new Set(defaultExpandedPaths));
	}, [defaultExpandedPaths]);

	const togglePath = useCallback((path: string) => {
		setExpandedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	const expandAll = useCallback(() => {
		setExpandedPaths(new Set(allExpandablePaths));
	}, [allExpandablePaths]);

	const collapseToDefault = useCallback(() => {
		setExpandedPaths(new Set(defaultExpandedPaths));
	}, [defaultExpandedPaths]);

	const collapseAll = useCallback(() => {
		// Keep root branch open so the first level stays scannable.
		const rootOnly = new Set<string>();
		if (node.children?.length) rootOnly.add("root");
		setExpandedPaths(rootOnly);
	}, [node]);

	return (
		<div className="space-y-2">
			{showToolbar && (
				<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-text-3">
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							expandAll();
						}}
						className="hover:text-primary transition"
					>
						{t("全部展开")}
					</button>
					<span className="text-border">·</span>
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							collapseToDefault();
						}}
						className="hover:text-primary transition"
					>
						{t("默认层级")}
					</button>
					<span className="text-border">·</span>
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							collapseAll();
						}}
						className="hover:text-primary transition"
					>
						{t("全部折叠")}
					</button>
					{onOpenFullscreen && (
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onOpenFullscreen();
							}}
							className="ml-auto text-text-3 hover:text-primary transition"
						>
							{t("点击放大")}
						</button>
					)}
				</div>
			)}
			<div className={compact ? "space-y-2" : "space-y-4"}>
				<OutlineTreeNode
					node={node}
					path="root"
					depth={0}
					compact={compact}
					expandedPaths={expandedPaths}
					onToggle={togglePath}
				/>
			</div>
		</div>
	);
}

export function MindMapModal({
	open,
	outline,
	onClose,
}: {
	open: boolean;
	outline: string | null | undefined;
	onClose: () => void;
}) {
	const { t } = useI18n();
	if (!open || !outline) return null;
	const tree = parseMindMapOutline(outline || "");
	if (!tree) return null;
	return (
		<ModalShell
			isOpen={open}
			onClose={onClose}
			title={t("大纲")}
			widthClassName="max-w-6xl"
			panelClassName="max-h-[90vh]"
			bodyClassName="p-0"
		>
			<div className="h-[80vh] overflow-auto p-6">
				<MindMapTree node={tree} defaultExpandedDepth={2} showToolbar />
			</div>
		</ModalShell>
	);
}
