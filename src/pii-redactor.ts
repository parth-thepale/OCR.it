import { PIIOptions } from './types';

export interface RedactionResult {
  sanitizedText: string;
  redactionCount: number;
  redactedTypes: string[];
}

/**
 * Client-side zero-egress PII and secret scrubber.
 * Redacts emails, phone numbers, credit card numbers, and API keys before LLM prompt injection.
 */
export function redactSensitiveData(
  text: string,
  options?: PIIOptions
): RedactionResult {
  if (!text) {
    return { sanitizedText: '', redactionCount: 0, redactedTypes: [] };
  }

  const redactEmails = options?.redactEmails !== false;
  const redactPhones = options?.redactPhones !== false;
  const redactCards = options?.redactCards !== false;
  const redactSecrets = options?.redactSecrets !== false;

  let sanitizedText = text;
  let redactionCount = 0;
  const redactedTypesSet = new Set<string>();

  // 1. API Keys & Cloud Secrets
  if (redactSecrets) {
    const secretPatterns = [
      // OpenAI API Keys (including project keys)
      /\bsk-(?:proj-|live-|test-)?[a-zA-Z0-9_\-]{20,}\b/g,
      // GitHub Tokens (ghp, gho, ghu, ghs, ghr, github_pat)
      /\bgh[pousr]_[a-zA-Z0-9]{36,}\b/g,
      /\bgithub_pat_[a-zA-Z0-9_]{30,}\b/g,
      // Google API Key
      /\bAIza[0-9A-Za-z\-_]{30,}\b/g,
      // AWS Access Key ID
      /\bAKIA[0-9A-Z]{16}\b/g,
      // Bearer Authorization Tokens
      /\bBearer\s+[a-zA-Z0-9_\-\.=]{16,}\b/g,
    ];

    for (const pattern of secretPatterns) {
      sanitizedText = sanitizedText.replace(pattern, () => {
        redactionCount++;
        redactedTypesSet.add('secret');
        return '[REDACTED_SECRET]';
      });
    }
  }

  // 2. Email Addresses
  if (redactEmails) {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    sanitizedText = sanitizedText.replace(emailPattern, () => {
      redactionCount++;
      redactedTypesSet.add('email');
      return '[REDACTED_EMAIL]';
    });
  }

  // 3. Credit Card Numbers (13-19 digits, with spaces or hyphens)
  if (redactCards) {
    const cardPattern = /\b(?:\d{4}[ -]?){3}\d{4}\b|\b\d{4}[ -]?\d{6}[ -]?\d{5}\b/g;
    sanitizedText = sanitizedText.replace(cardPattern, () => {
      redactionCount++;
      redactedTypesSet.add('credit_card');
      return '[REDACTED_CARD]';
    });
  }

  // 4. Phone Numbers (US & International common formats)
  if (redactPhones) {
    const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
    sanitizedText = sanitizedText.replace(phonePattern, () => {
      redactionCount++;
      redactedTypesSet.add('phone');
      return '[REDACTED_PHONE]';
    });
  }

  return {
    sanitizedText,
    redactionCount,
    redactedTypes: Array.from(redactedTypesSet),
  };
}
