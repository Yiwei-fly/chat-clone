# Chat Clone (Next.js)

- 文本对话（流式）
- 系统提示词
- 多模型下拉
- 图片/文本文件上传（图片走多模态，文本并入提示）
- 语音对讲（录音→转写→发送；AI 回复可朗读）

### 本地运行
1. `npm i`
2. 复制 `.env.example` 为 `.env` 并填入 `OPENAI_API_KEY`
3. `npm run dev` 然后打开 http://localhost:3000

### 部署（Vercel）
1. 推到 GitHub 仓库
2. Vercel 导入项目并在 **Environment Variables** 添加 `OPENAI_API_KEY`
3. 一键部署
