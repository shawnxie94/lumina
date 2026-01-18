// Simple article extraction without external dependencies

function extractArticle() {
  const doc = document.cloneNode(true);

  const title = document.title;
  const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
  const metaAuthor = document.querySelector('meta[name="author"]')?.content || '';

  const articleElement = document.querySelector('article') ||
                        document.querySelector('[role="main"]') ||
                        document.querySelector('main') ||
                        document.querySelector('.content') ||
                        document.body;

  const content = articleElement?.innerHTML || document.body?.innerHTML || '';

  const img = articleElement?.querySelector('img');
  const topImage = img?.src || null;

  return {
    title: title,
    content_html: content,
    content_md: '',
    source_url: window.location.href,
    top_image: topImage,
    author: metaAuthor,
    published_at: '',
    source_domain: new URL(window.location.href).hostname,
  };
}

export { extractArticle };
