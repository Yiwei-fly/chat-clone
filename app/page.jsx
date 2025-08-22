"use client";
import { useEffect, useRef, useState } from "react";
import "./chat.css";

const MODEL_OPTIONS = [
  { value: "gpt-5",         label: "GPT-5（最强推理｜长上下文｜需权限）" },
  { value: "gpt-4.1",       label: "GPT-4.1（通用均衡｜高准确度）" },
  { value: "gpt-4o",        label: "GPT-4o（多模态最优｜图像/文件更强）" },
  { value: "gpt-4o-mini",   label: "GPT-4o Mini（多模态轻量｜便宜更快）" },
  { value: "gpt-4.1-nano",  label: "GPT-4.1-nano（极致低价｜批量/工具调用）" },
];

export default function Page() {
const [messages, setMessages] = useState([]);
const [system, setSystem] = useState("You are a helpful, concise assistant.");
const [model, setModel] = useState(MODEL_OPTIONS[0].value);
const [lastResponseId, setLastResponseId] = useState(null);
const [draft, setDraft] = useState("");
const [sending, setSending] = useState(false);
const [images, setImages] = useState([]); // base64
const [imgMode, setImgMode] = useState(false);
const [imgSize, setImgSize] = useState("1024x1024");

// ✅ 新增：深度思考
const [reasoning, setReasoning] = useState("off");
  const chatRef = useRef(null);
  useEffect(() => {
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight);
  }, [messages, sending]);

// ---------- Markdown Lite 扩展渲染（表格/代码块/标题/列表/引用/HR/内联样式） ----------
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 先把 ``` 代码块换成带 Copy 的 HTML，避免后续正则干扰
function codeBlocksToHTML(s) {
  return s.replace(/```([\s\S]*?)```/g, (_, code) => {
    const clean = code.replace(/^\n+|\n+$/g, "");
    return `
      <div class="block-wrap code-wrap" data-copy="${escapeHtml(clean)}">
        <button class="copy-btn" title="Copy">Copy</button>
        <pre class="code-block"><code>${escapeHtml(clean)}</code></pre>
      </div>
    `;
  });
}

// 解析表格块：匹配 header|sep|rows 的连续片段
function parseTables(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (
      /\|/.test(lines[i]) &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}.*\|.*$/.test(lines[i + 1])
    ) {
      const block = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      i--;
      out.push({ type: "table", raw: block.join("\n") });
    } else {
      out.push({ type: "line", raw: lines[i] });
    }
  }
  return out;
}

function tableToHTML(raw) {
  const rows = raw.split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return `<pre class="code-block"><code>${escapeHtml(raw)}</code></pre>`;

  const splitLine = (line) =>
    line
      .split("|")
      .map((s) => s.trim())
      .filter((c, idx, arr) => !(idx === 0 && c === "") && !(idx === arr.length - 1 && c === ""));

  const header = splitLine(rows[0]);
  const body = rows.slice(2).map(splitLine);

  // 复制用 TSV
  const tsv = [header.join("\t")].concat(body.map((r) => r.join("\t"))).join("\n");

  const thead = `<thead><tr>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;

  return `
    <div class="block-wrap table-wrap" data-copy="${escapeHtml(tsv)}">
      <button class="copy-btn" title="Copy">Copy</button>
      <table class="md-table">${thead}${tbody}</table>
    </div>
  `;
}

// 内联：链接、内联代码、加粗、斜体（顺序重要）
function renderInline(s) {
  let t = escapeHtml(s);

// 链接 [text](url) —— 只允许 http(s)
t = t.replace(
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
  (_, txt, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(txt)}</a>`
);

  // 内联代码 `code`
  t = t.replace(/`([^`]+?)`/g, (_, code) => `<code class="inline-code">${escapeHtml(code)}</code>`);

  // 加粗 **text** 或 __text__
  t = t.replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, (_, a, b) => `<strong>${escapeHtml(a || b)}</strong>`);

  // 斜体 *text* 或 _text_
  t = t.replace(/\*([^*]+?)\*|_([^_]+?)_/g, (_, a, b) => `<em>${escapeHtml(a || b)}</em>`);

  return t;
}

// 把非表格、非代码块的文本做块级解析：标题/HR/引用/列表/段落
function blocksToHTML(text) {
  const lines = text.split(/\r?\n/);
  const html = [];
  let i = 0;

  const flushPara = (buf) => {
    if (!buf.length) return;
    const para = buf.join("<br/>");
    html.push(`<p>${renderInline(para)}</p>`);
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (/^\s*$/.test(line)) {
      flushPara(html._para || (html._para = []));
      i++;
      continue;
    }

    // 水平线
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flushPara(html._para || (html._para = []));
      html.push("<hr/>");
      i++;
      continue;
    }

    // 标题 #..######
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(html._para || (html._para = []));
      const level = h[1].length;
      html.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 引用 > 多行
    if (/^\s*>\s?/.test(line)) {
      flushPara(html._para || (html._para = []));
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${blocksToHTML(buf.join("\n"))}</blockquote>`);
      continue;
    }

    // 无序列表 - * +
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara(html._para || (html._para = []));
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      html.push(`<ul>${items.map((t) => `<li>${renderInline(t)}</li>`).join("")}</ul>`);
      continue;
    }

    // 有序列表 1. 2. ...
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara(html._para || (html._para = []));
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      html.push(`<ol>${items.map((t) => `<li>${renderInline(t)}</li>`).join("")}</ol>`);
      continue;
    }

    // 段落
    (html._para || (html._para = [])).push(line);
    i++;
  }

  flushPara(html._para || (html._para = []));
  delete html._para;

  return html.join("\n");
}

function mdLiteToHtml(s) {
  // 1) 代码块
  let tmp = codeBlocksToHTML(s);
  // 2) 表格 + 其它块
  const parts = parseTables(tmp);
  let html = "";
  for (const p of parts) {
    if (p.type === "table") html += tableToHTML(p.raw);
    else html += blocksToHTML(p.raw);
  }
  return html.replace(/<p>\s*<\/p>/g, "");
}

  // 为复制按钮绑定事件
  useEffect(() => {
    const bodyEl = chatRef.current;
    if (!bodyEl) return;
    const onClick = (e) => {
      const btn = e.target.closest(".copy-btn");
      if (!btn) return;
      const wrap = btn.parentElement;
      const text = wrap?.getAttribute("data-copy") || "";
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Copy"), 1000);
      });
    };
    bodyEl.addEventListener("click", onClick);
    return () => bodyEl.removeEventListener("click", onClick);
  }, [messages]);

  // ---------------- 发送逻辑（与你当前版本一致） ----------------
  async function send() {
    if (!draft.trim() && images.length === 0) return;

    // 图片生成模式
    if (imgMode) {
      const prompt = draft.trim();
      if (!prompt) {
        alert("请先输入图片描述（提示词）");
        return;
      }
      const asking = [...messages, { role: "user", content: prompt }];
      setMessages(asking);
      setSending(true);
      try {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, size: imgSize }),
        });
        if (!res.ok) {
          const errText = await res.text();
          alert("生成图片失败：" + (errText || res.statusText));
          setSending(false);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const html = `<img src="${url}" alt="generated" style="max-width:100%;border-radius:12px" />`;
        setMessages([...asking, { role: "assistant", content: html }]);
        setDraft("");
      } catch (e) {
        console.error(e);
        alert("网络错误或服务器异常，请稍后重试。");
      } finally {
        setSending(false);
      }
      return;
    }

    // 普通聊天（带图问答）
    const newMsgs = [...messages, { role: "user", content: draft }];
    setMessages(newMsgs);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        eaders: { "Content-Type": "application/json" },
        body: JSON.stringify({
        messages: newMsgs,
        model,
        system,
        images,
        lastResponseId,
      reasoningEffort: reasoning === "off" ? null : reasoning, // ✅ 新增
  }),
});
      if (!res.ok) {
        const errText = await res.text();
        alert("请求失败：" + (errText || res.statusText));
        setSending(false);
        return;
      }
      setDraft("");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistant = "";
      let newRespId = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const idMatch = text.match(/__RESPONSE_ID__(.+?)__/);
        if (idMatch) {
          newRespId = idMatch[1];
          assistant += text.replace(/__RESPONSE_ID__(.+?)__/, "");
        } else {
          assistant += text;
        }
        setMessages([...newMsgs, { role: "assistant", content: assistant }]);
      }
      if (newRespId) setLastResponseId(newRespId);
      setImages([]);
    } catch (e) {
      console.error(e);
      alert("网络错误或服务器异常，请稍后重试。");
    } finally {
      setSending(false);
    }
  }

  function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const r = new FileReader();
        r.onload = () => {
          const base64 = String(r.result).split(",")[1];
          setImages((prev) => [...prev, base64]);
        };
        r.readAsDataURL(file);
      } else if (/text|json/.test(file.type)) {
        const r = new FileReader();
        r.onload = () => setDraft((d) => (d ? d + "\n\n" : "") + String(r.result));
        r.readAsText(file);
      } else {
        alert("暂不支持该文件类型，仅支持图片或文本类文件。");
      }
    });
    e.target.value = "";
  }

  // 录音 → 转写
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const [recState, setRecState] = useState("idle");
  async function startRec() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    mediaRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const fd = new FormData();
      fd.append("file", blob, "audio.webm");
      const r = await fetch("/api/transcribe", { method: "POST", body: fd });
      const { text } = await r.json();
      setDraft((d) => (d ? d + " " : "") + (text || ""));
    };
    mr.start();
    setRecState("recording");
  }
  function stopRec() {
    mediaRef.current?.stop();
    setRecState("idle");
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="logo"><img src="/logo.svg" alt="logo" /><span>ChatGPT</span></div>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="system-card">
        <div className="system-label">系统提示词（可选）</div>
        <textarea value={system} onChange={(e) => setSystem(e.target.value)} />
      </div>
{/* 高级选项：深度思考 */}
<div className="advanced-card">
  <div className="advanced-row">
    <label className="toggle">
      <input
        type="checkbox"
        checked={reasoning !== "off"}
        onChange={(e) => setReasoning(e.target.checked ? "medium" : "off")}
      />
      <span>🧠 深度思考（更准但更慢）</span>
    </label>

    {reasoning !== "off" && (
      <select
        className="size-select"
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        title="推理强度"
      >
        <option value="medium">中（准确+速度均衡）</option>
        <option value="high">高（更准确但更慢）</option>
      </select>
    )}
  </div>

  <div className="tips small">
    <div>• 建议在「复杂推理 / 规划 / 代码修复 / 多步分析」时开启。</div>
    <div>• 部分模型（或无权限）可能不支持 Reasoning，后端将自动降级为普通模式。</div>
  </div>
</div>
      <div className="chat-body" ref={chatRef}>
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="message-avatar">
              <img src={m.role === "user" ? "/user-avatar.svg" : "/ai-bot.svg"} alt="" className="avatar-img" width={28} height={28}/>
              <span className="avatar-label">{m.role === "user" ? "You" : "万能的Yiwei"}</span>
            </div>
            <div className="message-content">
              <div
                className="message-text"
                dangerouslySetInnerHTML={{ __html: mdLiteToHtml(m.content) }}
              />
            </div>
          </div>
        ))}

        {sending && (
          <div className="message assistant">
            <div className="message-avatar">
              <img src="/ai-bot.svg" alt="" className="avatar-img" width={28} height={28}/>
              <span className="avatar-label">万能的Yiwei</span>
            </div>
            <div className="message-content">
              <div className="message-text">...</div>
            </div>
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="preview">
          {images.map((b64, idx) => (
            <div key={idx} className="preview-item">
              <img src={`data:image/*;base64,${b64}`} alt={`upload-${idx}`} />
              <button
                className="preview-del"
                onClick={() => {
                  const next = [...images];
                  next.splice(idx, 1);
                  setImages(next);
                }}
                title="移除这张图片"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input">
        <form className="input-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="input-tools">
            <input type="file" id="file-upload" multiple onChange={onPickFiles} accept="image/*,.txt,.md,.json" style={{ display: "none" }} />
            <label htmlFor="file-upload" className="tool-button">📎</label>

            <button type="button" className="tool-button" onClick={recState === "idle" ? startRec : stopRec} title={recState === "idle" ? "开始录音" : "停止录音"}>
              {recState === "idle" ? "🎙️" : "⏹️"}
            </button>

            <div className="gen-image-toggle">
              <label className="toggle">
                <input type="checkbox" checked={imgMode} onChange={(e) => setImgMode(e.target.checked)} />
                <span>🖼️ 生成图片</span>
              </label>
              {imgMode && (
                <select value={imgSize} onChange={(e) => setImgSize(e.target.value)} className="size-select" title="图片尺寸">
                  <option value="512x512">512×512</option>
                  <option value="1024x1024">1024×1024</option>
                  <option value="2048x2048">2048×2048</option>
                </select>
              )}
            </div>
          </div>

          <textarea
            placeholder="Send a message..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button type="submit" disabled={sending}>Send</button>
        </form>

        <div className="footer-tip">本站仅在服务端调用 OpenAI API，保护密钥安全。</div>
      </div>
    </div>
  );
}