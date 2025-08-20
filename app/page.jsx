"use client";
import { useEffect, useRef, useState } from "react";
import "./chat.css";

const MODEL_OPTIONS = [
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4.1-mini", label: "GPT-4.1-Mini" },
  { value: "gpt-4o", label: "GPT-4 Vision" },
  { value: "gpt-4o-mini", label: "GPT-4 Vision Mini" },
];


export default function Page() {
  // ...existing logic...
  const [messages, setMessages] = useState([]);
  const [system, setSystem] = useState("You are a helpful, concise assistant.");
  const [model, setModel] = useState(MODEL_OPTIONS[0].value);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [images, setImages] = useState([]);
  const chatRef = useRef(null);
  useEffect(() => {
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight);
  }, [messages, sending]);
  async function send() {
    if (!draft.trim() && images.length === 0) return;
    const newMsgs = [...messages, { role: "user", content: draft }];
    setMessages(newMsgs);
    setDraft("");
    setSending(true);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: newMsgs, model, system, images }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let assistant = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      assistant += decoder.decode(value, { stream: true });
      setMessages([...newMsgs, { role: "assistant", content: assistant }]);
    }
    setImages([]);
    setSending(false);
  }
  function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const r = new FileReader();
        r.onload = () => {
          const base64 = r.result.split(",")[1];
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
  // ...existing voice/recorder logic...
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
  async function speak(text) {
    const r = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "alloy", format: "mp3" }),
    });
    const buf = await r.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
    const audio = new Audio(url);
    audio.play();
  }

  // ChatGPT 风格布局
  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="logo">
          <img src="/logo.svg" alt="logo"/>
          <span>ChatGPT</span>
        </div>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="chat-body" ref={chatRef}>
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="message-avatar">
              {m.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              <div className="message-header">
                {m.role === 'user' ? 'You' : 'Assistant'}
                {m.role === 'assistant' && (
                  <button onClick={() => speak(m.content)} className="tool-button">🔊</button>
                )}
              </div>
              <div>{m.content}</div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="message-header">Assistant</div>
              <div>...</div>
            </div>
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="images-preview">
          {images.map((b64, idx) => (
            <img key={idx} src={`data:image/*;base64,${b64}`} alt="preview" />
          ))}
        </div>
      )}

      <div className="chat-input">
        <form className="input-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="input-tools">
            <input
              type="file"
              id="file-upload"
              multiple
              onChange={onPickFiles}
              accept="image/*,.txt,.md,.json"
              style={{ display: 'none' }}
            />
            <label htmlFor="file-upload" className="tool-button">📎</label>
            <button
              type="button"
              className="tool-button"
              onClick={recState === "idle" ? startRec : stopRec}
            >
              {recState === "idle" ? "🎙️" : "⏹️"}
            </button>
          </div>
          <textarea
            placeholder="Send a message..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" disabled={sending}>Send</button>
        </form>
        <div className="footer-tip">
          本站仅在服务端调用 OpenAI API，保护密钥安全。
        </div>
      </div>
    </div>
  );
}
