export interface MindMapNode {
	title: string;
	children?: MindMapNode[];
}

export function normalizeMindMapNode(input: unknown): MindMapNode | null {
	if (typeof input === "string") {
		return { title: input };
	}
	if (!input || typeof input !== "object") return null;
	const record = input as { title?: unknown; children?: unknown };
	const title = typeof record.title === "string" ? record.title : "";
	const childrenRaw = Array.isArray(record.children) ? record.children : [];
	const children = childrenRaw
		.map((child) => normalizeMindMapNode(child))
		.filter((node): node is MindMapNode =>
			Boolean(node && (node.title || node.children?.length)),
		);
	return { title, children };
}

export function parseMindMapOutline(content: string): MindMapNode | null {
	try {
		const parsed = JSON.parse(content) as unknown;
		if (Array.isArray(parsed)) {
			const children = parsed
				.map((child) => normalizeMindMapNode(child))
				.filter((node): node is MindMapNode => Boolean(node));
			return { title: "", children };
		}
		return normalizeMindMapNode(parsed);
	} catch {
		return null;
	}
}

export function countOutlineDescendants(node: MindMapNode): number {
	if (!node.children?.length) return 0;
	return node.children.reduce(
		(sum, child) => sum + 1 + countOutlineDescendants(child),
		0,
	);
}

export function collectOutlineExpandablePaths(
	node: MindMapNode,
	path = "root",
	acc: string[] = [],
): string[] {
	if (node.children?.length) {
		acc.push(path);
		node.children.forEach((child, index) => {
			collectOutlineExpandablePaths(child, `${path}.${index}`, acc);
		});
	}
	return acc;
}

export function buildDefaultOutlineExpandedPaths(
	node: MindMapNode,
	defaultExpandedDepth: number,
	path = "root",
	depth = 0,
	acc: Set<string> = new Set(),
): Set<string> {
	// Keep children visible through L2 when defaultExpandedDepth=2.
	if (node.children?.length && depth < defaultExpandedDepth) {
		acc.add(path);
		node.children.forEach((child, index) => {
			buildDefaultOutlineExpandedPaths(
				child,
				defaultExpandedDepth,
				`${path}.${index}`,
				depth + 1,
				acc,
			);
		});
	}
	return acc;
}
