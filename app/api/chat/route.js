// app/api/chat/route.js
import OpenAI from "openai";
export const runtime = "nodejs";

/** 从非流式 Responses 返回中提取纯文本 */
function extractText(resp) {
  if (typeof resp?.output_text === "string") return resp.output_text;
  try {
    const parts = [];
    const out = Array.isArray(resp?.output) ? resp.output : [];
    for (const item of out) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const c of content) {
        if (c?.type === "output_text" && typeof c?.text === "string") {
          parts.push(c.text);
        }
      }
    }
    return parts.join("");
  } catch {
    return "";
  }
}

/** 错误判定：流式不可用/需验证才能流式 */
function isStreamNotAllowed(errMsg) {
  if (!errMsg) return false;
  const m = String(errMsg).toLowerCase();
  return (
    m.includes("must be verified to stream") ||
    m.includes("streaming is not") ||
    m.includes("does not support stream") ||
    m.includes("stream is not supported") ||
    m.includes("unsupported_value") && m.includes("stream")
  );
}

/** 错误判定：reasoning 参数不支持 */
function isReasoningUnsupported(errMsg) {
  if (!errMsg) return false;
  const m = String(errMsg).toLowerCase();
  return m.includes("unknown parameter") && m.includes("reasoning");
}

/** 错误判定：temperature 参数不支持 */
function isTemperatureUnsupported(errMsg) {
  if (!errMsg) return false;
  const m = String(errMsg).toLowerCase();
  return m.includes("unsupported parameter") && m.includes("temperature");
}

export async function POST(req) {
  try {
    const {
      messages = [],
      model = "gpt-4o",
      system = "",
      images = [],               // base64 数组（与最后一条 user 合并发送）
      temperature = 0.7,         // 某些模型不支持；会智能剥离
      maxTokens = 1200,
      lastResponseId = null,
      reasoningEffort = null,    // "medium" | "high" | null
    } = await req.json();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ---------- 构造 Responses input ----------
    const input = [];

    if (system && system.trim()) {
      input.push({ role: "system", content: [{ type: "input_text", text: system.trim() }] });
    }

    const last = messages[messages.length - 1] || null;
    const history = messages.slice(0, -1);

    for (const m of history) {
      if (!m || !m.role) continue;
      const text = String(m.content ?? "");
      if (m.role === "user") {
        input.push({ role: "user", content: [{ type: "input_text", text }] });
      } else if (m.role === "assistant") {
        input.push({ role: "assistant", content: [{ type: "output_text", text }] });
      } else if (m.role === "system") {
        input.push({ role: "system", content: [{ type: "input_text", text }] });
      }
    }

    if (last && last.role === "user") {
      const parts = [];
      const lastText = String(last.content ?? "").trim();
      if (lastText) parts.push({ type: "input_text", text: lastText });
      for (const b64 of images) {
        parts.push({ type: "input_image", image_url: `data:image/*;base64,${b64}` });
      }
      input.push({ role: "user", content: parts.length ? parts : [{ type: "input_text", text: "" }] });
    } else if (last) {
      const t = String(last.content ?? "");
      input.push(
        last.role === "assistant"
          ? { role: "assistant", content: [{ type: "output_text", text: t }] }
          : { role: "system", content: [{ type: "input_text", text: t }] }
      );
    }

    // ---------- 生成可变 options，便于逐步降级 ----------
    const buildOptions = ({
      withStream = true,
      withTemp = true,
      withReasoning = true,
    } = {}) => {
      const opts = {
        model,
        input,
        max_output_tokens: maxTokens,
        ...(withStream ? { stream: true } : {}),
        ...(lastResponseId ? { previous_response_id: lastResponseId } : {}),
      };
      if (withTemp) opts.temperature = temperature;
      if (withReasoning && reasoningEffort) opts.reasoning = { effort: reasoningEffort };
      return opts;
    };

    // 首选：流式 + temperature + reasoning
    let options = buildOptions({ withStream: true, withTemp: true, withReasoning: true });

    // ---------- 先试流式；不行就降级 ----------
    let stream;
    let useStream = true;

    try {
      stream = await openai.responses.create(options);
    } catch (err) {
      const msg = err?.message || "";

      // 情况 1：流式不可用/需验证 -> 改用非流式
      if (isStreamNotAllowed(msg)) {
        useStream = false;

        // 非流式 + 保留 reasoning + temperature
        try {
          const resp = await openai.responses.create(buildOptions({ withStream: false, withTemp: true, withReasoning: true }));
          const text = extractText(resp);
          return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
        } catch (e2) {
          const m2 = e2?.message || "";
          if (isReasoningUnsupported(m2)) {
            // 非流式 + 去 reasoning
            const resp = await openai.responses.create(buildOptions({ withStream: false, withTemp: true, withReasoning: false }));
            const text = extractText(resp);
            return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
          }
          if (isTemperatureUnsupported(m2)) {
            // 非流式 + 去 temperature
            const resp = await openai.responses.create(buildOptions({ withStream: false, withTemp: false, withReasoning: true }));
            const text = extractText(resp);
            return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
          }
          // 其它错误
          throw e2;
        }
      }

      // 情况 2：流式允许，但 reasoning 不支持 -> 去 reasoning 继续流式
      if (isReasoningUnsupported(msg) && options.reasoning) {
        options = buildOptions({ withStream: true, withTemp: true, withReasoning: false });
        try {
          stream = await openai.responses.create(options);
        } catch (e2) {
          const m2 = e2?.message || "";
          if (isTemperatureUnsupported(m2)) {
            options = buildOptions({ withStream: true, withTemp: false, withReasoning: false });
            stream = await openai.responses.create(options);
          } else if (isStreamNotAllowed(m2)) {
            // 降级非流式
            const resp = await openai.responses.create(buildOptions({ withStream: false, withTemp: true, withReasoning: false }));
            const text = extractText(resp);
            return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
          } else {
            throw e2;
          }
        }
      }
      // 情况 3：流式允许，但 temperature 不支持 -> 去 temperature 继续流式
      else if (isTemperatureUnsupported(msg) && options.temperature !== undefined) {
        options = buildOptions({ withStream: true, withTemp: false, withReasoning: true });
        try {
          stream = await openai.responses.create(options);
        } catch (e2) {
          const m2 = e2?.message || "";
          if (isReasoningUnsupported(m2)) {
            options = buildOptions({ withStream: true, withTemp: false, withReasoning: false });
            try {
              stream = await openai.responses.create(options);
            } catch (e3) {
              if (isStreamNotAllowed(e3?.message || "")) {
                const resp = await openai.responses.create(buildOptions({ withStream: false, withTemp: false, withReasoning: false }));
                const text = extractText(resp);
                return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
              }
              throw e3;
            }
          } else if (isStreamNotAllowed(m2)) {
            const resp = await openai.responses.create(buildOptions({ withStream: false, withTemp: false, withReasoning: true }));
            const text = extractText(resp);
            return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
          } else {
            throw e2;
          }
        }
      } else {
        // 其它错误原样抛出
        throw err;
      }
    }

    // ---------- 流式输出 ----------
    if (useStream && stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              if (chunk?.type === "response.output_text.delta" && chunk.delta) {
                controller.enqueue(encoder.encode(chunk.delta));
              }
              if (chunk?.type === "response.error" && chunk.error?.message) {
                controller.enqueue(encoder.encode("\n[Error] " + chunk.error.message + "\n"));
              }
            }
          } catch (err) {
            console.error("Responses stream error:", err);
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

    // 兜底（理论上到不了）
    return new Response("No content", { status: 200 });
  } catch (err) {
    console.error("Route fatal error:", err);
    return new Response(typeof err?.message === "string" ? err.message : "Bad Request", {
      status: 400,
    });
  }
}