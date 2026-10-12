# Gan Jing World Playlist API access request

StarsVideoSync already integrates Gan Jing World's documented OAuth2, content creation and video upload flow. We need an official Playlist API contract for a creator-owned channel.

## Required operations

1. List playlists owned by the authorized channel.
2. Create a playlist.
3. Read one playlist and its items.
4. Add an existing video/content item to a playlist.
5. Remove an item from a playlist.
6. Update playlist title, description, visibility, and item order if supported.

## Information requested from Gan Jing World

- Official production endpoint paths and HTTP methods.
- Any sandbox or test endpoints.
- Required OAuth scopes / permissions.
- Request and response schemas.
- Playlist and playlist-item ID semantics.
- Supported visibility values.
- Pagination rules for listing playlists/items.
- Rate limits and quota behavior.
- Whether Draft developer apps may use the Playlist API or whether explicit approval/beta allowlisting is required.
- Whether an uploaded video can be attached to a playlist in the same workflow immediately after transcoding, and which ID must be used (content_id vs video_id).

## Support request text (Traditional Chinese)

主旨：申請 Gan Jing World Playlist API／測試端點／開發者權限

您好，我們目前已使用 Gan Jing World Developer Platform 的官方 OAuth2、影片建立與 TUS 上傳 API，開發一套自用的多平台影片發布工具 StarsVideoSync。現在希望加入乾淨世界播放清單功能，需求包含：讀取目前登入頻道的播放清單、建立新播放清單、讀取清單內容、將已上傳影片加入指定播放清單，以及未來可支援修改與排序。

目前公開 Developer Platform 文件中沒有找到 Playlist API 的 endpoint、scope 或測試端點。想請貴團隊提供：
1. 官方 Playlist API 文件與 endpoint；
2. 可使用的 sandbox／test endpoint；
3. 所需 OAuth scope 或 beta/developer allowlist 權限；
4. 建立／列出／更新播放清單與加入影片的 request/response schema；
5. 加入影片時應使用 content_id 或 video_id；
6. rate limit / quota 規則。

我們只會使用貴平台正式提供或明確授權的 API，不會使用未公開的網站內部介面。若此功能目前僅提供 beta/private access，也請協助將我們現有的 Developer App 加入測試權限，或告知申請方式。

謝謝。

## Support request text (English)

Subject: Request for Gan Jing World Playlist API documentation, test endpoint, and developer access

Hello Gan Jing World Developer Support,

We currently integrate the documented Gan Jing World OAuth2, content creation, and TUS video upload APIs in a private multi-platform publishing tool named StarsVideoSync. We would like to add official playlist support for the authenticated creator channel.

We need to list existing playlists, create a new playlist, read playlist items, add an uploaded video/content item to a selected playlist, and eventually support playlist updates and ordering.

We could not find public Playlist API endpoints, OAuth scopes, or sandbox/test endpoints in the current Developer Platform documentation. Could you please provide:

1. Official Playlist API documentation and production endpoints;
2. Any sandbox/test endpoints;
3. Required OAuth scopes, beta access, or developer allowlisting;
4. Request/response schemas for list/create/update playlist and add/remove playlist items;
5. Whether playlist insertion should use content_id or video_id after video upload/transcoding;
6. Rate-limit/quota details;
7. Whether a Draft developer app can access this API or explicit approval is required.

We will only use officially documented or explicitly authorized endpoints and will not call undocumented website-internal APIs. If Playlist API access is private/beta, please let us know how to have our existing Developer App enabled for testing.

Thank you.
