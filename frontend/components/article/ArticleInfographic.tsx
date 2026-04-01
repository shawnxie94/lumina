import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type Ref,
	type RefObject,
} from "react";

export const INFOGRAPHIC_CANVAS_WIDTH = 1080;
export const INFOGRAPHIC_CANVAS_HEIGHT = 1440;
const INFOGRAPHIC_OVERFLOW_TOLERANCE_PX = 32;
const INFOGRAPHIC_ROOT_ENFORCED_STYLE = "box-sizing: border-box; margin: 0;";
const INLINE_COLOR_KEYWORD_RE = /^[a-z]+$/i;
const INLINE_COLOR_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const INLINE_COLOR_FUNCTION_RE =
	/^(?:rgb|rgba|hsl|hsla)\(\s*[-\d.%\s,]+\)$/i;
export type InfographicImageExportResult = "clipboard" | "download";

interface InfographicCanvasProps {
	html: string;
	canvasRef?: RefObject<HTMLDivElement | null>;
	className: string;
	paddingClassName: string;
	contentClassName: string;
	style?: CSSProperties;
}

interface InfographicPreviewCardProps {
	html: string;
	onOpen: () => void;
	previewLabel: string;
	interactive?: boolean;
}

interface InfographicExportCanvasProps {
	html: string;
	exportRef: RefObject<HTMLDivElement | null>;
}

interface InfographicLightboxProps {
	html: string;
	title: string;
	previewLabel: string;
	closeLabel: string;
	onClose: () => void;
}

function extractInlineRootStyle(html: string): string | undefined {
	const raw = (html || "").trim();
	if (!raw) return undefined;

	const startTagMatch = raw.match(/^<([a-z0-9]+)([^>]*)>/i);
	if (!startTagMatch) return undefined;

	const attrs = startTagMatch[2] || "";
	const styleMatch = attrs.match(/\sstyle=(['"])([\s\S]*?)\1/i);
	return styleMatch?.[2]?.trim() || undefined;
}

function parseInlineStyle(styleText: string): Map<string, string> {
	return styleText
		.split(";")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.reduce((styles, declaration) => {
			const separatorIndex = declaration.indexOf(":");
			if (separatorIndex <= 0) return styles;

			const name = declaration.slice(0, separatorIndex).trim().toLowerCase();
			const value = declaration.slice(separatorIndex + 1).trim();
			if (name && value) {
				styles.set(name, value);
			}
			return styles;
		}, new Map<string, string>());
}

function isInlineColorValue(value: string): boolean {
	const normalized = value.trim();
	if (!normalized) return false;
	if (INLINE_COLOR_HEX_RE.test(normalized)) return true;
	if (INLINE_COLOR_FUNCTION_RE.test(normalized)) return true;
	if (
		INLINE_COLOR_KEYWORD_RE.test(normalized) &&
		!["inherit", "initial", "revert", "revert-layer", "unset"].includes(
			normalized.toLowerCase(),
		)
	) {
		return true;
	}
	return false;
}

function normalizeSurfaceColor(value?: string | null): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim();
	if (!normalized) return undefined;
	if (
		normalized === "transparent" ||
		normalized === "rgba(0, 0, 0, 0)" ||
		normalized === "rgba(0,0,0,0)"
	) {
		return undefined;
	}
	return normalized;
}

function extractInfographicSurfaceColor(html: string): string | undefined {
	const rootStyle = extractInlineRootStyle(html);
	if (!rootStyle) return undefined;

	const styleMap = parseInlineStyle(rootStyle);
	const backgroundColor = styleMap.get("background-color");
	if (backgroundColor && isInlineColorValue(backgroundColor)) {
		return normalizeSurfaceColor(backgroundColor);
	}

	const background = styleMap.get("background");
	if (background && isInlineColorValue(background)) {
		return normalizeSurfaceColor(background);
	}

	return undefined;
}

export function normalizeInfographicHtmlForCanvas(html: string): string {
	const fencedHtmlMatch = (html || "")
		.trim()
		.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
	const raw = (fencedHtmlMatch?.[1] || html || "").trim();
	if (!raw) return "";

	const startTagMatch = raw.match(/^<([a-z0-9]+)([^>]*)>/i);
	if (!startTagMatch) return raw;

	const fullMatch = startTagMatch[0];
	const attrs = startTagMatch[2] || "";
	const styleMatch = attrs.match(/\sstyle=(['"])([\s\S]*?)\1/i);

	if (styleMatch) {
		const quote = styleMatch[1];
		const existingStyle = styleMatch[2].trim().replace(/;?\s*$/, "");
		const mergedStyle = existingStyle
			? `${existingStyle}; ${INFOGRAPHIC_ROOT_ENFORCED_STYLE}`
			: INFOGRAPHIC_ROOT_ENFORCED_STYLE;
		const updatedTag = fullMatch.replace(
			styleMatch[0],
			` style=${quote}${mergedStyle}${quote}`,
		);
		return `${updatedTag}${raw.slice(fullMatch.length)}`;
	}

	const updatedTag = fullMatch.replace(
		/>$/,
		` style="${INFOGRAPHIC_ROOT_ENFORCED_STYLE}">`,
	);
	return `${updatedTag}${raw.slice(fullMatch.length)}`;
}

export async function waitForInfographicRender(): Promise<void> {
	if (typeof document === "undefined") return;
	try {
		await document.fonts?.ready;
	} catch (error) {
		console.warn("Failed to await infographic fonts:", error);
	}
	await new Promise<void>((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}

export async function copyInfographicNodeAsImage(
	node: HTMLElement,
	fileName = "infographic.png",
): Promise<InfographicImageExportResult> {
	const blob = await renderInfographicNodeToBlob(node);
	if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
		await navigator.clipboard.write([
			new ClipboardItem({
				[blob.type || "image/png"]: blob,
			}),
		]);
		return "clipboard";
	}

	const objectUrl = URL.createObjectURL(blob);
	try {
		const link = document.createElement("a");
		link.href = objectUrl;
		link.download = fileName;
		link.click();
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
	return "download";
}

export async function renderInfographicNodeToBlob(
	node: HTMLElement,
): Promise<Blob> {
	const { toBlob } = await import("html-to-image");
	await waitForInfographicRender();
	const blob = await toBlob(node, {
		cacheBust: true,
		pixelRatio: 2,
		width: INFOGRAPHIC_CANVAS_WIDTH,
		height: INFOGRAPHIC_CANVAS_HEIGHT,
		canvasWidth: INFOGRAPHIC_CANVAS_WIDTH * 2,
		canvasHeight: INFOGRAPHIC_CANVAS_HEIGHT * 2,
		skipAutoScale: true,
	});
	if (!blob) {
		throw new Error("empty infographic blob");
	}
	return blob;
}

function InfographicCanvas({
	html,
	canvasRef,
	className,
	paddingClassName,
	contentClassName,
	style,
}: InfographicCanvasProps) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	const [intrinsicSize, setIntrinsicSize] = useState({
		width: INFOGRAPHIC_CANVAS_WIDTH,
		height: INFOGRAPHIC_CANVAS_HEIGHT,
	});
	const [offset, setOffset] = useState({ x: 0, y: 0 });

	useEffect(() => {
		const viewport = viewportRef.current;
		const content = contentRef.current;
		if (!viewport || !content) return;

		const updateScale = () => {
			const infographicRoot = content.firstElementChild as HTMLElement | null;
			const rootWidth = Math.max(
				INFOGRAPHIC_CANVAS_WIDTH,
				Math.ceil(infographicRoot?.offsetWidth || 0),
			);
			const rootHeight = Math.max(
				INFOGRAPHIC_CANVAS_HEIGHT,
				Math.ceil(infographicRoot?.offsetHeight || 0),
			);
			const scrollWidth = Math.max(
				rootWidth,
				Math.ceil(content.scrollWidth || 0),
			);
			const scrollHeight = Math.max(
				rootHeight,
				Math.ceil(content.scrollHeight || 0),
			);
			const measuredWidth =
				scrollWidth - rootWidth > INFOGRAPHIC_OVERFLOW_TOLERANCE_PX
					? scrollWidth
					: rootWidth;
			const measuredHeight =
				scrollHeight - rootHeight > INFOGRAPHIC_OVERFLOW_TOLERANCE_PX
					? scrollHeight
					: rootHeight;
			setIntrinsicSize((current) =>
				current.width === measuredWidth && current.height === measuredHeight
					? current
					: { width: measuredWidth, height: measuredHeight },
			);
			const nextScale = Math.min(
				viewport.clientWidth / measuredWidth,
				viewport.clientHeight / measuredHeight,
			);
			if (!Number.isFinite(nextScale) || nextScale <= 0) return;
			setScale(nextScale);
			const scaledWidth = measuredWidth * nextScale;
			const scaledHeight = measuredHeight * nextScale;
			const nextOffset = {
				x: Math.max((viewport.clientWidth - scaledWidth) / 2, 0),
				y: Math.max((viewport.clientHeight - scaledHeight) / 2, 0),
			};
			setOffset((current) =>
				Math.abs(current.x - nextOffset.x) < 0.5 &&
				Math.abs(current.y - nextOffset.y) < 0.5
					? current
					: nextOffset,
			);
		};

		updateScale();

		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateScale);
			return () => window.removeEventListener("resize", updateScale);
		}

		const observer = new ResizeObserver(() => updateScale());
		observer.observe(viewport);
		observer.observe(content);
		return () => observer.disconnect();
	}, [html]);

	return (
		<div
			ref={canvasRef as Ref<HTMLDivElement> | undefined}
			className={`${className} text-text-1`}
			style={style}
		>
			<div ref={viewportRef} className="relative h-full w-full overflow-hidden">
				<div
					className="absolute left-0 top-0"
					style={{
						width: `${intrinsicSize.width}px`,
						height: `${intrinsicSize.height}px`,
						transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
						transformOrigin: "top left",
					}}
				>
					<div className={paddingClassName}>
						<div
							ref={contentRef}
							className={contentClassName}
							dangerouslySetInnerHTML={{ __html: html }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

export function InfographicPreviewCard({
	html,
	onOpen,
	previewLabel,
	interactive = true,
}: InfographicPreviewCardProps) {
	const content = (
		<div className="relative w-full">
			<InfographicCanvas
				html={html}
				className="aspect-[3/4] w-full overflow-hidden rounded-[24px] transition duration-200 group-hover:opacity-95"
				paddingClassName="box-border h-full w-full"
				contentClassName="h-full w-full"
				style={buildInfographicSurfaceStyle(html)}
			/>
		</div>
	);

	if (!interactive) {
		return <div>{content}</div>;
	}

	return (
		<div>
			<button
				type="button"
				onClick={onOpen}
				className="group block w-full text-left"
				aria-label={previewLabel}
			>
				{content}
			</button>
		</div>
	);
}

export function InfographicExportCanvas({
	html,
	exportRef,
}: InfographicExportCanvasProps) {
	return (
		<div aria-hidden="true" className="fixed left-[-200vw] top-0">
			<InfographicCanvas
				html={html}
				canvasRef={exportRef}
				className="overflow-hidden rounded-[24px]"
				paddingClassName="box-border h-full w-full"
				contentClassName="h-full w-full"
				style={{
					width: `${INFOGRAPHIC_CANVAS_WIDTH}px`,
					height: `${INFOGRAPHIC_CANVAS_HEIGHT}px`,
					borderRadius: "24px",
					overflow: "hidden",
					...buildInfographicSurfaceStyle(html),
				}}
			/>
		</div>
	);
}

export function InfographicLightbox({
	html,
	title,
	previewLabel,
	closeLabel,
	onClose,
}: InfographicLightboxProps) {
	return (
		<div
			className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-[1px]"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-label={previewLabel}
		>
			<div
				className="relative flex h-full w-full items-center justify-center p-4 sm:p-6"
				onClick={(event) => event.stopPropagation()}
			>
				<button
					type="button"
					onClick={onClose}
					className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white transition hover:bg-black/55"
					aria-label={closeLabel}
				>
					&times;
				</button>
				<div className="absolute left-4 top-4 z-10 rounded-full bg-black/35 px-3 py-1 text-xs text-white">
					{title}
				</div>
				<div
					className="relative aspect-[3/4]"
					style={{
						width: "min(96vw, calc(92vh * 3 / 4))",
					}}
				>
					<InfographicCanvas
						html={html}
						className="h-full w-full overflow-hidden rounded-[28px] shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
						paddingClassName="box-border h-full w-full"
						contentClassName="h-full w-full"
						style={buildInfographicSurfaceStyle(html)}
					/>
				</div>
			</div>
		</div>
	);
}

function buildInfographicSurfaceStyle(
	html: string,
): CSSProperties | undefined {
	const surfaceColor = extractInfographicSurfaceColor(html);
	return surfaceColor ? { backgroundColor: surfaceColor } : undefined;
}
