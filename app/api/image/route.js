// app/api/image/route.js
// 使用 Stability AI SDXL 文生图，前端仍然调用 /api/image
// 需要环境变量：STABILITY_API_KEY
export const runtime = "nodejs";

const ENGINE_ID = "stable-diffusion-xl-1024-v1-0"; // SDXL
const API_URL = `https://api.stability.ai/v1/generation/${ENGINE_ID}/text-to-image`;

function parseSize(sizeStr = "1024x1024") {
  // 仅支持 512、768、1024 的方图（SDXL 常用，且是 64 的倍数）
  const map = { "512x512": [512, 512], "768x768": [768, 768], "1024x1024": [1024, 1024] };
  const pick = map[sizeStr] || map["1024x1024"];
  return { width: pick[0], height: pick[1] };
}

export async function POST(req) {
  try {
    const { prompt, size = "1024x1024" } = await req.json();
    if (!prompt || !prompt.trim()) {
      return new Response("Missing prompt", { status: 400 });
    }

    const key = process.env.STABILITY_API_KEY;
    if (!key) {
      return new Response("Missing STABILITY_API_KEY", { status: 500 });
    }

    const { width, height } = parseSize(size);

    const payload = {
      text_prompts: [{ text: prompt.trim() }],
      width,
      height,
      samples: 1,
      cfg_scale: 7,            // 提示词遵从度（越高越贴合）
      steps: 30,               // 采样步数（质量与速度平衡）
      // sampler: "K_DPM_2_ANCESTRAL", // 可选：不填用默认
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return new Response(
        `Stability API error (${res.status}): ${errText || res.statusText}`,
        { status: 502 }
      );
    }

    const data = await res.json();
    const b64 = data?.artifacts?.[0]?.base64;
    if (!b64) {
      return new Response("No image data from Stability", { status: 500 });
    }

    const buf = Buffer.from(b64, "base64");
    return new Response(buf, { headers: { "Content-Type": "image/png" } });
  } catch (err) {
    console.error("image route error:", err);
    return new Response(
      typeof err?.message === "string" ? err.message : "Image error",
      { status: 400 }
    );
  }
}