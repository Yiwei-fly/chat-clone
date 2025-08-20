import OpenAI from "openai";
export const runtime = "nodejs";

export async function POST(req) {
  const { messages = [], model = "gpt-4.1", system = "", images = [] } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const chatMessages = [];
  if (system && system.trim()) {
    chatMessages.push({ role: "system", content: system.trim() });
  }
  for (const m of messages) {
    if (m.role !== "user") {
      chatMessages.push({ role: m.role, content: m.content });
    }
  }
  const lastUser = messages.filter((m) => m.role === "user").slice(-1)[0];
  const contentArray = [];
  if (lastUser?.content) contentArray.push({ type: "text", text: lastUser.content });
  for (const b64 of images) {
    contentArray.push({
      type: "image_url",
      image_url: { url: `data:image/*;base64,${b64}` },
    });
  }
  chatMessages.push({ role: "user", content: contentArray.length ? contentArray : lastUser?.content || "" });

  const stream = await openai.chat.completions.create({
    model,
    messages: chatMessages,
    stream: true,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk?.choices?.[0]?.delta?.content || "";
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
