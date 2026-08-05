import Link from 'next/link';
import { Fragment, type CSSProperties } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { canScope, describeScope } from '@/lib/access-control';
import { getAvailableBrands } from '@/lib/available-brands';
import { resolveSelectedBrand } from '@/lib/brand-context';
import { requirePagePermission } from '@/lib/authz';
import { listTikTokAdvertisers, type TikTokAdvertiser } from '@/lib/tiktok-api';
import { getTikTokConfigStatus, getTikTokServerConfig } from '@/lib/tiktok-config';
import { getTikTokAccountConfigStatus } from '@/lib/tiktok-account-config';
import {
  getTikTokConnectionView,
  resolveTikTokConnection,
  TIKTOK_REVOCATION_PENDING_MESSAGE,
  type TikTokConnectionView,
} from '@/lib/tiktok-connection';
import {
  getTikTokAccountConnectionView,
  hasTikTokDmPermissions,
  TIKTOK_ACCOUNT_REVOCATION_PENDING_MESSAGE,
} from '@/lib/tiktok-account-connection';
import {
  disconnectTikTokAccountAction,
  disconnectTikTokAction,
  configureTikTokWebhooksAction,
  forceDisconnectTikTokAccountAction,
  forceDisconnectTikTokAction,
  selectTikTokAdvertiserAction,
  setTikTokDmAutomationAction,
  testTikTokConnectionAction,
} from './actions';
import { TikTokDisconnectButton } from './TikTokDisconnectButton';

export const dynamic = 'force-dynamic';

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
} satisfies CSSProperties;

const cardStyle = {
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--color-bg-surface)',
  padding: 16,
} satisfies CSSProperties;

function maskId(value?: string | null): string {
  if (!value) return 'Not selected';
  if (value.length <= 8) return value;
  return `••••${value.slice(-6)}`;
}

function formatDate(value?: Date | null): string {
  return value
    ? new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
    : 'Not yet';
}

function statusMessage(status?: string, error?: string): { text: string; tone: 'good' | 'warn' | 'bad' } | null {
  if (status === 'connected') {
    return { text: 'TikTok Ads connected successfully.', tone: 'good' };
  }
  if (status === 'account_connected') {
    return { text: 'TikTok Business Account connected successfully.', tone: 'good' };
  }
  if (status === 'webhooks_configured') {
    return { text: 'TikTok comment and direct-message webhooks were configured.', tone: 'good' };
  }
  if (status === 'select_advertiser') {
    return { text: 'Authorization succeeded. Select the advertiser account for this brand.', tone: 'warn' };
  }
  const errors: Record<string, string> = {
    missing_brand: 'Choose a brand before connecting TikTok Ads.',
    configuration: 'TikTok credentials are not configured yet. Add them after app approval.',
    disconnect_first: 'Disconnect the existing TikTok authorization before starting a new one.',
    authorization_cancelled: 'TikTok authorization was cancelled or expired.',
    authorization_failed: 'TikTok authorization could not be completed. Start it again.',
    account_configuration: 'TikTok Business Account authorization is waiting for the approved account-holder URL and trailing-slash callback.',
    account_disconnect_first: 'Disconnect the existing TikTok Business Account before authorizing another one for this brand.',
    account_authorization_cancelled: 'TikTok Business Account authorization was cancelled or expired.',
    account_authorization_failed: 'TikTok Business Account authorization could not be completed. Start it again.',
    webhook_configuration_failed: 'TikTok rejected the webhook configuration. Confirm app approval and the callback URL, then retry.',
  };
  return error ? { text: errors[error] || 'TikTok authorization could not be completed.', tone: 'bad' } : null;
}

function ReadinessCard({
  label,
  ready,
  note,
}: {
  label: string;
  ready: boolean;
  note: string;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <strong style={{ color: 'var(--color-fg-1)', fontSize: 13 }}>{label}</strong>
        <span className={`app-chip ${ready ? 'app-chip-success' : 'app-chip-warning'}`}>
          {ready ? 'Ready' : 'Waiting'}
        </span>
      </div>
      <p className="app-muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>{note}</p>
    </div>
  );
}

async function loadAuthorizedAdvertisers(
  view: TikTokConnectionView,
): Promise<{ advertisers: TikTokAdvertiser[]; available: boolean }> {
  if (!view.connected) return { advertisers: [], available: false };
  try {
    const connection = await resolveTikTokConnection(view.brand);
    if (!connection) return { advertisers: [], available: false };
    const config = getTikTokServerConfig();
    const result = await listTikTokAdvertisers({
      appId: config.appId,
      appSecret: config.appSecret,
      accessToken: connection.accessToken,
      apiBaseUrl: config.apiBaseUrl,
    });
    return { advertisers: result.advertisers, available: true };
  } catch {
    return { advertisers: [], available: false };
  }
}

export default async function TikTokSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; status?: string; error?: string }>;
}) {
  const scope = await requirePagePermission('settings:view');
  const params = await searchParams;
  const selectedBrand = resolveSelectedBrand(scope, params.brand);
  const availableBrands = await getAvailableBrands(scope);
  const brandNames = selectedBrand ? [selectedBrand] : availableBrands;
  const canManage = canScope(scope, 'settings:write');
  const configStatus = getTikTokConfigStatus();
  const accountConfigStatus = getTikTokAccountConfigStatus();
  const [views, accountViews] = await Promise.all([
    Promise.all(brandNames.map(getTikTokConnectionView)),
    Promise.all(brandNames.map(getTikTokAccountConnectionView)),
  ]);
  const advertiserResults = await Promise.all(views.map(loadAuthorizedAdvertisers));
  const banner = statusMessage(params.status, params.error);

  return (
    <main className="main">
      <PageHeader
        title="TikTok"
        subtitle="Separate connections for paid advertising and organic comments/direct messages"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link className="btn btn-secondary" href="/settings">Settings</Link>
            <span className="app-chip app-chip-neutral">{describeScope(scope)}</span>
          </div>
        }
      />

      <div className="content" style={{ display: 'grid', gap: 18 }}>
        {banner && (
          <section
            style={{
              ...cardStyle,
              borderColor: banner.tone === 'good'
                ? 'var(--color-success-muted)'
                : banner.tone === 'bad'
                  ? 'var(--color-error-muted)'
                  : 'var(--color-warning-muted)',
              color: banner.tone === 'good'
                ? 'var(--color-success)'
                : banner.tone === 'bad'
                  ? 'var(--color-error)'
                  : 'var(--color-warning)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {banner.text}
          </section>
        )}

        <section style={gridStyle}>
          <ReadinessCard
            label="Developer app"
            ready={configStatus.appIdConfigured && configStatus.appSecretConfigured}
            note={configStatus.appIdConfigured && configStatus.appSecretConfigured
              ? 'TikTok App ID and Secret are configured server-side.'
              : 'Awaiting app approval and the App ID/Secret from TikTok.'}
          />
          <ReadinessCard
            label="Business Account OAuth"
            ready={accountConfigStatus.readyForAuthorization}
            note={accountConfigStatus.readyForAuthorization
              ? `Approved account callback: ${accountConfigStatus.redirectUri}`
              : 'Waiting for TikTok Accounts/Messaging approval, the generated account-holder URL, and a trailing-slash callback.'}
          />
          <ReadinessCard
            label="TikTok DM chatbot"
            ready={accountConfigStatus.dmAutoReplyEnabled}
            note={accountConfigStatus.dmAutoReplyEnabled
              ? 'Automatic DM replies are enabled; public comments remain manual.'
              : 'Safe mode: DMs and comments enter Support for a human reply. Enable DM automation only after live permission testing.'}
          />
          <ReadinessCard
            label="Account webhooks"
            ready={accountConfigStatus.webhookReady}
            note={accountConfigStatus.webhookCallbackUrl || 'Set TIKTOK_WEBHOOK_CALLBACK_URL or APP_BASE_URL.'}
          />
          <ReadinessCard
            label="Token protection"
            ready={configStatus.tokenEncryptionConfigured}
            note={configStatus.tokenEncryptionConfigured
              ? 'OAuth access tokens will be encrypted before database storage.'
              : 'Set a dedicated TIKTOK_TOKEN_ENCRYPTION_KEY before authorizing.'}
          />
          <ReadinessCard
            label="OAuth callback"
            ready={Boolean(configStatus.redirectUri)}
            note={configStatus.redirectUri || 'Set the exact registered TIKTOK_REDIRECT_URI.'}
          />
        </section>

        <section style={{ ...cardStyle, background: '#F7F6F2' }}>
          <strong style={{ fontSize: 13, color: 'var(--color-fg-1)' }}>Two separate TikTok authorizations</strong>
          <p className="app-muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
            TikTok Ads uses the long-term Marketing API token below. Organic comments and direct messages use a separate,
            rotating Business Account token. Comments are intentionally routed to Support for a human reply; the existing
            GarmentOS chatbot can answer DMs after Business Messaging and privacy-review approval are tested.
          </p>
          <form action={configureTikTokWebhooksAction} style={{ marginTop: 12 }}>
            <button
              className="btn btn-secondary"
              type="submit"
              disabled={!canManage || !accountConfigStatus.webhookReady}
            >
              Configure comment + DM webhooks
            </button>
          </form>
        </section>

        {views.length === 0 && (
          <section style={cardStyle}>
            <p className="app-muted">Create a brand in Merchant Settings before connecting TikTok Ads.</p>
          </section>
        )}

        {views.map((view, index) => {
          const advertiserResult = advertiserResults[index];
          const accountView = accountViews[index];
          const ready = view.connected && Boolean(view.advertiserId) && !view.lastError;
          const connectHref = `/api/integrations/tiktok/connect?brand=${encodeURIComponent(view.brand)}`;
          const accountConnectHref = `/api/integrations/tiktok/account/connect?brand=${encodeURIComponent(view.brand)}`;
          const accountReady = accountView.connected && !accountView.lastError;
          const dmPermissionsReady = hasTikTokDmPermissions(accountView.grantedScopes);

          return (
            <Fragment key={view.brand}>
            <section style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 17, margin: 0, color: 'var(--color-fg-1)' }}>{view.brand}</h2>
                  <p className="app-muted" style={{ marginTop: 4 }}>
                    {view.connected ? 'OAuth token saved securely.' : 'No TikTok advertiser authorization yet.'}
                  </p>
                </div>
                <span className={`app-chip ${ready ? 'app-chip-success' : view.connected ? 'app-chip-warning' : 'app-chip-neutral'}`}>
                  {ready ? 'Ready' : view.connected ? 'Needs review' : 'Not connected'}
                </span>
              </div>

              <div style={{ ...gridStyle, marginTop: 16 }}>
                <div>
                  <div className="app-section-label">Advertiser</div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>{view.advertiserName || 'Not selected'}</div>
                  <div className="app-muted" style={{ fontSize: 11, marginTop: 2 }}>{maskId(view.advertiserId)}</div>
                </div>
                <div>
                  <div className="app-section-label">Authorized</div>
                  <div style={{ marginTop: 4 }}>{formatDate(view.authorizedAt)}</div>
                </div>
                <div>
                  <div className="app-section-label">Last verified</div>
                  <div style={{ marginTop: 4 }}>{formatDate(view.lastVerifiedAt)}</div>
                </div>
                <div>
                  <div className="app-section-label">Granted scopes</div>
                  <div style={{ marginTop: 4 }}>{view.grantedScopes.length > 0 ? view.grantedScopes.join(', ') : 'Reported after OAuth'}</div>
                </div>
              </div>

              {view.lastError && (
                <div style={{ marginTop: 14, color: 'var(--color-error)', fontSize: 12, fontWeight: 650 }}>
                  {view.lastError}
                </div>
              )}

              {view.connected && advertiserResult.advertisers.length > 0 && (
                <form action={selectTikTokAdvertiserAction} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 16 }}>
                  <input type="hidden" name="brand" value={view.brand} />
                  <label style={{ display: 'grid', gap: 5, flex: '1 1 280px' }}>
                    <span className="app-section-label">Authorized advertiser account</span>
                    <select className="app-input" name="advertiserId" defaultValue={view.advertiserId || ''} disabled={!canManage} required>
                      <option value="" disabled>Select advertiser</option>
                      {advertiserResult.advertisers.map((advertiser) => (
                        <option key={advertiser.advertiserId} value={advertiser.advertiserId}>
                          {advertiser.advertiserName || 'Unnamed advertiser'} · {advertiser.advertiserId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn-secondary" type="submit" disabled={!canManage}>Save advertiser</button>
                </form>
              )}

              {view.connected && !advertiserResult.available && (
                <p className="app-muted" style={{ fontSize: 11, marginTop: 12 }}>
                  Advertiser choices will load after TikTok approval and credential configuration.
                </p>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                {!view.connected && configStatus.ready && canManage ? (
                  <Link className="btn btn-primary" href={connectHref}>
                    Connect TikTok Ads
                  </Link>
                ) : !view.connected ? (
                  <button className="btn btn-primary" type="button" disabled>
                    {configStatus.ready ? 'Connect TikTok Ads' : 'Awaiting credentials'}
                  </button>
                ) : null}
                {view.connected && (
                  <>
                    <form action={testTikTokConnectionAction}>
                      <input type="hidden" name="brand" value={view.brand} />
                      <button className="btn btn-secondary" type="submit" disabled={!canManage}>Test connection</button>
                    </form>
                    <form action={disconnectTikTokAction}>
                      <input type="hidden" name="brand" value={view.brand} />
                      <TikTokDisconnectButton disabled={!canManage} />
                    </form>
                    {view.lastError === TIKTOK_REVOCATION_PENDING_MESSAGE && (
                      <form action={forceDisconnectTikTokAction}>
                        <input type="hidden" name="brand" value={view.brand} />
                        <TikTokDisconnectButton disabled={!canManage} forceLocal />
                      </form>
                    )}
                  </>
                )}
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 17, margin: 0, color: 'var(--color-fg-1)' }}>{accountView.brand} · Business Account</h2>
                  <p className="app-muted" style={{ marginTop: 4 }}>
                    {accountView.connected
                      ? 'Organic comments and DM authorization is stored separately from Ads.'
                      : 'Connect the brand TikTok account after Accounts and Messaging permissions are approved.'}
                  </p>
                </div>
                <span className={`app-chip ${accountReady ? 'app-chip-success' : accountView.connected ? 'app-chip-warning' : 'app-chip-neutral'}`}>
                  {accountReady ? 'Connected' : accountView.connected ? 'Needs review' : 'Not connected'}
                </span>
              </div>

              <div style={{ ...gridStyle, marginTop: 16 }}>
                <div>
                  <div className="app-section-label">TikTok account</div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>
                    {accountView.displayName || accountView.username || 'Reported after OAuth'}
                  </div>
                  <div className="app-muted" style={{ fontSize: 11, marginTop: 2 }}>{maskId(accountView.openId)}</div>
                </div>
                <div>
                  <div className="app-section-label">Authorized</div>
                  <div style={{ marginTop: 4 }}>{formatDate(accountView.authorizedAt)}</div>
                </div>
                <div>
                  <div className="app-section-label">Access token expires</div>
                  <div style={{ marginTop: 4 }}>{formatDate(accountView.accessTokenExpiresAt)}</div>
                </div>
                <div>
                  <div className="app-section-label">Granted scopes</div>
                  <div style={{ marginTop: 4 }}>
                    {accountView.grantedScopes.length > 0
                      ? accountView.grantedScopes.join(', ')
                      : 'Reported after OAuth'}
                  </div>
                </div>
                <div>
                  <div className="app-section-label">DM handling</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>
                    {accountView.dmAutoReplyEnabled && accountConfigStatus.dmAutoReplyEnabled
                      ? 'GarmentOS chatbot'
                      : 'Human Support Inbox'}
                  </div>
                </div>
              </div>

              {accountView.lastError && (
                <div style={{ marginTop: 14, color: 'var(--color-error)', fontSize: 12, fontWeight: 650 }}>
                  {accountView.lastError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                {!accountView.connected && accountConfigStatus.readyForAuthorization && canManage ? (
                  <Link className="btn btn-primary" href={accountConnectHref}>
                    Connect Business Account
                  </Link>
                ) : !accountView.connected ? (
                  <button className="btn btn-primary" type="button" disabled>
                    {accountConfigStatus.readyForAuthorization ? 'Connect Business Account' : 'Awaiting permissions'}
                  </button>
                ) : null}
                {accountView.connected && (
                  <form action={setTikTokDmAutomationAction}>
                    <input type="hidden" name="brand" value={accountView.brand} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={accountView.dmAutoReplyEnabled ? '0' : '1'}
                    />
                    <button
                      className="btn btn-secondary"
                      type="submit"
                      disabled={
                        !canManage
                        || (!accountConfigStatus.dmAutoReplyEnabled && !accountView.dmAutoReplyEnabled)
                        || (!dmPermissionsReady && !accountView.dmAutoReplyEnabled)
                      }
                    >
                      {accountView.dmAutoReplyEnabled ? 'Use human DM replies' : 'Enable DM chatbot'}
                    </button>
                  </form>
                )}
                {accountView.connected && (
                  <form action={disconnectTikTokAccountAction}>
                    <input type="hidden" name="brand" value={accountView.brand} />
                    <TikTokDisconnectButton disabled={!canManage} connectionType="business_account" />
                  </form>
                )}
                {accountView.lastError === TIKTOK_ACCOUNT_REVOCATION_PENDING_MESSAGE && (
                  <form action={forceDisconnectTikTokAccountAction}>
                    <input type="hidden" name="brand" value={accountView.brand} />
                    <TikTokDisconnectButton disabled={!canManage} forceLocal connectionType="business_account" />
                  </form>
                )}
              </div>
              {accountView.connected && !dmPermissionsReady && (
                <p className="app-muted" style={{ fontSize: 11, marginTop: 12 }}>
                  Reconnect after all approved Business Messaging permissions appear above before enabling the chatbot.
                </p>
              )}
            </section>
            </Fragment>
          );
        })}
      </div>
    </main>
  );
}
