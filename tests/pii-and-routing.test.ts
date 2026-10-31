import { describe, it, expect } from 'vitest';
import { redactSensitiveData } from '../src/pii-redactor';
import { determineRoutingRecommendation } from '../src/token-metrics';
import { preprocessImage } from '../src/preprocess';

describe('PII Scrubber and Vision Routing Engine', () => {
  it('redacts sensitive API keys and cloud credentials', () => {
    const rawText = [
      'Exporting environment variables:',
      'OPENAI_API_KEY=sk-proj-abc12345678901234567890abcdef',
      'GITHUB_TOKEN=ghp_123456789012345678901234567890123456',
      'GOOGLE_KEY=AIzaSyD-1234567890abcdef1234567890abc',
      'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
      'Authorization: Bearer secret-auth-token-1234567890-test',
    ].join('\n');

    const result = redactSensitiveData(rawText);

    expect(result.redactionCount).toBe(5);
    expect(result.redactedTypes).toContain('secret');
    expect(result.sanitizedText).not.toContain('sk-proj-abc12345678901234567890abcdef');
    expect(result.sanitizedText).not.toContain('ghp_123456789012345678901234567890123456');
    expect(result.sanitizedText).not.toContain('AIzaSyD-1234567890abcdef1234567890abc');
    expect(result.sanitizedText).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.sanitizedText).toContain('OPENAI_API_KEY=[REDACTED_SECRET]');
    expect(result.sanitizedText).toContain('GITHUB_TOKEN=[REDACTED_SECRET]');
  });

  it('redacts emails, credit card numbers, and phone numbers', () => {
    const receiptText = [
      'Customer: john.doe@example.com',
      'Phone: +1-800-555-0199',
      'Card: 4532 1234 5678 9010',
      'Amount: $45.00',
    ].join('\n');

    const result = redactSensitiveData(receiptText);

    expect(result.redactionCount).toBe(3);
    expect(result.redactedTypes).toEqual(
      expect.arrayContaining(['email', 'phone', 'credit_card'])
    );
    expect(result.sanitizedText).toContain('Customer: [REDACTED_EMAIL]');
    expect(result.sanitizedText).toContain('Phone: [REDACTED_PHONE]');
    expect(result.sanitizedText).toContain('Card: [REDACTED_CARD]');
    expect(result.sanitizedText).toContain('Amount: $45.00');
  });

  it('respects selective redaction toggle flags', () => {
    const mixed = 'Call 555-123-4567 or email admin@company.org with key sk-live-12345678901234567890';
    const result = redactSensitiveData(mixed, {
      redactEmails: true,
      redactPhones: false,
      redactSecrets: false,
    });

    expect(result.sanitizedText).toContain('555-123-4567'); // preserved
    expect(result.sanitizedText).toContain('sk-live-12345678901234567890'); // preserved
    expect(result.sanitizedText).toContain('[REDACTED_EMAIL]'); // scrubbed
  });

  it('determines routing recommendations based on confidence and word count thresholds', () => {
    // High confidence, rich text -> use local markdown
    expect(determineRoutingRecommendation(92, 25)).toBe('use_local_markdown');
    expect(determineRoutingRecommendation(55, 5)).toBe('use_local_markdown');

    // Low confidence -> fallback to vision LLM
    expect(determineRoutingRecommendation(48, 25)).toBe('fallback_to_vision_llm');

    // Sparse word count (< 5 words) -> fallback to vision LLM
    expect(determineRoutingRecommendation(95, 3)).toBe('fallback_to_vision_llm');
    expect(determineRoutingRecommendation(30, 1)).toBe('fallback_to_vision_llm');
  });

  it('gracefully no-ops image preprocessing in non-DOM (Node.js) runtime', async () => {
    const rawString = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = await preprocessImage(rawString);
    expect(result).toBe(rawString);
  });
});
