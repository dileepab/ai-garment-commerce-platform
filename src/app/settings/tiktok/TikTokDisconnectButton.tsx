'use client';

export function TikTokDisconnectButton({
  disabled = false,
  forceLocal = false,
}: {
  disabled?: boolean;
  forceLocal?: boolean;
}) {
  return (
    <button
      type="submit"
      className="btn btn-secondary"
      disabled={disabled}
      onClick={(event) => {
        const message = forceLocal
          ? 'Remove the local TikTok token even though remote revocation was not confirmed? Only continue if retrying revocation is impossible.'
          : 'Revoke TikTok authorization and disconnect this advertiser account?';
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
