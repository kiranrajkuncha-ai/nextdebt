// Server-side helper to transcribe audio using Google Cloud Speech-to-Text.
// Credentials should come from environment or ADC, not a checked-in secret file.

type TranscribeResult = {
  transcript?: string;
  confidence?: number;
  language?: string;
  alternatives?: Array<{ transcript: string; confidence?: number }>;
  error?: string;
};

export async function transcribeWithGoogle(
  buffer: Buffer,
  mimeType = "audio/webm",
  fileName = "audio.webm",
): Promise<TranscribeResult> {
  const hasGoogleCredentials = !!(
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_PRIVATE_KEY
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
    const client = new SpeechClient();

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
