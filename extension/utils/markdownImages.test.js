import test from 'node:test';
import assert from 'node:assert/strict';

import { toMarkdownImage } from './markdownImages';

function makeImg(attrs) {
	return {
		getAttribute: (name) => {
			return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
		},
	};
}

test('toMarkdownImage uses src when present', () => {
	const img = makeImg({ src: 'https://example.com/a.png', alt: 'A' });
	assert.equal(toMarkdownImage(img), '![A](https://example.com/a.png)');
});

test('toMarkdownImage falls back to data-src for placeholders', () => {
	const img = makeImg({
		src: 'data:image/gif;base64,R0lGOD',
		'data-src': 'https://example.com/lazy.png',
		alt: 'Lazy',
	});
	assert.equal(toMarkdownImage(img), '![Lazy](https://example.com/lazy.png)');
});

test('toMarkdownImage falls back to srcset when src missing', () => {
	const img = makeImg({
		src: '',
		srcset: 'https://example.com/640.webp 640w, https://example.com/1200.webp 1200w',
		alt: 'FromSrcset',
	});
	assert.equal(toMarkdownImage(img), '![FromSrcset](https://example.com/640.webp)');
});

test('toMarkdownImage returns empty string when no usable url', () => {
	const img = makeImg({ src: 'data:image/svg+xml,<svg></svg>' });
	assert.equal(toMarkdownImage(img), '');
});
