import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import {
  canScope,
  describeScope,
  getBrandScopeValues,
} from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import {
  BOT_TRAINING_INTENTS,
  BOT_TRAINING_MATCH_TYPES,
  summarizeTrainingQuestionSignals,
} from '@/lib/bot-training';
import prisma from '@/lib/prisma';
import {
  deleteBotTrainingRuleAction,
  saveBotTrainingRuleAction,
  toggleBotTrainingRuleAction,
} from './actions';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  seed?: string;
  language?: string;
  channel?: string;
  intent?: string;
  edit?: string;
}>;

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Any language' },
  { value: 'english', label: 'English' },
  { value: 'sinhala', label: 'Sinhala' },
  { value: 'tamil', label: 'Tamil' },
];

const INTENT_LABELS: Record<string, string> = {
  catalog_request: 'Catalog request',
  product_details: 'Product details',
  price_question: 'Price question',
  cod_question: 'COD question',
  delivery_eta: 'Delivery ETA',
  store_location: 'Store location',
  branch_question: 'Branch question',
  size_exchange: 'Size exchange',
  refund_or_damage: 'Refund or damaged item',
  tracking_request: 'Tracking request',
  support_contact: 'Support contact',
  greeting: 'Greeting',
  other: 'Other',
};

function formatDateTime(date: Date | null): string {
  if (!date) return 'Never';
  return new Intl.DateTimeFormat('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getIntentLabel(intent: string): string {
  return INTENT_LABELS[intent] || intent.replace(/_/g, ' ');
}

function cleanSearchParam(value?: string): string {
  return String(value || '').trim();
}

function makeSeedHref(question: {
  text: string;
  language: string;
  channel: string;
}): string {
  const params = new URLSearchParams({
    seed: question.text,
    language: question.language === 'unknown' ? '' : question.language,
    channel: question.channel,
  });
  return `/support/training?${params.toString()}`;
}

async function getAvailableBrands(brandScope: string[] | null): Promise<string[]> {
  if (brandScope) return brandScope;

  const channelConfigs = await prisma.brandChannelConfig.findMany({
    select: { brand: true },
    orderBy: { brand: 'asc' },
  });
  const merchantSettings = await prisma.merchantSettings.findMany({
    where: { brand: { not: null } },
    select: { brand: true },
    orderBy: { brand: 'asc' },
  });
  const products = await prisma.product.findMany({
    distinct: ['brand'],
    select: { brand: true },
    orderBy: { brand: 'asc' },
  });

  return Array.from(new Set([
    ...channelConfigs.map((config) => config.brand),
    ...merchantSettings.map((setting) => setting.brand).filter((brand): brand is string => Boolean(brand)),
    ...products.map((product) => product.brand),
  ])).sort((a, b) => a.localeCompare(b));
}

export default async function BotTrainingPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await requirePagePermission('support:view');
  const params = await searchParams;
  const brandScope = getBrandScopeValues(scope);
  const canEdit = canScope(scope, 'support:reply');
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86400000);
  const editId = Number.parseInt(cleanSearchParam(params.edit), 10);
  const availableBrands = await getAvailableBrands(brandScope);
  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      role: 'user',
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 1200,
    select: {
      message: true,
      channel: true,
      createdAt: true,
    },
  });
  const rules = await prisma.botTrainingRule.findMany({
    where: brandScope
      ? {
          OR: [
            { brand: { in: brandScope } },
            { brand: null },
          ],
        }
      : {},
    orderBy: [
      { enabled: 'desc' },
      { priority: 'desc' },
      { updatedAt: 'desc' },
    ],
    take: 200,
  });
  const editRule = Number.isInteger(editId)
    ? await prisma.botTrainingRule.findUnique({ where: { id: editId } })
    : null;

  const questionSignals = summarizeTrainingQuestionSignals(recentMessages, 18);
  const editableRule =
    editRule && (!brandScope || (editRule.brand && brandScope.includes(editRule.brand)))
      ? editRule
      : null;
  const formRule = editableRule || null;
  const seededText = cleanSearchParam(params.seed);
  const seededLanguage = cleanSearchParam(params.language);
  const seededIntent = cleanSearchParam(params.intent);
  const defaultBrand = brandScope?.[0] || '';
  const formActionLabel = formRule ? 'Update rule' : 'Save training rule';

  return (
    <main className="main">
      <PageHeader
        title="Bot Training Center"
        subtitle={`Turn real customer questions into approved bot replies · ${describeScope(scope)}`}
        actions={
          <>
            <Link className="btn btn-secondary" href="/support">Inbox</Link>
            <Link className="btn btn-secondary" href="/support/insights">Bot Insights</Link>
            <Link className="btn btn-secondary" href="/support/reply-qa">Reply QA</Link>
          </>
        }
      />

      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(360px, 1.05fr)', gap: 16 }}>
          <div className="app-panel" style={{ padding: 16, display: 'grid', gap: 14, alignSelf: 'start' }}>
            <div>
              <p className="app-section-label">Demand signals</p>
              <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>Repeated customer questions</h2>
            </div>
            {questionSignals.length === 0 ? (
              <div style={{ padding: 26, color: 'var(--color-fg-3)', textAlign: 'center', fontSize: 13 }}>
                No repeated questions found in the last 30 days.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {questionSignals.map((question) => (
                  <div
                    key={`${question.channel}:${question.language}:${question.text}`}
                    style={{
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 8,
                      padding: 12,
                      display: 'grid',
                      gap: 9,
                      background: 'var(--color-surface)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--color-fg-1)', fontWeight: 800 }}>
                        {question.text}
                      </p>
                      <span className="app-chip app-chip-neutral">{question.count}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                      <span className="app-chip app-chip-neutral">{question.language}</span>
                      <span className="app-chip app-chip-neutral">{question.channel}</span>
                      <span className="app-muted" style={{ fontSize: 11 }}>{formatDateTime(question.lastSeenAt)}</span>
                      <Link className="btn btn-secondary" style={{ marginLeft: 'auto', minHeight: 28, padding: '5px 10px' }} href={makeSeedHref(question)}>
                        Train
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form action={saveBotTrainingRuleAction} className="app-panel" style={{ padding: 16, display: 'grid', gap: 14 }}>
            <div>
              <p className="app-section-label">{formRule ? `Editing rule #${formRule.id}` : 'Approved reply rule'}</p>
              <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>
                {formRule ? 'Tune the saved behavior' : 'Teach the bot a safe answer'}
              </h2>
            </div>

            <input type="hidden" name="ruleId" value={formRule?.id ?? ''} />
            <input type="hidden" name="redirectTo" value="/support/training" />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <label className="app-field">
                <span>Brand</span>
                <select className="app-input" name="brand" defaultValue={formRule?.brand ?? defaultBrand} disabled={!canEdit}>
                  {!brandScope && <option value="">All brands</option>}
                  {availableBrands.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </label>
              <label className="app-field">
                <span>Intent</span>
                <select className="app-input" name="intent" defaultValue={(formRule?.intent ?? seededIntent) || 'other'} disabled={!canEdit}>
                  {BOT_TRAINING_INTENTS.map((intent) => (
                    <option key={intent} value={intent}>{getIntentLabel(intent)}</option>
                  ))}
                </select>
              </label>
              <label className="app-field">
                <span>Language</span>
                <select className="app-input" name="language" defaultValue={formRule?.language ?? seededLanguage} disabled={!canEdit}>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value || 'any'} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 0.7fr) minmax(110px, 0.3fr)', gap: 10 }}>
              <label className="app-field">
                <span>Match type</span>
                <select className="app-input" name="matchType" defaultValue={formRule?.matchType ?? 'contains'} disabled={!canEdit}>
                  {BOT_TRAINING_MATCH_TYPES.map((matchType) => (
                    <option key={matchType} value={matchType}>{matchType}</option>
                  ))}
                </select>
              </label>
              <label className="app-field">
                <span>Priority</span>
                <input className="app-input" name="priority" type="number" min={1} max={100} defaultValue={formRule?.priority ?? 50} disabled={!canEdit} />
              </label>
            </div>

            <label className="app-field">
              <span>Customer wording to match</span>
              <textarea
                className="app-input"
                name="pattern"
                rows={3}
                defaultValue={formRule?.pattern ?? seededText}
                placeholder="Example: COD thiyanawada"
                required
                disabled={!canEdit}
              />
            </label>

            <label className="app-field">
              <span>Approved bot reply</span>
              <textarea
                className="app-input"
                name="response"
                rows={7}
                defaultValue={formRule?.response ?? ''}
                placeholder="Write the exact safe reply. If you choose Sinhala or Tamil, write the approved reply in that language."
                required
                disabled={!canEdit}
              />
            </label>

            <label className="app-field">
              <span>Internal note</span>
              <textarea
                className="app-input"
                name="notes"
                rows={2}
                defaultValue={formRule?.notes ?? ''}
                placeholder="Optional: why this rule exists or when to review it."
                disabled={!canEdit}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-fg-2)' }}>
              <input name="enabled" type="checkbox" defaultChecked={formRule?.enabled ?? true} disabled={!canEdit} />
              Enabled
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" type="submit" disabled={!canEdit}>{formActionLabel}</button>
              {formRule && <Link className="btn btn-secondary" href="/support/training">Cancel edit</Link>}
            </div>
          </form>
        </section>

        <section className="app-panel" style={{ padding: 16, overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div>
              <p className="app-section-label">Training rules</p>
              <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>
                {rules.length} approved rule{rules.length === 1 ? '' : 's'}
              </h2>
            </div>
            <span className="app-chip app-chip-neutral">Rules run before AI fallback</span>
          </div>

          {rules.length === 0 ? (
            <div style={{ padding: 32, color: 'var(--color-fg-3)', textAlign: 'center', fontSize: 13 }}>
              No training rules yet. Use repeated questions above to create the first one.
            </div>
          ) : (
            <table className="data-table" style={{ minWidth: 1060 }}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Brand</th>
                  <th>Intent</th>
                  <th>Language</th>
                  <th>Pattern</th>
                  <th>Approved reply</th>
                  <th>Hits</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const canManageRule = canEdit && (!brandScope || (rule.brand && brandScope.includes(rule.brand)));

                  return (
                  <tr key={rule.id}>
                    <td>
                      <span className={`app-chip ${rule.enabled ? 'app-chip-success' : 'app-chip-neutral'}`}>
                        {rule.enabled ? 'Enabled' : 'Paused'}
                      </span>
                    </td>
                    <td>{rule.brand || 'All'}</td>
                    <td>{getIntentLabel(rule.intent)}</td>
                    <td>{rule.language || 'Any'}</td>
                    <td style={{ maxWidth: 220 }}>
                      <strong>{rule.matchType}</strong>
                      <div style={{ marginTop: 4, color: 'var(--color-fg-2)', whiteSpace: 'pre-wrap' }}>{rule.pattern}</div>
                    </td>
                    <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{rule.response}</td>
                    <td>
                      <strong>{rule.hitCount}</strong>
                      <div className="app-muted" style={{ fontSize: 11 }}>{formatDateTime(rule.lastMatchedAt)}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {canManageRule ? (
                          <Link className="btn btn-secondary" style={{ minHeight: 28, padding: '5px 10px' }} href={`/support/training?edit=${rule.id}`}>
                            Edit
                          </Link>
                        ) : (
                          <span className="app-chip app-chip-neutral">Read only</span>
                        )}
                        <form action={toggleBotTrainingRuleAction}>
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <button className="btn btn-secondary" style={{ minHeight: 28, padding: '5px 10px' }} type="submit" disabled={!canManageRule}>
                            {rule.enabled ? 'Pause' : 'Enable'}
                          </button>
                        </form>
                        <form action={deleteBotTrainingRuleAction}>
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <button className="btn btn-ghost" style={{ minHeight: 28, padding: '5px 10px', color: 'var(--color-error)' }} type="submit" disabled={!canManageRule}>
                            Delete
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
