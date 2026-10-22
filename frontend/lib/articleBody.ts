import { normalizeMediaHtml } from "@/lib/api";
import { renderMarkdown } from "@/lib/articleAnnotations";
import { sanitizeRichHtml } from "@/lib/safeHtml";

export function createArticleBodyRenderer(render = renderMarkdown) {
	let previousMd: string | null | undefined;
	let previousHtml: string | null | undefined;
	let previousTrans: string | null | undefined;
	let original = "";
	let translation = "";
	return (
		md: string | null | undefined,
		html: string | null | undefined,
		trans: string | null | undefined,
		translated: boolean,
	) => {
		if (md !== previousMd || html !== previousHtml) {
			original = sanitizeRichHtml(
				normalizeMediaHtml(
					md
						? render(md, { enableMediaEmbed: true })
						: sanitizeRichHtml(html || ""),
				),
			);
			previousMd = md;
			previousHtml = html;
		}
		if (trans !== previousTrans) {
			translation = trans
				? sanitizeRichHtml(
						normalizeMediaHtml(render(trans, { enableMediaEmbed: true })),
					)
				: "";
			previousTrans = trans;
		}
		return translated && translation ? translation : original;
	};
}
