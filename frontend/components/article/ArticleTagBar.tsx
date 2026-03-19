import Link from "next/link";
import type { ReactNode } from "react";

import type { Tag } from "@/lib/api";

interface ArticleTagBarProps {
	tags: Tag[];
	actions?: ReactNode;
	className?: string;
}

export default function ArticleTagBar({
	tags,
	actions,
	className = "",
}: ArticleTagBarProps) {
	if (tags.length === 0 && !actions) {
		return null;
	}

	return (
		<div
			className={`flex flex-wrap items-center justify-center gap-2 ${className}`.trim()}
		>
			{tags.map((tag) => (
				<Link
					key={tag.id}
					href={`/list?tag_ids=${tag.id}`}
					className="px-2.5 py-1 text-xs rounded-sm bg-muted text-text-2 hover:bg-primary-soft hover:text-primary-ink transition"
				>
					{tag.name}
				</Link>
			))}
			{actions}
		</div>
	);
}
