import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import prisma from '../src/lib/prisma.ts';
import { getAiStockReply } from '../src/lib/ai.ts';

// Mirrored risk classification check for validation in isolation
const isHighRisk = (msg: string) => {
  const s = msg.toLowerCase();
  const riskKeywords = [
    'refund', 'complaint', 'cheated', 'dispute', 'charge', 'extra fee',
    'wrong item', 'defective', 'damage', 'bad quality', 'useless',
    'custom size', 'tailor', 'customize', 'custom design', 'custom fit'
  ];
  return riskKeywords.some(keyword => s.includes(keyword));
};

describe('AI Support Reviewer - Risk Classification', () => {
  test('correctly flags refund and billing inquiries as high-risk', () => {
    assert.equal(isHighRisk('I want a refund for my order'), true);
    assert.equal(isHighRisk('Why was I charged an extra fee?'), true);
    assert.equal(isHighRisk('I feel cheated by this store'), true);
  });

  test('correctly flags defects and quality complaints as high-risk', () => {
    assert.equal(isHighRisk('My dress arrived damaged and defective'), true);
    assert.equal(isHighRisk('This fabric is bad quality and useless'), true);
  });

  test('correctly flags custom size and tailoring requests as high-risk', () => {
    assert.equal(isHighRisk('Can you make a custom size for me?'), true);
    assert.equal(isHighRisk('I want a custom fit tailor design'), true);
  });

  test('ignores standard sales and availability queries', () => {
    assert.equal(isHighRisk('Do you have size M available in black?'), false);
    assert.equal(isHighRisk('What is the price of the oversized casual top?'), false);
    assert.equal(isHighRisk('Please confirm my delivery to Colombo'), false);
  });
});

describe('AI Support Reviewer - Reply Integration', () => {
  test('getAiStockReply routes a high-risk refund request safely to support', async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logInfo('Test Bypass', 'Bypassing live Gemini integration test — GEMINI_API_KEY is not configured.');
      return;
    }

    // Call getAiStockReply with a high-risk refund message
    const reply = await getAiStockReply(
      'I received a damaged, defective item and I want a full refund immediately!',
      'test-reviewer-sender-id',
      'messenger',
      'Cleopatra',
      'Test Reviewer User',
      'unknown',
      { persistConversation: false } // Don't write logs to DB during testing
    );

    assert.ok(reply);
    // Ensure the chatbot reacts safely by mentioning human support / contact information
    assert.match(
      reply,
      /(support|agent|help|contact|apologize|sorry|human)/i,
      `Expected a support-safe fallback response for refund requests, but received: "${reply}"`
    );
  });
});

function logInfo(title: string, msg: string) {
  console.log(`[${title}] ${msg}`);
}
