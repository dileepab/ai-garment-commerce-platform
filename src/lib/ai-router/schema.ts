import { ROUTED_ACTIONS, PRODUCT_QUESTION_TYPES, PAYMENT_METHODS, PRODUCT_TYPES } from './types';

export const ROUTER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'action',
    'confidence',
    'orderId',
    'productName',
    'productType',
    'questionType',
    'quantity',
    'size',
    'color',
    'paymentMethod',
    'giftWrap',
    'giftNote',
    'requestedDate',
    'deliveryLocation',
    'contact',
  ],
  properties: {
    action: {
      type: 'string',
      enum: [...ROUTED_ACTIONS],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    orderId: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
    },
    productName: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    productType: {
      anyOf: [{ type: 'string', enum: [...PRODUCT_TYPES] }, { type: 'null' }],
    },
    questionType: {
      anyOf: [{ type: 'string', enum: [...PRODUCT_QUESTION_TYPES] }, { type: 'null' }],
    },
    quantity: {
      anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
    },
    size: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    color: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    paymentMethod: {
      anyOf: [{ type: 'string', enum: [...PAYMENT_METHODS] }, { type: 'null' }],
    },
    giftWrap: {
      anyOf: [{ type: 'boolean' }, { type: 'null' }],
    },
    giftNote: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    requestedDate: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    deliveryLocation: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    contact: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'address', 'phone'],
      properties: {
        name: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
        address: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
        phone: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
      },
    },
  },
} as const;
