export interface TocItem {
	id: string;
	text: string;
	level: number;
}

export function TableOfContents({
	items,
	activeId,
	onSelect,
}: {
	items: TocItem[];
	activeId: string;
	onSelect: (id: string) => void;
}) {
	if (items.length === 0) return null;

	return (
		<nav className="border-l-2 border-border pl-2 space-y-1">
			{items.map((item) => (
				<a
					key={item.id}
					href={`#${item.id}`}
					onClick={() => onSelect(item.id)}
					className={`block text-xs truncate rounded px-2 py-1 transition ${
						activeId === item.id
							? "text-primary-ink font-semibold bg-primary-soft"
							: "text-text-2 hover:text-text-1 hover:bg-muted"
					}`}
					style={{ paddingLeft: `${(item.level - 1) * 8 + 8}px` }}
				>
					{item.text}
				</a>
			))}
		</nav>
	);
}
