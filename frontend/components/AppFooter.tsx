export default function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-surface border-t border-border">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="text-center text-sm text-text-3">
          © {year}{' '}
          <a
            href="https://github.com/shawnxie94/lumina"
            target="_blank"
            rel="noreferrer"
            className="text-text-2 hover:text-primary transition"
          >
            Power by Lumina
          </a>
        </div>
      </div>
    </footer>
  );
}
