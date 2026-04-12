export type CreatePendingMedia =
	| { token: string; kind: "file"; file: File; mediaKind: "image" }
	| { token: string; kind: "url"; url: string; mediaKind: "image" | "book" };

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
			patchedContent = patchedContent.split(item.token).join(result.url);
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
			patchedTopImage = result.url;
			transferSuccessCount += 1;
		} catch {
			transferFailedCount += 1;
			patchedTopImage = trimmedTopImage;
		}
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
