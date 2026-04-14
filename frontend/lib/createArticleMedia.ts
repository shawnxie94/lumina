import { resolveMediaUrl } from "@/lib/api";

export type CreatePendingMedia =
	| { token: string; kind: "file"; file: File; mediaKind: "image" }
	| { token: string; kind: "url"; url: string; mediaKind: "image" | "book" };

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(([^)]+)\)/g;

const normalizeResolvedMediaUrl = (url?: string | null): string => {
	const normalized = resolveMediaUrl(url);
	if (normalized) return normalized;
	return (url || "").trim();
};

const extractFirstMarkdownImageUrl = (markdown: string): string | undefined => {
	const pattern = new RegExp(MARKDOWN_IMAGE_PATTERN.source, MARKDOWN_IMAGE_PATTERN.flags);
	let match = pattern.exec(markdown);
	while (match) {
		let target = (match[1] || "").trim();
		if (!target) {
			match = pattern.exec(markdown);
			continue;
		}
		if (target.startsWith("<") && target.includes(">")) {
			target = target.slice(1, target.indexOf(">")).trim();
		} else if (target.includes(" ")) {
			target = target.split(" ", 1)[0]?.trim() || "";
		}
		const normalized = normalizeResolvedMediaUrl(target);
		if (normalized) return normalized;
		match = pattern.exec(markdown);
	}
	return undefined;
};

export async function resolveCreateArticlePatch(input: {
	originalContent: string;
	pendingMedia: CreatePendingMedia[];
	topImage: string;
	articleId: string;
	mediaStorageEnabled: boolean;
	ingestUrl: (
		articleId: string,
		url: string,
		mediaKind?: "image" | "book",
	) => Promise<{ url: string }>;
	uploadFile: (articleId: string, file: File) => Promise<{ url: string }>;
}): Promise<{
	patch: {
		content_md: string;
		top_image?: string;
	};
	transferSuccessCount: number;
	transferFailedCount: number;
}> {
	let patchedContent = input.originalContent;
	let transferSuccessCount = 0;
	let transferFailedCount = 0;
	const trimmedTopImage = input.topImage.trim();
	let patchedTopImage = trimmedTopImage || undefined;

	for (const item of input.pendingMedia) {
		try {
			const result =
				item.kind === "file"
					? await input.uploadFile(input.articleId, item.file)
					: await input.ingestUrl(input.articleId, item.url, item.mediaKind);
			const normalizedUrl = normalizeResolvedMediaUrl(result.url);
			patchedContent = patchedContent.split(item.token).join(normalizedUrl);
			if (trimmedTopImage && trimmedTopImage === item.token) {
				patchedTopImage = normalizedUrl;
			}
			transferSuccessCount += 1;
		} catch {
			transferFailedCount += 1;
			if (item.kind === "url") {
				patchedContent = patchedContent.split(item.token).join(item.url);
			} else {
				patchedContent = patchedContent.split(`![](${item.token})`).join("");
				patchedContent = patchedContent.split(item.token).join("");
			}
		}
	}

	if (input.mediaStorageEnabled && trimmedTopImage) {
		try {
			const result = await input.ingestUrl(
				input.articleId,
				trimmedTopImage,
				"image",
			);
			patchedTopImage = normalizeResolvedMediaUrl(result.url);
			transferSuccessCount += 1;
		} catch {
			transferFailedCount += 1;
			patchedTopImage = trimmedTopImage;
		}
	}

	if (!trimmedTopImage) {
		patchedTopImage = extractFirstMarkdownImageUrl(patchedContent);
	}

	return {
		patch: {
			content_md: patchedContent,
			top_image: patchedTopImage,
		},
		transferSuccessCount,
		transferFailedCount,
	};
}
