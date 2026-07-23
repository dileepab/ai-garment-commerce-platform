'use client';

import { useState, useTransition } from 'react';
import {
  loadFacebookPagePostsAction,
  type FacebookPagePostsResult,
} from './actions';

function formatCreatedTime(value?: string): string {
  if (!value) return 'Creation time unavailable';
  return new Date(value).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function FacebookPostVerification({
  brand,
  disabled,
}: {
  brand: string;
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<FacebookPagePostsResult | null>(null);

  function loadPosts() {
    startTransition(async () => {
      setResult(await loadFacebookPagePostsAction(brand));
    });
  }

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
          Facebook post verification
        </div>
        <p className="app-muted" style={{ fontSize: 11, lineHeight: 1.45, marginTop: 3 }}>
          Reads recent Page posts, engagement totals, and user comments directly from Meta using pages_read_engagement and the pages_read_user_content dependency.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={loadPosts}
        disabled={disabled || isPending}
        style={{ justifyContent: 'center' }}
      >
        {isPending ? 'Loading from Meta...' : 'Load recent Page posts'}
      </button>

      {result && !result.ok && (
        <div
          role="alert"
          style={{
            border: '1px solid var(--color-error-muted)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-error-muted)',
            color: 'var(--color-error)',
            fontSize: 11,
            lineHeight: 1.45,
            padding: '7px 9px',
          }}
        >
          {result.error || 'Could not load Page posts from Meta.'}
        </div>
      )}

      {result?.ok && (
        <div style={{ display: 'grid', gap: 8 }} aria-live="polite">
          <div
            style={{
              border: '1px solid var(--color-success-muted)',
              borderRadius: 'var(--radius-md)',
              background: '#EDFAF4',
              color: 'var(--color-success)',
              fontSize: 11,
              lineHeight: 1.45,
              padding: '7px 9px',
            }}
          >
            Loaded live from Meta: {result.pageName || brand} · Page ID {result.pageId || 'unavailable'}
          </div>

          {result.commentReadError && (
            <div
              role="alert"
              style={{
                border: '1px solid var(--color-warning-muted)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-warning-muted)',
                color: 'var(--color-warning)',
                fontSize: 11,
                lineHeight: 1.45,
                padding: '7px 9px',
              }}
            >
              Page posts loaded, but comments are unavailable until pages_read_user_content is granted to this Page token: {result.commentReadError}
            </div>
          )}

          {result.posts.length === 0 ? (
            <div className="app-muted" style={{ fontSize: 11 }}>Meta returned no published posts.</div>
          ) : (
            result.posts.map((post) => (
              <article
                key={post.id}
                style={{
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  display: 'grid',
                  gap: 5,
                  padding: 9,
                }}
              >
                <div className="cell-mono" style={{ fontSize: 10 }}>Post ID {post.id}</div>
                <div style={{ color: 'var(--color-fg-1)', fontSize: 12, lineHeight: 1.45 }}>
                  {post.message || 'Post has no message text.'}
                </div>
                <div className="app-muted" style={{ fontSize: 10 }}>{formatCreatedTime(post.createdTime)}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span className="app-chip app-chip-neutral">{post.reactionCount} reactions</span>
                  <span className="app-chip app-chip-neutral">{post.commentCount} comments</span>
                  <span className="app-chip app-chip-neutral">{post.shareCount} shares</span>
                </div>
                {post.recentComments.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--color-border-subtle)', display: 'grid', gap: 5, paddingTop: 6 }}>
                    <div className="app-section-label">Recent user comments</div>
                    {post.recentComments.map((comment) => (
                      <div key={comment.id} style={{ fontSize: 11, lineHeight: 1.4 }}>
                        <span>{comment.message || 'Comment has no message text.'}</span>
                        <span className="app-muted"> · {formatCreatedTime(comment.createdTime)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {post.permalinkUrl && (
                  <a
                    className="btn btn-secondary"
                    href={post.permalinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ justifyContent: 'center', marginTop: 2 }}
                  >
                    Open live Facebook post
                  </a>
                )}
              </article>
            ))
          )}
        </div>
      )}
    </div>
  );
}
