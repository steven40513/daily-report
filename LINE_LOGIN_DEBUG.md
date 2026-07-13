# LINE Login × Supabase Custom Provider 整合指南

> **用途：** 給開發者與 AI 助手閱讀的參考文件。當你要在 Supabase 中串接 LINE Login 作為 custom OAuth2 provider 時，這份文件能幫你避開已知的所有坑。  
> **來源：** 2026-07-02 實際踩坑紀錄，從完全無法登入到手機端完整通過，共修正 9 個根因。  
> **適用範圍：** Supabase Auth + LINE Login（custom provider），前端為靜態網頁（GitHub Pages / 任何 static hosting），使用 PKCE flow。

---

## 給 AI 的摘要

如果你是 AI 助手，正在幫開發者串接 LINE Login 到 Supabase，請優先注意以下幾點：

1. **LINE 有兩組 API，endpoint 長得很像但回傳格式不同。** Supabase 需要 OIDC 標準格式（有 `sub` 欄位），用錯 endpoint 會得到 "Missing Provider ID" 或 "Error getting user email"。
2. **Supabase client 端必須明確設定 `flowType: 'pkce'`。** Server 端雖然強制 PKCE，但 client 端不設就不會產生 `code_verifier`，exchange 會靜默失敗。
3. **Supabase Dashboard 的 custom provider 設定容易壞。** 反覆修改可能導致不一致狀態，最安全的做法是刪掉重建。
4. **LINE 使用者不一定有 email。** 必須在 Supabase 啟用「Allow users without email」。
5. **Facebook / Instagram / Messenger 的內建瀏覽器跟 LINE 內建瀏覽器一樣會讓 OAuth 跳轉失敗。** 不能只偵測 LINE 的 UA，要涵蓋所有常見的 App 內建瀏覽器，並且在使用者按登入之前就先警告，不要等失敗了才提示。
6. **不要讓舊的 PKCE `code_verifier` 留在 localStorage。** 多次測試登入時，舊 verifier 可能和新的 auth code 不匹配，造成 `code challenge does not match previously saved code verifier`。
7. **除錯訊息要能關閉。** 手機端定位問題時可以用 checkpoint / alert，但可用版必須預設隱藏，否則使用者會看到 CP8、CP9 這類開發訊息。

---

## 第一部分：正確設定（照抄即可）

### Supabase Dashboard — Custom Provider 設定

在 Supabase Dashboard → Authentication → Providers → Add provider 中，新增 Custom Provider：

| 欄位 | 正確值 | 說明 |
|------|--------|------|
| Provider Identifier | `line` | 小寫，前端程式用 `custom:line` 呼叫 |
| Configuration Method | **Manual configuration** | ⚠️ 不要用 Auto-discovery |
| Issuer URL | `https://access.line.me` | LINE 的 OIDC Issuer |
| Authorization URL | `https://access.line.me/oauth2/v2.1/authorize` | |
| Token URL | `https://api.line.me/oauth2/v2.1/token` | |
| Userinfo URL | `https://api.line.me/oauth2/v2.1/userinfo` | ⚠️ 見下方「關鍵陷阱 #1」 |
| JWKS URI | `https://api.line.me/oauth2/v2.1/certs` | |
| Client ID | （從 LINE Developers Console 取得） | |
| Client Secret | （從 LINE Developers Console 取得） | |
| Scopes | `openid,profile,email` | ⚠️ Dashboard 用**逗號**分隔 |
| Allow users without email | ✅ 啟用 | ⚠️ 見下方「關鍵陷阱 #3」 |

### 前端 Supabase Client 設定

```javascript
// 初始化 — flowType:'pkce' 是必要的
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,  // 手動處理 OAuth callback
    flowType: 'pkce'            // ⚠️ 見下方「關鍵陷阱 #2」
  }
});
```

### 發起 LINE 登入

```javascript
const result = await supabaseClient.auth.signInWithOAuth({
  provider: 'custom:line',
  options: {
    redirectTo: window.location.href.split('#')[0].split('?')[0],
    skipBrowserRedirect: true,
    scopes: 'openid email profile'  // ⚠️ client-side 用**空格**分隔
  }
});
if (result.error) throw result.error;
// result.data.url 是要跳轉的 LINE 授權頁面 URL
window.location.href = result.data.url;
```

### 處理 OAuth Callback

```javascript
// 頁面載入時檢查 URL 是否帶有 auth code
const search = window.location.search;

// ⚠️ 見下方「關鍵陷阱 #4」— 必須排除 error_code=
const hasCode = search && search.indexOf('code=') >= 0 && search.indexOf('error_code=') < 0;
const hasError = search && search.indexOf('error=') >= 0;

if (hasError) {
  const params = new URLSearchParams(search);
  const errMsg = params.get('error_description') || params.get('error') || '未知錯誤';
  // 顯示錯誤，清除 URL 參數
  return;
}

if (hasCode) {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const result = await supabaseClient.auth.exchangeCodeForSession(code);
  if (result.error) {
    // exchange 失敗
  } else {
    // 登入成功！result.data.user 有使用者資訊
  }
}
```

---

## 第二部分：關鍵陷阱（務必閱讀）

### 關鍵陷阱 #1：LINE 有兩個「使用者資訊」endpoint，用錯會完全失敗

這是最容易踩的坑。LINE 有兩個看起來都能取得使用者資料的 API：

| endpoint | 類型 | 回傳格式 | Supabase 能用嗎 |
|----------|------|---------|----------------|
| `https://api.line.me/v2/profile` | LINE 私有 API | `{"userId": "U...", "displayName": "..."}` | ❌ 不能 |
| `https://api.line.me/oauth2/v2.1/userinfo` | OIDC 標準 | `{"sub": "U...", "name": "...", "email": "..."}` | ✅ 可以 |

**為什麼：** Supabase 作為 OIDC 相容的 auth 系統，期望 userinfo endpoint 回傳標準 OIDC 格式，特別是 `sub` 欄位（Subject Identifier）。LINE 的 `/v2/profile` 用 `userId` 而不是 `sub`，Supabase 會因為找不到 `sub` 而報 "Missing Provider ID"。

**怎麼錯的：** Google 搜尋「LINE Login API」最先找到的通常是 `/v2/profile`（Messaging API 文件）。OIDC 標準的 `/oauth2/v2.1/userinfo` 在 LINE Login 文件中較不顯眼。AI 助手訓練資料中也可能以舊版 endpoint 為主。

**正確的 LINE OIDC endpoints 完整清單：**

```
Discovery:     https://access.line.me/.well-known/openid-configuration
Issuer:        https://access.line.me
Authorization: https://access.line.me/oauth2/v2.1/authorize
Token:         https://api.line.me/oauth2/v2.1/token
Userinfo:      https://api.line.me/oauth2/v2.1/userinfo
JWKS:          https://api.line.me/oauth2/v2.1/certs
Revocation:    https://api.line.me/oauth2/v2.1/revoke
```

參考來源：[LINE OAuth & OIDC endpoints](https://logto.io/oauth-providers-explorer/line)

---

### 關鍵陷阱 #2：Supabase client 必須明確設定 `flowType: 'pkce'`

**現象：** `signInWithOAuth` 呼叫成功，也能跳轉到 LINE 授權頁面，但 callback 回來後 `exchangeCodeForSession` 永遠失敗。localStorage 中找不到 `code_verifier`。

**原因：** Supabase server 端對 custom provider 強制使用 PKCE flow，但 **client 端的 `flowType` 預設不是 `'pkce'`**。如果 client 端不設定 `flowType: 'pkce'`，Supabase JS SDK 不會產生 `code_verifier`，也不會在 auth URL 中附帶 `code_challenge`。Server 端收到沒有 `code_challenge` 的請求後仍然回傳 authorization code，但 client 端沒有 `code_verifier` 就無法完成 exchange。

**診斷方法：** 在 `signInWithOAuth` 之後，檢查：
1. `result.data.url` 的長度（正確的 PKCE URL 約 230+ 字元，沒有 PKCE 的約 150 字元）
2. `result.data.url` 中是否包含 `code_challenge=` 參數
3. localStorage 中是否多了 Supabase 的 PKCE 相關 key

**修復：** 在 `createClient` 的 auth config 中加上 `flowType: 'pkce'`。

---

### 關鍵陷阱 #3：LINE 使用者不一定有 email

**現象：** Supabase 回傳 `unexpected_failure - Error getting user email from external provider`。

**原因分兩層：**

1. **LINE 的 email 取得需要額外申請：** 在 LINE Developers Console，email 不是預設可用的 scope。需要在 Channel 設定中申請「Email Address Permission」，且需要附上截圖審核。未申請通過前，即使 scope 包含 `email`，LINE 也不會回傳。

2. **Supabase 預設要求使用者有 email：** 如果 Supabase 的 provider 設定未勾選「Allow users without email」，沒有 email 的使用者就無法註冊。

**修復：** 在 Supabase Dashboard 的 LINE provider 設定中啟用「Allow users without email」。即使你之後成功申請了 LINE 的 email permission，也建議保持這個選項開啟，因為不是每個 LINE 使用者都有綁定 email。

---

### 關鍵陷阱 #4：URL 參數中 `code=` 的子字串誤判

**現象：** Supabase 回傳錯誤 URL（例如 `?error_code=bad_oauth_state`），但你的程式卻嘗試拿這個 URL 做 code exchange。

**原因：** `url.indexOf('code=')` 會匹配到 `error_code=` 中的 `code=` 子字串。

**修復：**

```javascript
// ❌ 錯誤
const hasCode = search.indexOf('code=') >= 0;

// ✅ 正確
const hasCode = search.indexOf('code=') >= 0 && search.indexOf('error_code=') < 0;

// ✅ 更嚴謹（使用 URLSearchParams）
const params = new URLSearchParams(search);
const hasCode = params.has('code') && !params.has('error_code');
```

---

### 關鍵陷阱 #5：Scopes 在不同地方用不同分隔符

**Supabase Dashboard** 的 Scopes 欄位用**逗號**分隔：`openid,profile,email`

**前端 `signInWithOAuth` 的 `scopes` 參數**用**空格**分隔：`'openid email profile'`

用錯分隔符不會報錯，但 scope 不會正確生效。

---

### 關鍵陷阱 #6：Supabase Dashboard 的 custom provider 設定容易壞

**現象：** 在 Dashboard 反覆修改 provider 設定後，點 LINE 登入跳出 `Error: Missing Provider ID`，但設定頁面看起來一切正常。

**原因：** 可能是在 Auto-discovery 和 Manual 模式之間切換時，部分欄位被覆寫或清空。也可能是 Dashboard 表單驗證失敗但未顯示錯誤訊息。

**修復：** 不要嘗試修復。直接**刪掉整個 provider，然後用本文件第一部分的正確值重新建立**。

**預防：** 修改設定後，務必重新載入頁面確認值有正確保存。

---

### 關鍵陷阱 #7：OAuth state 過期（手機端容易觸發）

**現象：** Supabase callback 回傳 `?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+has+expired`。

**常見觸發情境：**
1. 重複點擊「LINE 登入」：每次點擊產生新的 state，舊的 state 失效。如果 LINE app 快取了舊的 auth URL，回來時 state 已過期。
2. 跳轉前有人為延遲（`setTimeout`）：拉長了整個流程時間。
3. 手機上 Safari → LINE app → Safari 的切換比桌面慢。

**修復：**
1. `signInWithOAuth` 成功後立即跳轉，不要加任何延遲。
2. 清除瀏覽器資料後再測試（避免舊 state 殘留）。
3. 每次測試只點一次 LINE 登入。

---

### 關鍵陷阱 #8：App 內建瀏覽器（Facebook、Instagram、Messenger…）打開會整個壞掉

**現象：** 從 LINE app 分享的連結點進去、用 LINE 內建瀏覽器登入是通的；但如果連結是從 Facebook / Messenger / Instagram 分享出去，使用者在那些 App 的內建瀏覽器裡按「LINE 登入」會沒反應、卡住，或跳去 LINE app 授權後回不到原本畫面。

**原因：** Facebook、Instagram、Messenger 的內建瀏覽器（in-app browser）跟 LINE 的內建瀏覽器是同一類問題：

1. 對「跳到別的 App（LINE app）再跳回來」的支援不穩定，常常跳過去後就回不到原本的分頁。
2. localStorage / 第三方 cookie 處理跟正常 Safari／Chrome 不同，PKCE 的 `code_verifier` 可能在跳轉過程中遺失。
3. 這些內建瀏覽器本質上就不是設計給第三方 OAuth 跳轉用的。

**這不是新問題，是同一類問題只是換了個 App：** 專案先前已經確認過「不要用 LINE / Messenger 內建瀏覽器」，但一開始只針對 LINE 內建瀏覽器加了偵測與提示（`checkLineInAppBrowser`），沒有涵蓋 Facebook / Instagram / Messenger 的內建瀏覽器，所以使用者從 Facebook 分享連結點進來時沒有被攔下來，就直接踩雷了。

**修復（2026-07-02）：**
1. 把偵測範圍從只認 LINE 的 UA（`Line/`、`LIFF`），擴大到同時偵測 Facebook（`FBAN`、`FBAV`、`FB_IAB`）、Instagram（`Instagram`）、Messenger（`Messenger`）。
2. 偵測時機提前：原本只在「已經登入成功後」才提示切換瀏覽器，改成**頁面一載入就先檢查**，在使用者按下登入按鈕之前就顯示警告 + 複製網址按鈕，不用等登入失敗才發現。
3. `signInWithLine()` 內部也加一層防呆：偵測到內建瀏覽器時直接擋下、顯示提示，不會真的送出 `signInWithOAuth` 請求。

**判斷方式：** 打開瀏覽器開發工具看 `navigator.userAgent`，比對是否包含上述關鍵字，是最快的判斷方法。之後如果又出現「某個 App 分享連結登入不了」的回報，優先假設是同一類「內建瀏覽器」問題，把該 App 的 UA 關鍵字加進 `detectInAppBrowser()` 即可。

---

### 關鍵陷阱 #9：舊的 PKCE verifier 會讓新的登入 code 失效

**現象：** LINE 授權看似成功，也有回到前端 callback，但 Supabase exchange 失敗：

```
code challenge does not match previously saved code verifier
```

**原因：** PKCE 流程裡有一組必須配對的值：

1. 前端產生 `code_verifier`
2. 前端用它算出 `code_challenge`
3. Auth URL 帶著 `code_challenge` 去 LINE / Supabase
4. Callback 回來後，前端要用「同一個」`code_verifier` 去交換 session

如果使用者或測試者連續按很多次 LINE 登入，localStorage 可能留下舊的 verifier。新的 auth code 回來時，Supabase 若拿到舊 verifier，就會發現它算出來的 challenge 和這次登入 request 的 challenge 不一致，於是拒絕登入。

**這次實際踩到的狀況（2026-07-02）：**

- `34faa12 Refine LINE login diagnostics` 移除了 CP 熱字並保留 `cv` 補救，但還是可能沿用舊 verifier。
- 使用者測試後回報 `code challenge does not match previously saved code verifier`。
- `37a25f8 Fix LINE PKCE verifier reuse` 修正為：
  1. 每次按 LINE 登入前，先清掉 localStorage 中舊的 PKCE verifier key。
  2. Callback 回來時，如果 URL 帶有這次的 `cv`，直接覆蓋 localStorage 裡的 verifier，不再保留舊值。
  3. checkpoint 記錄保留在背景，但可見的 CP alert 預設關閉。

**修復原則：**

- 登入開始前清除舊 verifier，避免上一輪登入污染下一輪。
- Callback 若有本輪 verifier 備援值，必須以本輪值為準。
- 不要把完整 verifier 顯示在畫面或 alert；若要除錯，只記錄前幾碼即可。

---

## 2026-07-02 最終可用版紀錄

**目前確認可用版本：**

| Commit | 目的 | 結論 |
|--------|------|------|
| `eea7bdc` | 回復到使用者認為可登入的版本 | 可登入，但有大量 CP 熱字與同步邏輯風險 |
| `34faa12` | 移除 CP 熱字、保留 LINE 登入補救、補回同步防迴圈 | UI 乾淨，但 verifier reuse 仍可能造成登入失敗 |
| `37a25f8` | 清除舊 verifier，callback 時覆蓋為本輪 verifier | 使用者確認此版完整可用 |

**最後採用的策略：**

1. 以 `eea7bdc` 的 LINE 登入補救機制為基礎。
2. 移除使用者可見的 CP8、CP9、CP10、CP11 alert。
3. 將診斷面板改為 `LINE_LOGIN_DEBUG=false`，預設不顯示。
4. 保留背景 `_cp()` 紀錄，必要時仍可追查手機端登入流程。
5. 保留 `cv` 補救，但每次登入前清除舊 verifier，callback 時用本輪 `cv` 覆蓋 localStorage。
6. 補回雲端同步安全修正：`syncCurrentReportToSupabase()` 不呼叫 `autoSave()`，改成 `collectReportData()` 後直接 `saveReport(currentReportDate, data)`，避免同步排程循環。

**驗證狀態：**

- GitHub Pages 測試網址：`https://steven40513.github.io/daily-report/?v=37a25f8`
- 使用者回報：此版已完整可用。
- 自動測試：
  - `frontend-smoke-test`: 59/59 passed
  - `frontend-extended-test`: passed
  - `frontend-remaining-test`: passed
  - `validate-supabase-schema`: 33/33 passed

---

## 第三部分：完整 OAuth 流程圖

```
使用者點擊「LINE 登入」
    │
    ▼
[前端] signInWithOAuth({ provider: 'custom:line' })
    │  先清除舊的 PKCE verifier
    │  產生 code_verifier → 存入 localStorage
    │  產生 code_challenge = SHA256(code_verifier)
    │  取得 auth URL（含 code_challenge）
    │  手機端補救：把本輪 verifier 以 cv 帶回 redirect URL
    ▼
[前端] window.location.href = auth URL
    │
    ▼
[Supabase Auth] 收到 auth request，保存 state + code_challenge
    │  302 redirect → LINE Authorization URL
    ▼
[LINE] access.line.me 顯示授權頁面
    │  使用者授權（可能開啟 LINE app）
    ▼
[LINE] 回傳 authorization code → Supabase callback
    │
    ▼
[Supabase Auth] 用 authorization code 向 LINE 換 token
    │  用 token 向 LINE userinfo endpoint 取得使用者資料
    │  302 redirect → 前端 redirectTo URL（附帶 ?code=xxx）
    ▼
[前端] 頁面載入，偵測 URL 有 ?code=
    │  若 URL 有 cv，先用本輪 cv 覆蓋 localStorage verifier
    │
    ▼
[前端] exchangeCodeForSession(code)
    │  送出 code + code_verifier 給 Supabase
    ▼
[Supabase Auth] 驗證 SHA256(code_verifier) == code_challenge
    │  成功 → 回傳 session + user
    ▼
[前端] 登入完成！
```

**手機端特殊流程：** 在 LINE 授權頁面，使用者可能點「使用 LINE 應用程式登入」，此時會跳到 LINE app 授權，再跳回 Safari。多數正常 Safari 流程會保留 localStorage，但實作上不能只依賴 localStorage；本專案最後採用 `cv` callback 補救，確保回來時使用的是同一輪登入產生的 verifier。

---

## 第四部分：除錯診斷建議

如果遇到 LINE Login 問題，按以下順序檢查：

### Step 1：確認 provider 是否存在

呼叫 `signInWithOAuth` 後，如果立刻報錯 "Missing Provider ID"，表示 Supabase 找不到 provider。到 Dashboard 確認 provider 存在且 identifier 是 `line`。

### Step 2：確認 PKCE 有啟用

`signInWithOAuth` 成功後，檢查回傳的 auth URL：
- URL 長度 > 200 字元
- URL 包含 `code_challenge=` 參數
- localStorage 中有 Supabase 產生的新 key

如果不符合，加上 `flowType: 'pkce'`。

### Step 3：確認 callback 內容

從 LINE 回來後，檢查 URL：
- `?code=xxx` → 正常，進行 exchange
- `?error=xxx` → 看 error_description
  - `OAuth state has expired` → 見陷阱 #7
  - `Error getting user email` → 見陷阱 #1 和 #3

### Step 4：確認 exchange 結果

`exchangeCodeForSession` 的結果：
- `result.error` 存在 → 看 error.message
- `result.data.user` 存在 → 登入成功

### 手機端除錯技巧

手機上看不到 console.log，建議用 `alert()` 在關鍵步驟彈出資訊。正式上線前務必移除。

---

## 第五部分：已排除的假設（不需再考慮）

以下是在除錯過程中被驗證排除的假設，列出來是為了避免 AI 助手重複建議這些方向：

| 假設 | 為什麼不對 |
|------|-----------|
| 改用 implicit flow 繞過 PKCE | Supabase custom provider 強制 PKCE，`flowType: 'implicit'` 無效 |
| Safari ITP 一定會清除 localStorage | 不能一概而論。實測中正常 Safari 流程多半保留，但多次登入、App 切換、內建瀏覽器仍可能讓 verifier 狀態不可靠，所以最後用 `cv` 補救與清除舊 verifier 來降低風險 |
| 從 LINE app 回到 Safari 時 localStorage 一定會遺失 | 不是必然遺失；真正風險是「回來後拿到的 verifier 不是本輪登入的 verifier」 |
| 用 URL 參數備份 code_verifier | 早期判斷為不必要；但 2026-07-02 實測顯示手機 LINE OAuth 可能需要 `cv` 補救。採用時必須只作為短期 callback 補救，不顯示完整值、不寫入畫面，且 callback 後以本輪值覆蓋舊 verifier |
| Supabase client 在手機上載入太慢 | 實測確認 client 和 exchange function 都正常載入 |
| 需要 visibilitychange 監聽器偵測切回 | 問題不在於偵測時機，而是 exchange 本身的失敗 |

---

## 附錄：LINE Developers Console 設定提醒

在 LINE Developers Console 中建立 LINE Login Channel 時：

1. **Callback URL** 要填 Supabase 的 callback，不是你的前端 URL：
   ```
   https://<your-project>.supabase.co/auth/v1/callback
   ```

2. **Scopes** 至少需要 `openid` 和 `profile`。`email` 需要額外申請。

3. **LINE Login 設定** 中的 "Linked OA" 可以不設。

4. **Channel 類型**選 "LINE Login"，不是 "Messaging API"。
