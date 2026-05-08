import prisma from '@/lib/prisma';
import type { CSSProperties, ReactNode } from 'react';
import {
  canAccessBrand,
  canScope,
  describeScope,
} from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import {
  getMerchantSettings,
  type MerchantSettings,
} from '@/lib/runtime-config';
import {
  getBrandChannelConfigView,
  type BrandChannelConfigView,
} from '@/lib/brand-channel-config';
import { PageHeader } from '@/components/PageHeader';
import { saveMerchantSettingsAction } from './actions';

export const dynamic = 'force-dynamic';

const fieldStyle = { display: 'grid', gap: 6 } satisfies CSSProperties;
const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--color-fg-3)',
} satisfies CSSProperties;
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
} satisfies CSSProperties;
const summaryStyle = {
  cursor: 'pointer',
  listStyle: 'none',
} satisfies CSSProperties;
const sectionSummaryStyle = {
  ...summaryStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
} satisfies CSSProperties;

function ExpandGlyph() {
  return (
    <span
      className="settings-expand-glyph"
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--color-border-subtle)',
        color: 'var(--color-fg-3)',
        fontSize: 13,
        flex: '0 0 auto',
      }}
    />
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="app-subpanel" open={defaultOpen}>
      <summary style={sectionSummaryStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-fg-1)', margin: 0 }}>
          {title}
        </h3>
        <ExpandGlyph />
      </summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}

function uniqueBrands(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b));
}

function NumberField({
  label,
  name,
  value,
  disabled,
  suffix,
}: {
  label: string;
  name: string;
  value: number;
  disabled: boolean;
  suffix?: string;
}) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          className="app-input"
          type="number"
          min="1"
          name={name}
          defaultValue={value}
          disabled={disabled}
        />
        {suffix && <span className="app-muted" style={{ whiteSpace: 'nowrap' }}>{suffix}</span>}
      </div>
    </label>
  );
}

function TextField({
  label,
  name,
  value,
  disabled,
  placeholder,
}: {
  label: string;
  name: string;
  value: string | null;
  disabled: boolean;
  placeholder?: string;
}) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        className="app-input"
        name={name}
        defaultValue={value || ''}
        disabled={disabled}
        placeholder={placeholder}
      />
    </label>
  );
}

function ToggleField({
  label,
  name,
  checked,
  disabled,
}: {
  label: string;
  name: string;
  checked: boolean;
  disabled: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 12px',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg)',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-fg-1)' }}>{label}</span>
      <input type="checkbox" name={name} defaultChecked={checked} disabled={disabled} />
    </label>
  );
}

function TokenField({
  label,
  name,
  hasValue,
  disabled,
}: {
  label: string;
  name: string;
  hasValue: boolean;
  disabled: boolean;
}) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        className="app-input"
        name={name}
        type="password"
        defaultValue=""
        disabled={disabled}
        placeholder={hasValue ? 'Saved - leave blank to keep' : 'Paste token'}
        autoComplete="off"
      />
    </label>
  );
}

function SettingsForm({
  settings,
  channelConfig,
  title,
  subtitle,
  canManage,
  defaultOpen = true,
}: {
  settings: MerchantSettings;
  channelConfig?: BrandChannelConfigView;
  title: string;
  subtitle: string;
  canManage: boolean;
  defaultOpen?: boolean;
}) {
  return (
    <form action={saveMerchantSettingsAction} className="app-panel" style={{ padding: 20 }}>
      <input type="hidden" name="brand" value={settings.brand || ''} />
      <details open={defaultOpen}>
        <summary
          style={{
            ...summaryStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <p className="app-section-label">{settings.brand ? 'Brand Settings' : 'Global Defaults'}</p>
            <h2 style={{ marginTop: 4, fontSize: 20, fontWeight: 700, color: 'var(--color-fg-1)' }}>{title}</h2>
            <p className="app-muted" style={{ marginTop: 4 }}>{subtitle}</p>
          </div>
          <ExpandGlyph />
        </summary>

        <div style={{ marginTop: 18 }}>
          {canManage && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
              <button className="app-button-primary" type="submit">Save settings</button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 18 }}>
            <CollapsibleSection title="Store and Support">
              <div style={gridStyle}>
                <TextField label="Display name" name="displayName" value={settings.displayName} disabled={!canManage} />
                <TextField label="Support phone" name="supportPhone" value={settings.support.phone} disabled={!canManage} />
                <TextField label="Support WhatsApp" name="supportWhatsapp" value={settings.support.whatsapp} disabled={!canManage} />
                <TextField label="Support hours" name="supportHours" value={settings.support.hours} disabled={!canManage} />
              </div>
              <div style={{ ...gridStyle, marginTop: 12 }}>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Handoff wording</span>
                  <textarea
                    className="app-textarea"
                    name="supportHandoffMessage"
                    defaultValue={settings.support.handoffMessage || ''}
                    disabled={!canManage}
                    placeholder="Optional custom lead sentence for human support handoff replies"
                  />
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Processing fallback</span>
                  <textarea
                    className="app-textarea"
                    name="processingErrorMessage"
                    defaultValue={settings.support.processingErrorMessage}
                    disabled={!canManage}
                  />
                </label>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Delivery and Payments">
              <div style={gridStyle}>
                <NumberField label="Colombo charge" name="deliveryColomboCharge" value={settings.delivery.colomboCharge} disabled={!canManage} suffix="Rs" />
                <NumberField label="Outside charge" name="deliveryOutsideColomboCharge" value={settings.delivery.outsideColomboCharge} disabled={!canManage} suffix="Rs" />
                <TextField label="Colombo window" name="deliveryColomboEstimate" value={settings.delivery.colomboEstimate} disabled={!canManage} />
                <TextField label="Outside window" name="deliveryOutsideColomboEstimate" value={settings.delivery.outsideColomboEstimate} disabled={!canManage} />
              </div>
              <div style={{ ...gridStyle, marginTop: 12 }}>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Payment methods</span>
                  <textarea
                    className="app-textarea"
                    name="paymentMethods"
                    defaultValue={settings.payment.methods.join('\n')}
                    disabled={!canManage}
                  />
                </label>
                <div style={{ display: 'grid', gap: 12 }}>
                  <TextField label="Default payment" name="defaultPaymentMethod" value={settings.payment.defaultMethod} disabled={!canManage} />
                  <TextField label="Online transfer label" name="onlineTransferLabel" value={settings.payment.onlineTransferLabel} disabled={!canManage} />
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Automations">
              <div style={gridStyle}>
                <ToggleField label="Cart recovery" name="cartRecoveryEnabled" checked={settings.automation.cartRecoveryEnabled} disabled={!canManage} />
                <NumberField label="Cart delay" name="cartRecoveryDelayHours" value={settings.automation.cartRecoveryDelayHours} disabled={!canManage} suffix="hours" />
                <NumberField label="Cart cooldown" name="cartRecoveryCooldownHours" value={settings.automation.cartRecoveryCooldownHours} disabled={!canManage} suffix="hours" />
                <ToggleField label="Support timeout" name="supportTimeoutEnabled" checked={settings.automation.supportTimeoutEnabled} disabled={!canManage} />
                <NumberField label="Support delay" name="supportTimeoutDelayHours" value={settings.automation.supportTimeoutDelayHours} disabled={!canManage} suffix="hours" />
                <NumberField label="Support cooldown" name="supportTimeoutCooldownHours" value={settings.automation.supportTimeoutCooldownHours} disabled={!canManage} suffix="hours" />
                <ToggleField label="Post-order follow-up" name="postOrderFollowUpEnabled" checked={settings.automation.postOrderFollowUpEnabled} disabled={!canManage} />
                <NumberField label="Follow-up delay" name="postOrderFollowUpDelayDays" value={settings.automation.postOrderFollowUpDelayDays} disabled={!canManage} suffix="days" />
                <NumberField label="Follow-up window" name="postOrderFollowUpWindowDays" value={settings.automation.postOrderFollowUpWindowDays} disabled={!canManage} suffix="days" />
                <ToggleField label="Reorder reminder" name="reorderReminderEnabled" checked={settings.automation.reorderReminderEnabled} disabled={!canManage} />
                <NumberField label="Reorder delay" name="reorderReminderDelayDays" value={settings.automation.reorderReminderDelayDays} disabled={!canManage} suffix="days" />
                <NumberField label="Reorder window" name="reorderReminderWindowDays" value={settings.automation.reorderReminderWindowDays} disabled={!canManage} suffix="days" />
                <NumberField label="Purchase nudge cooldown" name="purchaseNudgeCooldownDays" value={settings.automation.purchaseNudgeCooldownDays} disabled={!canManage} suffix="days" />
              </div>
            </CollapsibleSection>

            {settings.brand && channelConfig && (
              <CollapsibleSection title="Meta Channels">
                <p className="app-muted" style={{ marginBottom: 12 }}>
                  Configure the Facebook Page and Instagram account used for this brand. Tokens are stored server-side; leave token fields blank to keep the saved value.
                </p>
                <div style={gridStyle}>
                  <TextField
                    label="Facebook Page ID"
                    name="facebookPageId"
                    value={channelConfig.facebookPageId}
                    disabled={!canManage}
                    placeholder="e.g. 1078757381992224"
                  />
                  <TokenField
                    label="Facebook Page token"
                    name="facebookPageAccessToken"
                    hasValue={channelConfig.hasFacebookPageAccessToken}
                    disabled={!canManage}
                  />
                  <TextField
                    label="Instagram Account ID"
                    name="instagramAccountId"
                    value={channelConfig.instagramAccountId}
                    disabled={!canManage}
                    placeholder="Optional"
                  />
                  <TokenField
                    label="Instagram token"
                    name="instagramAccessToken"
                    hasValue={channelConfig.hasInstagramAccessToken}
                    disabled={!canManage}
                  />
                </div>
                <div style={{ ...gridStyle, marginTop: 12 }}>
                  <ToggleField
                    label="Test/sandbox brand"
                    name="isTestBrand"
                    checked={channelConfig.isTestBrand}
                    disabled={!canManage}
                  />
                  <TextField
                    label="Notes"
                    name="channelNotes"
                    value={channelConfig.notes}
                    disabled={!canManage}
                    placeholder="e.g. BestBuy testing Page before Happy Buy goes live"
                  />
                </div>
              </CollapsibleSection>
            )}
          </div>
        </div>
      </details>
    </form>
  );
}

export default async function SettingsPage() {
  const scope = await requirePagePermission('settings:view');
  const canManage = canScope(scope, 'settings:write');
  const [settingsRows, channelRows, productBrands, orderBrands, supportBrands] = await Promise.all([
    prisma.merchantSettings.findMany({ select: { brand: true } }),
    prisma.brandChannelConfig.findMany({ select: { brand: true } }),
    prisma.product.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.order.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.supportEscalation.findMany({ distinct: ['brand'], select: { brand: true } }),
  ]);
  const brandNames = uniqueBrands([
    ...settingsRows.map((row) => row.brand),
    ...channelRows.map((row) => row.brand),
    ...productBrands.map((row) => row.brand),
    ...orderBrands.map((row) => row.brand),
    ...supportBrands.map((row) => row.brand),
  ]).filter((brand) => canAccessBrand(scope, brand));
  const globalSettings = await getMerchantSettings();
  const scopedSettings = await Promise.all(
    brandNames.map(async (brand) => ({
      settings: await getMerchantSettings(brand),
      channelConfig: await getBrandChannelConfigView(brand),
    }))
  );

  return (
    <main className="main">
      <PageHeader
        title="Merchant Settings"
        subtitle="Operational defaults for support, delivery, payments, automation timing, and brand-specific customer replies"
        actions={<span className="app-chip app-chip-neutral">{describeScope(scope)}</span>}
      />

      <div className="content" style={{ display: 'grid', gap: 18 }}>
        <SettingsForm
          settings={globalSettings}
          title="Global defaults"
          subtitle="Used when a brand-specific setting has not been saved."
          canManage={canManage}
        />

        {scopedSettings.length > 0 && (
          <section style={{ display: 'grid', gap: 14 }}>
            <div>
              <p className="app-section-label">Brand Overrides</p>
              <h2 style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: 'var(--color-fg-1)' }}>
                Store-specific settings
              </h2>
            </div>
            {scopedSettings.map(({ settings, channelConfig }) => (
              <SettingsForm
                key={settings.storeKey}
                settings={settings}
                channelConfig={channelConfig}
                title={settings.displayName}
                subtitle={`Overrides customer-facing behavior for ${settings.brand}.`}
                canManage={canManage}
                defaultOpen={false}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
