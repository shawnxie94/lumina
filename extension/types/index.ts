export interface ArticleData {
	title: string;
	content_html: string;
	content_md: string;
	content_structured?: StructuredContent | null;
	source_url: string;
	top_image: string | null;
	author: string;
	published_at: string;
	source_domain: string;
}

export interface CreateArticleRequest extends ArticleData {}

export interface CreateArticleResponse {
	id: string | number;
	slug?: string; // SEO友好的URL slug
	[key: string]: any;
}

export interface StorageData {
	apiHost: string;
}

export type StatusType = "idle" | "loading" | "success" | "error";

export interface StatusMessage {
	type: StatusType;
	message: string;
}

export interface ExtractedContent {
	title: string;
	content_html: string;
	content_md: string;
	content_structured?: StructuredContent | null;
	source_url: string;
	top_image: string | null;
	author: string;
	published_at: string;
	source_domain: string;
}

export interface StructuredContent {
	schema: "lumina.dom.v1";
	blocks: StructuredBlock[];
}

export interface StructuredBlock {
	type:
		| "heading"
		| "paragraph"
		| "list"
		| "image"
		| "code"
		| "quote"
		| "table"
		| "divider";
	text?: string;
	level?: number;
	items?: string[];
	src?: string;
	alt?: string;
	html?: string;
	code?: string;
	language?: string;
}
