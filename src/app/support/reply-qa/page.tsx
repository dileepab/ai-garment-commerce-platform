import { describeScope } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { REPLY_QA_TEMPLATES } from '@/lib/chat/reply-qa-templates';
import { PageHeader } from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

const LANGUAGE_LABELS = {
  english: 'English',
  sinhala: 'Sinhala',
  tamil: 'Tamil',
} as const;

export default async function ReplyQaPage() {
  const scope = await requirePagePermission('support:view');

  return (
    <main className="main">
      <PageHeader
        title="Reply QA"
        subtitle="Review approved multilingual wording for sensitive bot and handoff flows"
        actions={<span className="app-chip app-chip-neutral">{describeScope(scope)}</span>}
      />

      <div className="content" style={{ display: 'grid', gap: 16 }}>
        {REPLY_QA_TEMPLATES.map((template) => (
          <section key={template.key} className="app-panel" style={{ padding: 18 }}>
            <p className="app-section-label">{template.key.replace(/_/g, ' ')}</p>
            <h2 style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: 'var(--color-fg-1)' }}>
              {template.label}
            </h2>
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {Object.entries(template.templates).map(([language, copy]) => (
                <div key={language} className="app-subpanel">
                  <p className="app-section-label">{LANGUAGE_LABELS[language as keyof typeof LANGUAGE_LABELS]}</p>
                  <p style={{ marginTop: 8, whiteSpace: 'pre-wrap', color: 'var(--color-fg-1)', fontSize: 13, lineHeight: 1.55 }}>
                    {copy}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
