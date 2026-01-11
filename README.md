# Image Loop Player

ローカル主体の画像ループ再生PWA。Vite + React + Tailwind。  
画像はブラウザ内でのみ扱い、外部送信なし。IndexedDBでセッション保存（画像dataURL+設定）。

## 開発

```bash
npm install
npm run dev
```

## ビルド / プレビュー

```bash
npm run build
npm run preview
```

## デプロイ（Vercel）

1. GitHubにプッシュ（本リポジトリ構成をそのまま）。
2. Vercelで「Import Project」→ GitHubリポジトリを選択。
3. Framework: Vite（自動認識）。  
   - Build Command: `npm run build`  
   - Output Directory: `dist`
4. mainブランチをProductionに紐付ければ、pushで自動デプロイ。

### PWAについて
- `public/manifest.webmanifest` と `public/sw.js` をルート配信。`/src/main.tsx` で `/sw.js` を登録。
- Vercelの静的配信でそのまま動作。アイコンを差し替える場合は `public/icon-192.png` / `public/icon-512.png` を入れ替えてください。

### 注意
- サーバーサイドなし、環境変数なし。  
- 画像はユーザーのローカルアップロード前提（永続保存しない）。  
- IndexedDBに保存されるため大容量画像を多数入れるとブラウザ容量を消費します。
