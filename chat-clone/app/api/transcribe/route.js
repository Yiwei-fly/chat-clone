import OpenAI from "openai";
export const runtime = "nodejs";

export async function POST(req) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file) return Response.json({ error: "No file" }, { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const result = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-transcribe",
  });

  return Response.json({ text: result.text });
}
