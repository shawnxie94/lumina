export const DIGEST_LINE_PREFIXES = [
	"这篇文章讲的是",
	"作者最核心的观点是",
	"作者用了",
	"我认为最有价值的是",
	"我不完全认同的是",
	"我准备采取的一个行动是",
] as const;

export type DigestLineKey =
	| "line1"
	| "line2"
	| "line3"
	| "line4"
	| "line5"
	| "line6";

export type DigestLines = Record<DigestLineKey, string>;

const LINE_KEYS: DigestLineKey[] = [
	"line1",
	"line2",
	"line3",
	"line4",
	"line5",
	"line6",
];

const EMPTY_SLOT = "____";

export function emptyDigestLines(): DigestLines {
	return {
		line1: `${DIGEST_LINE_PREFIXES[0]} ${EMPTY_SLOT}`,
		line2: `${DIGEST_LINE_PREFIXES[1]} ${EMPTY_SLOT}`,
		line3: `${DIGEST_LINE_PREFIXES[2]} ${EMPTY_SLOT} 来证明`,
		line4: `${DIGEST_LINE_PREFIXES[3]} ${EMPTY_SLOT}`,
		line5: `${DIGEST_LINE_PREFIXES[4]} ${EMPTY_SLOT}`,
		line6: `${DIGEST_LINE_PREFIXES[5]} ${EMPTY_SLOT}`,
	};
}

export function joinDigestLines(lines: DigestLines): string {
	// Blank lines between sentences so Markdown renders six distinct paragraphs.
	return LINE_KEYS.map((key) => (lines[key] || "").trim())
		.filter(Boolean)
		.join("\n\n");
}

export function extractDigestLines(note: string | null | undefined): DigestLines | null {
	const text = (note || "").trim();
	if (!text) return null;
	const found = {} as DigestLines;
	const rows = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	let prefixIndex = 0;
	for (const line of rows) {
		if (prefixIndex >= DIGEST_LINE_PREFIXES.length) break;
		const prefix = DIGEST_LINE_PREFIXES[prefixIndex];
		if (line.startsWith(prefix)) {
			found[LINE_KEYS[prefixIndex]] = line;
			prefixIndex += 1;
		}
	}
	if (prefixIndex !== 6) return null;
	return found;
}

/** Normalize six-line notes so display keeps blank-line paragraphs. */
export function normalizeDigestNoteForDisplay(
	note: string | null | undefined,
): string {
	const text = (note || "").trim();
	if (!text) return "";
	const lines = extractDigestLines(text);
	if (!lines) return text;
	return joinDigestLines(lines);
}

/** Replace the note draft with the full six-line AI result. */
export function applyPrefillToNote(
	_note: string | null | undefined,
	lines: DigestLines,
	_mode: "append" | "replace" = "replace",
): string {
	return joinDigestLines(lines);
}

export function parseDigestPrefillPayload(payload: unknown): DigestLines | null {
	if (!payload || typeof payload !== "object") return null;
	const root = payload as Record<string, unknown>;
	const result =
		(root.digest_prefill_result as Record<string, unknown> | undefined) ||
		root;
	const lines = (result.lines || result) as Record<string, unknown>;
	if (!lines || typeof lines !== "object") return null;
	const out = emptyDigestLines();
	for (const key of LINE_KEYS) {
		const value = lines[key];
		if (typeof value !== "string" || !value.trim()) return null;
		out[key] = value.trim();
	}
	return out;
}

/** Recover saved AI note draft from a completed digest_prefill task payload. */
export function extractDigestNoteFromTaskPayload(
	payload: unknown,
): string | null {
	if (!payload || typeof payload !== "object") return null;
	const root = payload as Record<string, unknown>;
	const result =
		(root.digest_prefill_result as Record<string, unknown> | undefined) ||
		root;
	const markdown = result.note_markdown;
	if (typeof markdown === "string" && markdown.trim()) {
		const lines = extractDigestLines(markdown);
		return lines ? joinDigestLines(lines) : markdown.trim();
	}
	const lines = parseDigestPrefillPayload(payload);
	return lines ? joinDigestLines(lines) : null;
}
