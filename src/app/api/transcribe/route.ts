import { NextResponse } from "next/server";
import { transcribeWithGoogle } from "@/lib/googleSpeech";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await transcribeWithGoogle(buffer, file.type || "audio/webm", file.name || "audio.webm");

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("/api/transcribe error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
