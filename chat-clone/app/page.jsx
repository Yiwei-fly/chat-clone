"use client";
import { useEffect, useRef, useState } from "react";

const MODEL_OPTIONS = [
  { value: "gpt-4.1", label: "gpt-4.1（通用强）" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini（便宜快）" },
  { value: "gpt-4o", label: "gpt-4o（多模态）" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini（多模态轻量）" },
];

export default function Page() {
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

  return (
    <div className="container">
      <div className="header">
        <div className="logo"><img src="/logo.svg" alt="logo"/><b>My Chat</b></div>
        <span className="badge">{model}</span>
      </div>

      <div className="card">
        <div className="row" style={{gap:12}}>
          <label>模型：</label>
          <select value={model} onChange={(e)=>setModel(e.target.value)}>
            {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={recState==="idle"?startRec:stopRec}>
            {recState === "idle" ? "🎙️ 开始录音" : "⏹️ 停止录音"}
          </button>
          <input type="file" multiple onChange={onPickFiles} accept="image/*,.txt,.md,.json"/>
        </div>
        <hr/>
        <div>
          <div className="small">系统提示词（可选，用于设定 AI 人格/风格）</div>
          <textarea value={system} onChange={(e)=>setSystem(e.target.value)} />
        </div>
      </div>

      <div className="card chat" ref={chatRef}>
        {messages.map((m,i)=> (
          <div key={i} className={`msg ${m.role === 'user' ? 'user':'ai'}`}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <b>{m.role === 'user' ? 'You' : 'AI'}</b>
              {m.role === 'assistant' && (
                <button onClick={()=>speak(m.content)} title="朗读">🔊 朗读</button>
              )}
            </div>
            <div>{m.content}</div>
          </div>
        ))}
        {sending && <div className="msg ai">…</div>}
      </div>

      {images.length>0 && (
        <div className="card">
          <div className="small">已选择的图片：</div>
          <div className="preview">
            {images.map((b64,idx)=> <img key={idx} src={`data:image/*;base64,${b64}`} alt="preview"/>) }
          </div>
        </div>
      )}

      <div className="card footer">
        <input type="text" placeholder="输入消息…" value={draft} onChange={(e)=>setDraft(e.target.value)} style={{flex:1}} onKeyDown={(e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } }}/>
        <button disabled={sending} onClick={send}>发送</button>
      </div>

      <div className="small">温馨提示：为保护密钥安全，本网站只在服务器端调用 OpenAI API。</div>
    </div>
  );
}
