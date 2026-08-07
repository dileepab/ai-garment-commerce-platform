/**
 * Turning a Meta Graph error payload into something diagnosable.
 *
 * The message alone is not enough. "Application does not have permission for
 * this action" is code 200, and that one sentence covers a missing permission,
 * a handover-protocol block, and a Page restriction — three different fixes.
 * Chasing it without the subcode means guessing, and guessing wrong costs days.
 *
 * So keep everything Meta gives us: the code and subcode to identify the cause,
 * error_user_msg where it adds detail the developer message omits, and
 * fbtrace_id, which is what Meta support asks for first.
 */
export interface MetaGraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export function metaGraphErrorOf(data: unknown): MetaGraphError | undefined {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === 'object' && error !== null) return error as MetaGraphError;
  }

  return undefined;
}

/**
 * A one-line description carrying every identifying field, suitable for a
 * webhook event row or a log line. Returns undefined when the payload holds no
 * error, so callers can fall back to an HTTP status.
 */
export function describeMetaGraphError(data: unknown): string | undefined {
  const error = metaGraphErrorOf(data);
  if (!error) return undefined;

  const message = error.message?.trim();
  const userMessage = error.error_user_msg?.trim();
  // error_user_msg is customer-facing wording and often repeats the developer
  // message; only add it when it actually says something different.
  const text = [message, userMessage && userMessage !== message ? userMessage : null]
    .filter(Boolean)
    .join(' — ');

  const codes = [
    typeof error.code === 'number' ? `code ${error.code}` : null,
    typeof error.error_subcode === 'number' ? `subcode ${error.error_subcode}` : null,
    error.fbtrace_id ? `trace ${error.fbtrace_id}` : null,
  ].filter(Boolean);

  if (!text) return codes.length > 0 ? codes.join(', ') : undefined;
  return codes.length > 0 ? `${text} [${codes.join(', ')}]` : text;
}
