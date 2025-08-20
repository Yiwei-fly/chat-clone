// app/layout.jsx
import "./globals.css";

export const metadata = {
  title: "My Chat",
  description: "Simple chat with system prompt, multi-model, image/file upload, and voice.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
