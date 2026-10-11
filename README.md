# StarsVideoSync

一個「選一次影片、發布多平台」的 Cloudflare 網頁工具。

## v0.1 目標

- YouTube：官方 OAuth + resumable upload，影片檔從瀏覽器直接傳到 Google，不經 Cloudflare Worker。
- Gan Jing World：官方 OAuth + TUS resumable upload，影片檔從瀏覽器直接傳到官方 VOD CDN，不經 Cloudflare Worker。
- Odysee：使用官方 YouTube Sync，不讓 StarsVideoSync 重複搬第三份影片。
- Cloudflare Worker 只處理 OAuth、短小 metadata、token 更新與狀態查詢。
- D1 只存授權 token（AES-GCM 加密）、管理員 session 與發佈紀錄；不存影片。

## 為什麼這樣最省 Cloudflare 流量

影片本體走：

```
你的瀏覽器 ──────────────▶ YouTube
       └──────────────▶ Gan Jing World
YouTube ──官方 Sync──▶ Odysee
```

不是：

```
你的瀏覽器 ▶ Cloudflare Worker ▶ 三個影片平台
```

因此 Worker 不承擔 GB 級影片流量，也避開 Worker request body 的大型檔案限制。

## 第一次部署需要的帳號設定

### Google / YouTube

1. 建立 Google Cloud project。
2. 啟用 YouTube Data API v3。
3. 建立 OAuth 2.0 Web Application。
4. Authorized redirect URI：`https://你的網域/api/auth/youtube/callback`
5. Cloudflare secrets：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。

請求 scope：
- `openid email profile`
- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.readonly`

### Gan Jing World

1. 在 GJW Developer Platform 建立 App。
2. Callback：`https://你的網域/api/auth/gjw/callback`
3. 啟用影片 / media 所需 scopes。
4. Cloudflare secrets：`GJW_CLIENT_ID`、`GJW_CLIENT_SECRET`（若該 App 類型有 secret）。

### StarsVideoSync 管理員

設定 `ADMIN_EMAIL` 為唯一允許操作的 Google Email。

建立 32-byte AES key 並設為 `TOKEN_ENCRYPTION_KEY`：

```bash
openssl rand -base64 32
```

## Cloudflare D1

```bash
npx wrangler d1 create starsvideosync_db
```

把回傳的 `database_id` 填到 `wrangler.toml`，然後：

```bash
npx wrangler d1 execute starsvideosync_db --remote --file=./schema.sql
```

## Secrets

```bash
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GJW_CLIENT_ID
npx wrangler secret put GJW_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

## 本機與部署

```bash
npm install
npm run dev
npm run deploy
```

## 尚待正式平台帳號完成後驗證的地方

- GJW App 實際核發的 scopes 與 `/v1/oauth2/me` 真實欄位名稱。
- GJW content create 回傳 content id 的實際欄位（程式目前兼容數個常見位置）。
- Google OAuth 應用程式仍在 Testing 時，需把管理員 Google 帳號加入 test users。
- Odysee 需先在 Odysee 帳號端啟用 YouTube Sync；本專案不保存 Odysee 密碼。
