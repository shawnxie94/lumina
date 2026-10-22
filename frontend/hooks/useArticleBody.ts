import { useMemo } from "react";
import { createArticleBodyRenderer } from "@/lib/articleBody";

/** Per-mounted-reader cache; metadata, annotations and immersive mode are not inputs. */
export function useArticleBody(
	contentMd: string | null | undefined,
	contentHtml: string | null | undefined,
	contentTrans: string | null | undefined,
	translated: boolean,
) {
	const render = useMemo(() => createArticleBodyRenderer(), []);
	return render(contentMd, contentHtml, contentTrans, translated);
}
