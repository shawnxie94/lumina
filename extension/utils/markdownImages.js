function isPlaceholderSrc(src) {
	if (!src) return true;
	if (src.startsWith("data:image/svg+xml")) return true;
	if (src.startsWith("data:image/gif;base64,R0lGOD")) return true;
	if (src.includes("1x1") || src.includes("placeholder") || src.includes("blank")) {
		return true;
	}
	if (src.includes("spacer") || src.includes("loading")) return true;
	return false;
}

function pickFirstUrlFromSrcset(srcset) {
	const firstPart = (srcset.split(",")[0] || "").trim();
	return (firstPart.split(/\s+/)[0] || "").trim();
}

export function getBestImageSrc(node) {
	const src = node.getAttribute("src") || "";
	if (src && !isPlaceholderSrc(src)) return src;

	const lazyCandidates = [
		"data-src",
		"data-original",
		"data-lazy-src",
		"data-croporisrc",
		"data-actualsrc",
		"data-url",
	];
	for (const attr of lazyCandidates) {
		const v = node.getAttribute(attr) || "";
		if (v && !isPlaceholderSrc(v)) return v;
	}

	const srcset = node.getAttribute("srcset") || node.getAttribute("data-srcset") || "";
	if (srcset) {
		const picked = pickFirstUrlFromSrcset(srcset);
		if (picked && !isPlaceholderSrc(picked)) return picked;
	}

	return "";
}

export function toMarkdownImage(node) {
	const src = getBestImageSrc(node);
	if (!src) return "";

	let alt = node.getAttribute("alt") || "";
	if (
		!alt ||
		alt === "image" ||
		alt === "img" ||
		alt === "图片" ||
		alt === "图像" ||
		alt.length < 2
	) {
		alt =
			node.getAttribute("title") ||
			node.getAttribute("data-alt") ||
			node.getAttribute("aria-label") ||
			"";
	}

	alt = alt.replace(/[\[\]]/g, "").trim();
	return `![${alt}](${src})`;
}
