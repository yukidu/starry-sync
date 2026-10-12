# StarsVideoSync／繁星同步

正式網域：`https://sync.starry.phd`

一個「選一次影片、發布多平台」的 Cloudflare 網頁工具。

## 目前架構

- 長影音：YouTube、Gan Jing World、Odysee。
- 短影音：YouTube Shorts 已可正式發布；Facebook Reels、Instagram Reels、Threads 正在進行官方 Meta API 串接；其他平台依官方 Developer API／審核逐步啟用。
- YouTube：官方 OAuth + resumable upload，影片檔從瀏覽器直接傳到 Google，不經 Cloudflare Worker。
- Gan Jing World：官方 OAuth + TUS resumable upload，影片檔從瀏覽器直接傳到官方 VOD CDN，不經 Cloudflare Worker。
- Odysee：使用官方 YouTube Sync，不讓 StarsVideoSync 重複搬第三份影片。
- Facebook Reels：採官方 Graph API，上傳影片本體由瀏覽器直接傳到 Meta 上傳端點。
- Instagram Reels／Threads：採官方 API；需要平台可公開抓取的 HTTPS 影片網址時，不讓影片經過 Worker 本體。
- Cloudflare Worker 只處理 OAuth、短小 metadata、token 更新、狀態查詢與必要的 API 控制流程。
- D1 只存授權 token（AES-GCM 加密）、管理員 session 與發佈紀錄；不存影片。

## 為什麼這樣最省 Cloudflare 流量

影片本體走：

```text
你的瀏覽器 ──────────────▶ YouTube
       ├──────────────▶ Gan Jing World
       └──────────────▶ Facebook / 其他支援直傳的平台
YouTube ──官方 Sync──▶ Odysee
```

不是：

```text
你的瀏覽器 ▶ Cloudflare Worker ▶ 多個影片平台
```

因此 Worker 不承擔 GB 級影片流量，也避開 Worker request body 的大型檔案限制。

## OAuth 回呼網址

### Google / YouTube

`https://sync.starry.phd/api/auth/youtube/callback`

### Gan Jing World

`https://sync.starry.phd/api/auth/gjw/callback`

### Facebook / Instagram

`https://sync.starry.phd/api/auth/meta/callback`

### Threads

- OAuth：`https://sync.starry.phd/api/auth/threads/callback`
- Uninstall：`https://sync.starry.phd/api/threads/uninstall-callback`
- Data deletion：`https://sync.starry.phd/api/threads/delete-callback`

## GitHub Actions Secrets

正式部署流程會把已設定的 GitHub Actions Secrets 同步到 Cloudflare Worker Secrets：

```text
ADMIN_EMAIL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GJW_CLIENT_ID
GJW_CLIENT_SECRET
META_APP_ID
META_APP_SECRET
THREADS_APP_ID
THREADS_APP_SECRET
TOKEN_ENCRYPTION_KEY
```

`TOKEN_ENCRYPTION_KEY` 已存在時部署流程會保留原值，不會輪替。

## Cloudflare D1

```bash
npx wrangler d1 create starsvideosync_db
npx wrangler d1 execute starsvideosync_db --remote --file=./schema.sql
```

## 本機與部署

```bash
npm install
npm run dev
npm run deploy
```

## 尚待平台帳號／審核完成後驗證的地方

- Meta App 的 Facebook / Instagram 權限與粉絲專頁、Instagram 專業帳號實際連線。
- Threads 的 `threads_basic`、`threads_content_publish` 實際 OAuth 授權與發布測試。
- Instagram Reels／Threads 對可公開抓取影片 URL 的正式暫存上傳流程。
- Gan Jing World Playlist API 尚待官方提供正式文件／授權。
- Odysee 需先在 Odysee 帳號端啟用 YouTube Sync；本專案不保存 Odysee 密碼。
