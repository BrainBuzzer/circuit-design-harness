const DEFAULT_MAX_CHARS = 280;

const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`([^`]+)`/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const MARKDOWN_HEADING = /^#{1,6}\s+/gm;
const MARKDOWN_BULLET = /^[\s]*[-*+]\s+/gm;
const MARKDOWN_TABLE_ROW = /^\s*\|.*\|\s*$/gm;
const MARKDOWN_TABLE_SEP = /^\s*\|?[\s:-]+\|[\s|:-]*$/gm;

/** Dense electrical values often recited from BOMs / design dumps. */
const COMPONENT_VALUE =
  /\b\d+(?:\.\d+)?\s*(?:k|m|u|µ|n|p)?\s*(?:ohms?|Ω|Ω|F|H|V|A|W|k?Hz|MHz)(?=\W|$)/gi;
const PAREN_VALUE = /\(\s*\d+(?:\.\d+)?\s*(?:k|m|u|µ|n|p)?\s*(?:ohms?|Ω|Ω|F|H|V|A|W)?\s*\)/gi;
const RESISTOR_CODE = /\b\d+(?:\.\d+)?\s*[kKmMrR](?:\d*)?\b/g;
const LONG_PIN_LIST =
  /\b(?:pins?|terminals?|nets?)\s*[:#]?\s*(?:[A-Za-z0-9_./+-]+\s*[,;]\s*){3,}[A-Za-z0-9_./+-]+/gi;
const UUID_LIKE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const MULTI_WHITESPACE = /\s+/g;

/**
 * Shipped speak-pipeline entry: maps an on-screen assistant message to the
 * text that will be sent to local TTS. Full chat content must remain unchanged
 * in the UI; only this return value is spoken.
 */
export function prepareSpokenReply(assistantMessageContent: string): string {
  return summarizeForSpeech(assistantMessageContent);
}

/**
 * Build a short spoken-reply summary from a full assistant message.
 * Keeps the high-level outcome; strips dense electrical values, long pin/net
 * dumps, code fences, and markdown chrome so TTS does not recite BOM detail.
 */
export function summarizeForSpeech(
  fullText: string,
  options: { readonly maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const raw = fullText.trim();
  if (!raw) {
    return "";
  }

  const text = raw
    .replace(CODE_FENCE, " ")
    .replace(INLINE_CODE, "$1")
    .replace(MARKDOWN_LINK, "$1")
    .replace(MARKDOWN_HEADING, "")
    .replace(MARKDOWN_TABLE_SEP, " ")
    .replace(MARKDOWN_TABLE_ROW, " ")
    .replace(MARKDOWN_BULLET, "")
    .replace(PAREN_VALUE, " ")
    .replace(COMPONENT_VALUE, " ")
    .replace(RESISTOR_CODE, " ")
    .replace(LONG_PIN_LIST, " related pins ")
    .replace(UUID_LIKE, " ")
    .replace(MULTI_WHITESPACE, " ")
    .trim();

  if (!text) {
    return "Done.";
  }

  const sentences = splitSentences(text);
  const kept: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    const cleaned = stripDenseResidue(sentence);
    if (!cleaned || isMostlyTechnicalNoise(cleaned)) {
      continue;
    }
    const isGist =
      /\b(?:proposed|propose|ready|approve|approved|done|complete|summary|next|waiting)\b/i.test(
        cleaned,
      ) || kept.length === 0;
    if (kept.length > 0 && !isGist && cleaned.length > 120) {
      continue;
    }
    const nextLength = length + cleaned.length + (kept.length > 0 ? 1 : 0);
    if (kept.length > 0 && nextLength > maxChars) {
      break;
    }
    kept.push(cleaned);
    length = nextLength;
    if (length >= Math.min(maxChars, 160) && kept.length >= 1) {
      // Prefer one or two gist sentences over reciting the whole reply.
      if (kept.length >= 2 || length >= maxChars * 0.55) {
        break;
      }
    }
  }

  let summary = kept.join(" ").trim();
  if (!summary) {
    summary = stripDenseResidue(text.slice(0, maxChars));
  }
  if (summary.length > maxChars) {
    summary = `${summary.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  return summary || "Done.";
}

function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

function stripDenseResidue(sentence: string): string {
  return sentence
    .replace(PAREN_VALUE, " ")
    .replace(COMPONENT_VALUE, " ")
    .replace(RESISTOR_CODE, " ")
    .replace(MULTI_WHITESPACE, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, " ")
    .replace(MULTI_WHITESPACE, " ")
    .trim();
}

function isMostlyTechnicalNoise(sentence: string): boolean {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const technical = words.filter(
    (word) =>
      /^(?:R|C|L|D|Q|U|J|LED|GND|VCC|VDD|3V3|5V)\d*$/i.test(word) ||
      /^(?:pin|net|hole|ohm|µF|uF|nF|pF|kΩ|Ω)$/i.test(word) ||
      /^\d+$/.test(word),
  );
  return technical.length / words.length > 0.6;
}
