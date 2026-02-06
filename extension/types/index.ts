export interface ArticleData {
	title: string;
	content_html: string;
	content_md: string;
	source_url: string;
	top_image: string | null;
	author: string;
	published_at: string;
	source_domain: string;
}

export interface Category {
	id: string;
	name: string;
}

export interface CreateArticleRequest extends ArticleData {
	category_id: string;
}

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
	source_url: string;
	top_image: string | null;
	author: string;
	published_at: string;
	source_domain: string;
}
