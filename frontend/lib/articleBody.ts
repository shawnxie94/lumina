import { normalizeMediaHtml } from "@/lib/api";
import { renderMarkdown } from "@/lib/articleAnnotations";
import { sanitizeRichHtml } from "@/lib/safeHtml";

export function createArticleBodyRenderer(render = renderMarkdown) {
	let previousMd: string | null | undefined;
	let previousHtml: string | null | undefined;
	let previousTrans: string | null | undefined;
	let original = "";
	let translation = "";
	let originalValid = false;
	let translationValid = false;
	return (
		md: string | null | undefined,
		html: string | null | undefined,
		trans: string | null | undefined,
		translated: boolean,
	) => {
		if (md !== previousMd || html !== previousHtml) originalValid = false;
		if (trans !== previousTrans) translationValid = false;
		previousMd = md;
		previousHtml = html;
		previousTrans = trans;
		// Choose using the raw translation, not the sanitized result's truthiness.
		if (translated && trans) {
			if (!translationValid) {
				translation = sanitizeRichHtml(
					normalizeMediaHtml(render(trans, { enableMediaEmbed: true })),
				);
				translationValid = true;
			}
			return translation;
		}
		if (!originalValid) {
			original = sanitizeRichHtml(
				normalizeMediaHtml(
					md
						? render(md, { enableMediaEmbed: true })
						: sanitizeRichHtml(html || ""),
				),
			);
			originalValid = true;
		}
		return original;
	};
}
