// Runs in the MAIN world so closed/open shadow roots are readable.
// Content scripts cannot always read shadow content due to Chrome isolation.
// Stamps shadow HTML onto data-defuddle-shadow for Defuddle to consume.
(function () {
	try {
		document.querySelectorAll("*").forEach(function (el) {
			if (el.shadowRoot && el.shadowRoot.innerHTML) {
				el.setAttribute("data-defuddle-shadow", el.shadowRoot.innerHTML);
			}
		});
	} catch (_) {
		// Ignore and let the extractor continue.
	}
})();
