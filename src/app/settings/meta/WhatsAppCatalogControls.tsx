export function WhatsAppCatalogControls({
  feedUrl,
}: {
  feedUrl?: string;
}) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--color-border-subtle)',
        display: 'grid',
        gap: 8,
        paddingTop: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-fg-1)' }}>
          WhatsApp product catalog
        </div>
        <p className="app-muted" style={{ fontSize: 11, lineHeight: 1.45, marginTop: 3 }}>
          Meta Commerce Manager imports this CSV feed on its configured schedule. DEEZ does not send direct Catalog Graph API updates.
        </p>
      </div>
      {feedUrl && (
        <a
          className="btn btn-secondary"
          href={feedUrl}
          target="_blank"
          rel="noreferrer"
          style={{ justifyContent: 'center' }}
        >
          Open catalog feed
        </a>
      )}
      {!feedUrl && (
        <p className="app-muted" style={{ fontSize: 11, lineHeight: 1.45 }}>
          This brand does not have a scheduled catalog feed configured in DEEZ.
        </p>
      )}
    </div>
  );
}
