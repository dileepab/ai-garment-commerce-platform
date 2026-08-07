import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeMetaGraphError, metaGraphErrorOf } from '../src/lib/meta-error.ts';

// The failure that motivated this: Messenger sends to one Page were rejected
// with a message that reads the same whether the cause is a missing permission,
// a handover-protocol block, or a Page restriction. The subcode separates them.
test('the code, subcode and trace id survive alongside the message', () => {
  const described = describeMetaGraphError({
    error: {
      message: 'Application does not have permission for this action',
      type: 'OAuthException',
      code: 200,
      error_subcode: 2018028,
      fbtrace_id: 'AbCdEf123',
    },
  });

  assert.match(described!, /Application does not have permission for this action/);
  assert.match(described!, /code 200/);
  assert.match(described!, /subcode 2018028/);
  assert.match(described!, /trace AbCdEf123/);
});

test('a customer-facing message is kept when it adds detail', () => {
  const described = describeMetaGraphError({
    error: {
      message: 'Invalid parameter',
      code: 100,
      error_user_msg: 'This person is no longer available.',
    },
  });

  assert.match(described!, /Invalid parameter — This person is no longer available\./);
});

test('a duplicated customer-facing message is not repeated', () => {
  const described = describeMetaGraphError({
    error: {
      message: 'Something went wrong',
      code: 1,
      error_user_msg: 'Something went wrong',
    },
  });

  assert.equal(described, 'Something went wrong [code 1]');
});

test('codes alone still describe an error with no message', () => {
  assert.equal(
    describeMetaGraphError({ error: { code: 190, error_subcode: 463 } }),
    'code 190, subcode 463'
  );
});

test('subcode zero is reported rather than dropped', () => {
  const described = describeMetaGraphError({ error: { message: 'Nope', code: 0, error_subcode: 0 } });

  assert.match(described!, /code 0/);
  assert.match(described!, /subcode 0/);
});

test('a payload with no error yields undefined so callers fall back to the status', () => {
  assert.equal(describeMetaGraphError({ message_id: 'm_1' }), undefined);
  assert.equal(describeMetaGraphError(null), undefined);
  assert.equal(describeMetaGraphError('boom'), undefined);
  assert.equal(describeMetaGraphError({ error: null }), undefined);
});

test('the raw error object is available for callers that want the fields', () => {
  const error = metaGraphErrorOf({ error: { code: 200, error_subcode: 2018028 } });

  assert.equal(error?.code, 200);
  assert.equal(error?.error_subcode, 2018028);
});
