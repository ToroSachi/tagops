const REDACTED = "[REDACTED]";

const SENSITIVE_JSON_FIELD_PATTERN =
  /"((?:access|refresh|id)_token|client_secret|private_key|authorization|token)"\s*:\s*"([^"]*)"/gi;
const SENSITIVE_KEY_VALUE_PATTERN =
  /\b((?:access|refresh|id)_token|client_secret|private_key|authorization|token)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;

export function redactSensitiveText(text: string): string {
  return text
    .replace(SENSITIVE_JSON_FIELD_PATTERN, (_, key: string) => `"${key}":"${REDACTED}"`)
    .replace(SENSITIVE_KEY_VALUE_PATTERN, (_, key: string) => `${key}=${REDACTED}`)
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED}`);
}

function stringifyUnknownError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function getSafeErrorMessage(error: unknown, fallback = "Unknown error"): string {
  const raw = stringifyUnknownError(error).trim();
  if (raw.length === 0) return fallback;

  const redacted = redactSensitiveText(raw);
  return redacted.length > 600 ? `${redacted.slice(0, 600)}...` : redacted;
}
