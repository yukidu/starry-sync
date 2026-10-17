import React, { useEffect } from 'react';

type LegalKind = 'privacy'|'terms'|'data-deletion';

type Props = { kind: LegalKind };

const updated = '2026-10-13';

export default function LegalPage({ kind }: Props) {
  useEffect(() => {
    const titles: Record<LegalKind,string> = {
      privacy: '隱私權政策',
      terms: '服務條款',
      'data-deletion': '用戶資料刪除說明',
    };
    document.title = `繁星同步｜${titles[kind]}`;
  }, [kind]);

  return <main className="legal-page">
    <div className="legal-wrap">
      <a className="legal-brand" href="/"><img src="/stars-sync.svg" alt=""/><span><b>繁星同步</b><small>StarsVideoSync</small></span></a>
      {kind === 'privacy' && <article>
        <h1>隱私權政策</h1>
        <p className="legal-meta">最後更新：{updated}</p>
        <p>繁星同步（StarsVideoSync）是一個協助授權使用者將影音內容發布到第三方影音與社群平台的工具。本政策說明本服務在使用 Google / YouTube、Gan Jing World、Meta / Facebook、Instagram、Threads 等平台授權時，如何處理必要資料。</p>
        <h2>我們處理的資料</h2>
        <p>在你主動連接平台帳號後，本服務可能接收帳號識別資訊、頻道或粉絲專頁名稱與 ID、OAuth 存取權杖、授權範圍，以及執行發布所需的內容設定。只有完成你要求的登入、讀取帳號資訊、建立或發布影音內容等功能時才會使用這些資料。</p>
        <h2>影音檔案</h2>
        <p>可直接上傳的平台會盡量採用瀏覽器直接傳送到該平台的方式，避免大型影片內容經過繁星同步的 Cloudflare Worker。若某平台的官方 API 要求平台從公開網址抓取影片，系統可能在發布流程中建立短期暫存來源，並於流程完成後依設計移除。</p>
        <h2>權杖與安全</h2>
        <p>平台 OAuth 存取權杖以加密方式保存，用於你已授權的功能。繁星同步不會要求你把第三方平台密碼交給本服務，也不會販售個人資料。</p>
        <h2>第三方服務</h2>
        <p>實際發布內容時仍受各第三方平台的條款、隱私政策與 API 規範約束。第三方平台對已發布內容與其平台上的資料處理，依其各自政策辦理。</p>
        <h2>資料刪除與撤銷</h2>
        <p>你可以在第三方平台撤銷繁星同步的授權。若要要求刪除繁星同步保存的相關授權資料，請依「用戶資料刪除說明」頁面的方式提出。</p>
        <h2>聯絡方式</h2>
        <p>隱私或資料處理問題可寄送至 <a href="mailto:yukidu@gmail.com">yukidu@gmail.com</a>。</p>
      </article>}
      {kind === 'terms' && <article>
        <h1>服務條款</h1>
        <p className="legal-meta">最後更新：{updated}</p>
        <p>使用繁星同步（StarsVideoSync）即表示你同意僅以你有權管理的帳號與內容使用本服務，並遵守各連接平台的服務條款、社群守則、著作權政策及 API 規範。</p>
        <h2>授權與帳號</h2>
        <p>你必須自行完成第三方平台 OAuth 授權，並對你授權連接的 Facebook 粉絲專頁、Instagram 專業帳號、Threads 帳號、YouTube 頻道及其他平台帳號具有合法管理權。</p>
        <h2>內容責任</h2>
        <p>你對上傳、同步、發布的影片、圖片、標題、說明、字幕與其他內容負責，並應確認擁有必要的著作權、肖像權、商標權與其他授權。</p>
        <h2>平台限制</h2>
        <p>不同平台的格式、長度、公開狀態、API 權限、審核與配額可能隨時調整。繁星同步會依官方可用 API 提供功能，但無法保證第三方平台永久提供特定功能或立即發布成功。</p>
        <h2>禁止行為</h2>
        <p>不得使用本服務繞過第三方平台權限、使用未公開私有 API、冒用他人帳號、發布侵權或違法內容，或以自動化方式濫用平台。</p>
        <h2>聯絡方式</h2>
        <p>服務相關問題可寄送至 <a href="mailto:yukidu@gmail.com">yukidu@gmail.com</a>。</p>
      </article>}
      {kind === 'data-deletion' && <article>
        <h1>用戶資料刪除說明</h1>
        <p className="legal-meta">最後更新：{updated}</p>
        <p>如果你曾授權繁星同步（StarsVideoSync）連接 Facebook、Instagram、Threads 或其他第三方平台，並希望刪除本服務保存的授權資料，可依下列方式提出。</p>
        <h2>方式一：先撤銷平台授權</h2>
        <p>你可以先到相對應平台的帳號／應用程式授權設定中，移除或撤銷「繁星同步 StarsVideoSync」的存取權限。撤銷後，本服務將無法再使用該平台權杖執行發布。</p>
        <h2>方式二：要求刪除繁星同步保存資料</h2>
        <p>請以你用來授權該平台的帳號可識別資訊寄信至 <a href="mailto:yukidu@gmail.com?subject=StarsVideoSync%20%E8%B3%87%E6%96%99%E5%88%AA%E9%99%A4%E8%AB%8B%E6%B1%82">yukidu@gmail.com</a>，主旨請填「StarsVideoSync 資料刪除請求」。請註明希望刪除的平台（例如 Facebook / Instagram / Threads / YouTube）與可供核對的帳號名稱。</p>
        <p>完成合理身分核對後，我們會刪除繁星同步資料庫中對應的 OAuth 權杖與平台帳號識別資料；第三方平台本身已保存或已發布的內容，則需依該平台提供的工具另行刪除。</p>
        <h2>處理範圍</h2>
        <p>刪除要求僅涵蓋繁星同步所控制的資料。第三方平台的帳號、貼文、影片、分析資料、備份或依法需保留的資料，依各平台政策處理。</p>
      </article>}
      <nav className="legal-links"><a href="/privacy">隱私權政策</a><a href="/terms">服務條款</a><a href="/data-deletion">資料刪除</a><a href="/">返回繁星同步</a></nav>
    </div>
  </main>;
}
