'use client';

export function TikTokDisconnectButton({
  disabled = false,
  forceLocal = false,
  connectionType = 'advertiser',
}: {
  disabled?: boolean;
  forceLocal?: boolean;
  connectionType?: 'advertiser' | 'business_account';
}) {
  return (
    <button
      type="submit"
      className="btn btn-secondary"
      disabled={disabled}
      onClick={(event) => {
        const label = connectionType === 'business_account'
          ? 'Business Account'
          : 'advertiser account';
        const message = forceLocal
          ? 'Remove the local TikTok token even though remote revocation was not confirmed? Only continue if retrying revocation is impossible.'
          : `Revoke TikTok authorization and disconnect this ${label}?`;
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      style={{ justifyContent: 'center' }}
    >
      {forceLocal ? 'Remove local token only' : 'Disconnect'}
    </button>
  );
}
