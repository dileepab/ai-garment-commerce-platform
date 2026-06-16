import Link from 'next/link';
import prisma from '@/lib/prisma';
import {
  canAccessBrand,
  describeScope,
} from '@/lib/access-control';
import { brandsMatch } from '@/lib/brand-aliases';
import { getSelectedBrandScopedWhere, resolveSelectedBrand } from '@/lib/brand-context';
import { requirePagePermission } from '@/lib/authz';
import {
  getBrandChannelConfigView,
  type BrandChannelConfigView,
} from '@/lib/brand-channel-config';
import { getMetaCommentAutoReplyMode } from '@/lib/meta-feature-flags';
import { PageHeader } from '@/components/PageHeader';
import { MetaConnectionTestButton } from './MetaConnectionTestButton';

export const dynamic = 'force-dynamic';

type HealthTone = 'good' | 'warn' | 'bad' | 'neutral';

interface BrandHealth {
  brand: string;
  config: BrandChannelConfigView;
  webhook24h: {
    facebook: { total: number; failed: number };
    instagram: { total: number; failed: number };
  };
  publish30d: {
    facebook: { published: number; failed: number };
    instagram: { published: number; failed: number };
  };
}

function uniqueBrands(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b));
}

function metricKey(brand: string | null, channel: string, status: string): string {
  return `${brand || ''}|${channel}|${status}`;
}

function toneStyles(tone: HealthTone) {
  if (tone === 'good') {
    return { background: 'var(--color-success-muted)', color: 'var(--color-success)', borderColor: 'transparent' };
  }
  if (tone === 'warn') {
    return { background: 'var(--color-warning-muted)', color: 'var(--color-warning)', borderColor: 'transparent' };
  }
  if (tone === 'bad') {
    return { background: 'var(--color-error-muted)', color: 'var(--color-error)', borderColor: 'transparent' };
  }
  return { background: 'var(--color-bg)', color: 'var(--color-fg-2)', borderColor: 'var(--color-border)' };
}

function StatusChip({ label, tone }: { label: string; tone: HealthTone }) {
  return (
    <span className="app-chip" style={toneStyles(tone)}>
      {label}
    </span>
  );
}

function maskId(value?: string | null): string {
  if (!value) return 'Not set';
  if (value.length <= 8) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatDateTime(value?: Date | null): string {
  if (!value) return 'Not processed';
  return value.toLocaleString('en-LK', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function trimText(value?: string | null, maxLength = 120): string {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function channelReady(config: BrandChannelConfigView, channel: 'facebook' | 'instagram'): boolean {
  if (channel === 'facebook') {
    return Boolean(config.facebookPageId && config.hasFacebookPageAccessToken);
  }
  return Boolean(config.instagramAccountId && config.hasInstagramAccessToken);
}

function readinessTone(ready: boolean): HealthTone {
  return ready ? 'good' : 'warn';
}

function ChannelHealthBlock({
  brand,
  channel,
  config,
  webhook,
  publish,
}: {
  brand: string;
  channel: 'facebook' | 'instagram';
  config: BrandChannelConfigView;
  webhook: { total: number; failed: number };
  publish: { published: number; failed: number };
}) {
  const isFacebook = channel === 'facebook';
  const accountId = isFacebook ? config.facebookPageId : config.instagramAccountId;
  const hasToken = isFacebook ? config.hasFacebookPageAccessToken : config.hasInstagramAccessToken;
  const ready = Boolean(accountId && hasToken);
  const label = isFacebook ? 'Facebook Page' : 'Instagram Business';

  return (
    <div
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        background: 'var(--color-bg)',
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-fg-1)' }}>{label}</div>
          <div className="app-muted" style={{ fontSize: 12 }}>ID {maskId(accountId)}</div>
        </div>
        <StatusChip label={ready ? 'Configured' : 'Needs setup'} tone={readinessTone(ready)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <div>
          <div className="app-section-label">Token</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: hasToken ? 'var(--color-success)' : 'var(--color-warning)' }}>
            {hasToken ? 'Saved' : 'Missing'}
          </div>
        </div>
        <div>
          <div className="app-section-label">Webhooks 24h</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: webhook.failed > 0 ? 'var(--color-error)' : 'var(--color-fg-1)' }}>
            {webhook.total} total · {webhook.failed} failed
          </div>
        </div>
        <div>
          <div className="app-section-label">Publish 30d</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: publish.failed > 0 ? 'var(--color-error)' : 'var(--color-fg-1)' }}>
            {publish.published} ok · {publish.failed} failed
          </div>
        </div>
      </div>

      <MetaConnectionTestButton brand={brand} channel={channel} disabled={!ready} />
    </div>
  );
}

function ReadinessItem({
  label,
  note,
  ready,
  warning,
}: {
  label: string;
  note: string;
  ready: boolean;
  warning?: boolean;
}) {
  return (
    <div className="app-panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-fg-1)' }}>{label}</div>
          <p className="app-muted" style={{ marginTop: 4, fontSize: 12 }}>{note}</p>
        </div>
        <StatusChip
          label={ready ? (warning ? 'Review' : 'Ready') : 'Missing'}
          tone={ready ? (warning ? 'warn' : 'good') : 'bad'}
        />
      </div>
    </div>
  );
}

export default async function MetaStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const scope = await requirePagePermission('settings:view');
  const { brand: brandParam } = await searchParams;
  const selectedBrand = resolveSelectedBrand(scope, brandParam);
  const brandWhere = getSelectedBrandScopedWhere(scope, brandParam);
  const [settingsRows, channelRows, productBrands, postBrands, creativeBrands] = await Promise.all([
    prisma.merchantSettings.findMany({ select: { brand: true } }),
    prisma.brandChannelConfig.findMany({ select: { brand: true } }),
    prisma.product.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.socialPost.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.generatedCreative.findMany({ distinct: ['brand'], select: { brand: true } }),
  ]);
  const accessibleBrands = uniqueBrands([
    ...settingsRows.map((row) => row.brand),
    ...channelRows.map((row) => row.brand),
    ...productBrands.map((row) => row.brand),
    ...postBrands.map((row) => row.brand),
    ...creativeBrands.map((row) => row.brand),
  ]).filter((brand) => canAccessBrand(scope, brand));
  // Focus on the globally selected brand when one is set; otherwise show all.
  const matchedBrands = selectedBrand
    ? accessibleBrands.filter((brand) => brandsMatch(brand, selectedBrand))
    : accessibleBrands;
  const brandNames =
    selectedBrand && matchedBrands.length === 0 ? [selectedBrand] : matchedBrands;

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    configs,
    webhookGroups,
    publishGroups,
    recentWebhookEvents,
    commentGroups,
    queueGroups,
  ] = await Promise.all([
    Promise.all(brandNames.map((brand) => getBrandChannelConfigView(brand))),
    prisma.webhookEventLog.groupBy({
      by: ['brand', 'channel', 'status'],
      where: { ...brandWhere, receivedAt: { gte: since24h } },
      _count: { _all: true },
    }),
    prisma.socialPostPublishLog.groupBy({
      by: ['brand', 'channel', 'status'],
      where: { ...brandWhere, createdAt: { gte: since30d } },
      _count: { _all: true },
    }),
    prisma.webhookEventLog.findMany({
      where: brandWhere,
      orderBy: { receivedAt: 'desc' },
      take: 14,
      select: {
        id: true,
        brand: true,
        channel: true,
        eventType: true,
        senderId: true,
        pageOrAccountId: true,
        status: true,
        error: true,
        receivedAt: true,
        processedAt: true,
      },
    }),
    prisma.commentLog.groupBy({
      by: ['status'],
      where: { ...brandWhere, repliedAt: { gte: since7d } },
      _count: { _all: true },
    }),
    prisma.commentReplyQueue.groupBy({
      by: ['status'],
      where: brandWhere,
      _count: { _all: true },
    }),
  ]);

  const configByBrand = new Map(configs.map((config) => [config.brand, config]));
  const webhookCounts = new Map(
    webhookGroups.map((row) => [metricKey(row.brand, row.channel, row.status), row._count._all]),
  );
  const publishCounts = new Map(
    publishGroups.map((row) => [metricKey(row.brand, row.channel, row.status), row._count._all]),
  );
  const commentCounts = new Map(commentGroups.map((row) => [row.status, row._count._all]));
  const queueCounts = new Map(queueGroups.map((row) => [row.status, row._count._all]));

  const healthRows: BrandHealth[] = brandNames.map((brand) => {
    const config = configByBrand.get(brand) ?? {
      brand,
      facebookPageId: null,
      hasFacebookPageAccessToken: false,
      instagramAccountId: null,
      hasInstagramAccessToken: false,
      isTestBrand: false,
      notes: null,
    };

    return {
      brand,
      config,
      webhook24h: {
        facebook: {
          total: ['processing', 'processed', 'failed', 'skipped'].reduce((sum, status) => sum + (webhookCounts.get(metricKey(brand, 'facebook', status)) ?? 0), 0),
          failed: webhookCounts.get(metricKey(brand, 'facebook', 'failed')) ?? 0,
        },
        instagram: {
          total: ['processing', 'processed', 'failed', 'skipped'].reduce((sum, status) => sum + (webhookCounts.get(metricKey(brand, 'instagram', status)) ?? 0), 0),
          failed: webhookCounts.get(metricKey(brand, 'instagram', 'failed')) ?? 0,
        },
      },
      publish30d: {
        facebook: {
          published: publishCounts.get(metricKey(brand, 'facebook', 'published')) ?? 0,
          failed: publishCounts.get(metricKey(brand, 'facebook', 'failed')) ?? 0,
        },
        instagram: {
          published: publishCounts.get(metricKey(brand, 'instagram', 'published')) ?? 0,
          failed: publishCounts.get(metricKey(brand, 'instagram', 'failed')) ?? 0,
        },
      },
    };
  });

  const hasFacebookConfig = healthRows.some((row) => channelReady(row.config, 'facebook'));
  const hasInstagramConfig = healthRows.some((row) => channelReady(row.config, 'instagram'));
  const commentMode = await getMetaCommentAutoReplyMode();
  const pendingCommentQueue = queueCounts.get('pending') ?? 0;
  const failedComments = (commentCounts.get('failed') ?? 0) + (queueCounts.get('failed') ?? 0);

  return (
    <main className="main">
      <PageHeader
        title="Meta Status"
        subtitle="Connection health, reviewer readiness, token tests, and safe webhook diagnostics"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="app-chip app-chip-neutral">{describeScope(scope)}</span>
            <Link className="btn btn-secondary" href="/settings">Settings</Link>
          </div>
        }
      />

      <div className="content" style={{ display: 'grid', gap: 18 }}>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          <ReadinessItem
            label="Facebook publishing"
            note="At least one brand has a Page ID and saved Page token."
            ready={hasFacebookConfig}
          />
          <ReadinessItem
            label="Instagram publishing"
            note="At least one brand has an IG Business account ID and saved token."
            ready={hasInstagramConfig}
          />
          <ReadinessItem
            label="DM auto-replies"
            note={process.env.META_VERIFY_TOKEN ? 'Webhook verify token is configured.' : 'Set META_VERIFY_TOKEN before review demos.'}
            ready={Boolean(process.env.META_VERIFY_TOKEN)}
          />
          <ReadinessItem
            label="Comment auto-reply"
            note={commentMode === 'disabled' ? 'Prepared and intentionally disabled for later Meta review.' : 'Enabled in Merchant Settings; confirm review approval before production use.'}
            ready
            warning={commentMode === 'enabled'}
          />
        </section>

        <section className="app-panel" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <p className="app-section-label">Meta Connections</p>
              <h2 style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: 'var(--color-fg-1)' }}>
                Brand channel health
              </h2>
              <p className="app-muted" style={{ marginTop: 4 }}>
                Test buttons call Meta Graph with saved server-side tokens and only show redacted account details.
              </p>
            </div>
            <StatusChip label={`${brandNames.length} brand${brandNames.length === 1 ? '' : 's'}`} tone="neutral" />
          </div>

          {healthRows.length === 0 ? (
            <div className="app-muted">Add a brand in Settings to start configuring Meta channels.</div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {healthRows.map((row) => (
                <div key={row.brand} style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-fg-1)', margin: 0 }}>
                        {row.brand}
                      </h3>
                      {row.config.notes && (
                        <p className="app-muted" style={{ marginTop: 2, fontSize: 12 }}>{row.config.notes}</p>
                      )}
                    </div>
                    {row.config.isTestBrand && <StatusChip label="Test brand" tone="warn" />}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                    <ChannelHealthBlock
                      brand={row.brand}
                      channel="facebook"
                      config={row.config}
                      webhook={row.webhook24h.facebook}
                      publish={row.publish30d.facebook}
                    />
                    <ChannelHealthBlock
                      brand={row.brand}
                      channel="instagram"
                      config={row.config}
                      webhook={row.webhook24h.instagram}
                      publish={row.publish30d.instagram}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="app-panel" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <p className="app-section-label">Comment Automation</p>
              <h2 style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: 'var(--color-fg-1)' }}>
                Prepared, gated, and auditable
              </h2>
              <p className="app-muted" style={{ marginTop: 4 }}>
                Facebook and Instagram comment handlers can record skipped events while the Merchant Settings toggle stays off.
              </p>
            </div>
            <StatusChip label={commentMode === 'enabled' ? 'Enabled' : 'Disabled'} tone={commentMode === 'enabled' ? 'warn' : 'good'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div className="app-subpanel">
              <div className="app-section-label">Settings toggle</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-fg-1)', marginTop: 4 }}>
                {commentMode === 'enabled' ? 'Enabled in Merchant Settings' : 'Disabled in Merchant Settings'}
              </div>
            </div>
            <div className="app-subpanel">
              <div className="app-section-label">Pending queue</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-fg-1)', marginTop: 4 }}>{pendingCommentQueue}</div>
            </div>
            <div className="app-subpanel">
              <div className="app-section-label">Failures</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: failedComments > 0 ? 'var(--color-error)' : 'var(--color-fg-1)', marginTop: 4 }}>
                {failedComments}
              </div>
            </div>
          </div>
        </section>

        <section className="app-panel" style={{ padding: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <p className="app-section-label">Safe Webhook Debug</p>
            <h2 style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: 'var(--color-fg-1)' }}>
              Recent webhook events
            </h2>
            <p className="app-muted" style={{ marginTop: 4 }}>
              This panel shows dedupe/status metadata only. Sender, page, and event identifiers are masked.
            </p>
          </div>

          {recentWebhookEvents.length === 0 ? (
            <div className="app-muted">No webhook events recorded yet.</div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Brand</th>
                    <th>Channel</th>
                    <th>Event</th>
                    <th>Sender</th>
                    <th>Status</th>
                    <th>Processed</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recentWebhookEvents.map((event) => (
                    <tr key={event.id}>
                      <td className="cell-muted">{formatDateTime(event.receivedAt)}</td>
                      <td>{event.brand || 'Unknown'}</td>
                      <td>{event.channel}</td>
                      <td>{event.eventType}</td>
                      <td className="cell-mono">{maskId(event.senderId || event.pageOrAccountId || event.id)}</td>
                      <td>
                        <StatusChip
                          label={event.status}
                          tone={event.status === 'failed' ? 'bad' : event.status === 'processed' ? 'good' : event.status === 'skipped' ? 'warn' : 'neutral'}
                        />
                      </td>
                      <td className="cell-muted">{formatDateTime(event.processedAt)}</td>
                      <td className="cell-muted">{trimText(event.error) || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
