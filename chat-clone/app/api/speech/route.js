import OpenAI from "openai";
export const runtime = "nodejs";

export async function POST(req) {
  const { text, voice = "alloy", format = "mp3" } = await req.json();
  if (!text) return new Response("Missing text", { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const audio = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: text,
    format,
  });

  const buf = Buffer.from(await audio.arrayBuffer());
  return new Response(buf, {
    headers: { "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg" },
  });
}
