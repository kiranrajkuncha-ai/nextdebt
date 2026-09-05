// Server-side helper to transcribe audio using Google Cloud Speech-to-Text.
// Credentials should come from environment or ADC, not a checked-in secret file.

type TranscribeResult = {
  transcript?: string;
  confidence?: number;
  language?: string;
  alternatives?: Array<{ transcript: string; confidence?: number }>;
  error?: string;
};

function resolveGoogleCredentialConfig(): { credentials?: Record<string, any> } | null {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!raw || !raw.trim()) {
    return null;
  }

  const trimmed = raw.trim();

  try {
    const jsonValue = JSON.parse(trimmed);
    if (jsonValue && typeof jsonValue === "object" && (jsonValue.private_key || jsonValue.client_email)) {
      return { credentials: jsonValue as Record<string, any> };
    }
  } catch {
    // Not raw JSON; continue to Base64 support below.
  }

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    const jsonValue = JSON.parse(decoded);
    if (jsonValue && typeof jsonValue === "object" && (jsonValue.private_key || jsonValue.client_email)) {
      return { credentials: jsonValue as Record<string, any> };
    }
  } catch {
    // If the value is a filesystem path, it's still valid for the Google SDK to consume directly.
  }

  return null;
}

export async function transcribeWithGoogle(
  buffer: Buffer,
  mimeType = "audio/webm",
  fileName = "audio.webm",
): Promise<TranscribeResult> {
  const credentialsConfig = resolveGoogleCredentialConfig();
  const hasGoogleCredentials = !!(
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_PRIVATE_KEY || credentialsConfig
  );

  if (!hasGoogleCredentials) {
    return {
      transcript: "(mock) Transcription not available — missing Google credentials",
      confidence: 0,
      language: "und",
    };
  }

  try {
    const { SpeechClient } = await import("@google-cloud/speech");
    const client = new SpeechClient(credentialsConfig || undefined);

    const audio = { content: buffer.toString("base64") };
    const config: any = {
      encoding: mimeType.includes("wav") ? "LINEAR16" : "WEBM_OPUS",
      sampleRateHertz: 48000,
      enableAutomaticPunctuation: true,
      model: "default",
      languageCode: 'te-IN',
      alternativeLanguageCodes: ['en-US', 'te-IN', 'de-DE'], 

    };

    const [response] = await client.recognize({ audio, config } as any);
    const results = response.results || [];

    if (results.length === 0) {
      return { transcript: "", confidence: 0, language: "und" };
    }

    const top = results[0];
    const alt = top.alternatives && top.alternatives[0];

    return {
      transcript: alt?.transcript || "",
      confidence: alt?.confidence || 0,
      language: (top.languageCode as string) || "und",
      alternatives: (top.alternatives || []).map((a: any) => ({ transcript: a.transcript, confidence: a.confidence })),
    };
  } catch (err: any) {
    console.error("transcribeWithGoogle error:", err);
    return { error: String(err) };
  }
}
