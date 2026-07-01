const KB_BASE_PATH = "/knowledgebase-public";
const THEME_KEY = "theme";
const SOURCE_ORDER = ["paper", "reddit", "rss", "custom"];
const COLLAPSED_ITEM_IDS = new Set();
let CALENDAR_DATES_CACHE = null;
let INDEX_ITEMS = [];
let ACTIVE_SOURCE = "paper";
let ACTIVE_CALENDAR_MONTH = "";

function sitePath(path) {
  const normalized = String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
  return `${KB_BASE_PATH}${normalized}`;
}

function canUseLocalStorage() {
  try {
    const key = "__kb_storage_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch (_e) {
    return false;
  }
}

function resolveInitialTheme() {
  if (canUseLocalStorage()) {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", normalized);
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    const isActive = btn.getAttribute("data-theme-set") === normalized;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  if (canUseLocalStorage()) {
    localStorage.setItem(THEME_KEY, normalized);
  }
  applyTheme(normalized);
}

function bindThemeButtons() {
  applyTheme(resolveInitialTheme());
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    if (btn.getAttribute("data-theme-bound") === "1") return;
    btn.setAttribute("data-theme-bound", "1");
    btn.addEventListener("click", () => {
      setTheme(btn.getAttribute("data-theme-set"));
    });
  });
}

function bindBackToTopButton() {
  const btn = document.querySelector("[data-back-to-top]");
  if (!btn || btn.getAttribute("data-back-to-top-bound") === "1") return;
  btn.setAttribute("data-back-to-top-bound", "1");

  const sync = () => {
    btn.classList.toggle("is-visible", window.scrollY > 480);
  };
  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "auto" });
  });
  window.addEventListener("scroll", sync, { passive: true });
  sync();
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let MARKDOWN_RENDERER = null;

function getMarkdownRenderer() {
  if (MARKDOWN_RENDERER) return MARKDOWN_RENDERER;
  if (typeof window.markdownit !== "function") return null;
  const md = window.markdownit({
    html: false,
    linkify: true,
    breaks: true,
  });
  if (typeof window.texmath === "function" && window.katex) {
    md.use(window.texmath, {
      engine: window.katex,
      delimiters: ["dollars", "brackets", "beg_end"],
      katexOptions: {
        throwOnError: false,
        strict: "ignore",
        trust: false,
      },
    });
  }
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    function defaultRender(tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options);
    };
  md.renderer.rules.link_open = function linkOpen(tokens, idx, options, env, self) {
    const token = tokens[idx];
    const targetIndex = token.attrIndex("target");
    if (targetIndex < 0) {
      token.attrPush(["target", "_blank"]);
    } else {
      token.attrs[targetIndex][1] = "_blank";
    }
    const relIndex = token.attrIndex("rel");
    if (relIndex < 0) {
      token.attrPush(["rel", "noopener noreferrer"]);
    } else {
      token.attrs[relIndex][1] = "noopener noreferrer";
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
  MARKDOWN_RENDERER = md;
  return MARKDOWN_RENDERER;
}

function stripWrappingMarkdownFence(text) {
  const cleaned = String(text || "").trim();
  const lines = cleaned.split(/\r?\n/);
  if (lines.length < 2) return cleaned;
  const opening = lines[0].trim().toLowerCase();
  if (!(opening === "```" || opening.startsWith("```markdown") || opening.startsWith("```md"))) {
    return cleaned;
  }
  for (let i = lines.length - 1; i > 0; i -= 1) {
    if (lines[i].trim() === "```") {
      return lines.slice(1, i).join("\n").trim();
    }
  }
  return cleaned;
}

function renderMarkdown(text) {
  const md = getMarkdownRenderer();
  const normalized = stripWrappingMarkdownFence(text);
  if (!md || !window.DOMPurify) return `<p>${escapeHtml(normalized)}</p>`;
  const html = md.render(normalized);
  return window.DOMPurify.sanitize(html);
}

function formatDateText(iso) {
  if (!iso) return "";
  const val = new Date(iso);
  if (Number.isNaN(val.getTime())) return String(iso);
  return val.toLocaleString("ja-JP", { hour12: false });
}

function renderTabButtons() {
  document.querySelectorAll("[data-source-tab]").forEach((btn) => {
    const source = btn.getAttribute("data-source-tab");
    const count = INDEX_ITEMS.filter((x) => x.source === source).length;
    btn.textContent = `${source} (${count})`;
    btn.classList.toggle("is-active", source === ACTIVE_SOURCE);
  });
}

function sourceGuideTitle(source) {
  if (source === "paper") return "Paper 目次";
  if (source === "reddit") return "Reddit スレッド目次";
  if (source === "custom") return "Custom URL 目次";
  return "RSS 目次";
}

function loadEmbeddedCalendarDates() {
  const raw = document.getElementById("calendar-dates-json");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw.textContent || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => x && x.date) : [];
  } catch (_e) {
    return [];
  }
}

async function loadCalendarDates() {
  if (CALENDAR_DATES_CACHE) return CALENDAR_DATES_CACHE;
  try {
    const parsed = await loadCalendarDatesScript();
    if (Array.isArray(parsed)) {
      CALENDAR_DATES_CACHE = parsed.filter((x) => x && x.date);
      return CALENDAR_DATES_CACHE;
    }
  } catch (_e) {}
  CALENDAR_DATES_CACHE = loadEmbeddedCalendarDates();
  return CALENDAR_DATES_CACHE;
}

function loadCalendarDatesScript() {
  if (Array.isArray(window.KB_DIGEST_DATES)) {
    return Promise.resolve(window.KB_DIGEST_DATES);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-digest-dates-script]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.KB_DIGEST_DATES || []), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `${sitePath("/assets/digest-dates.js")}?v=${Date.now()}`;
    script.async = true;
    script.dataset.digestDatesScript = "true";
    script.onload = () => resolve(window.KB_DIGEST_DATES || []);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function monthKeyFromDate(date) {
  return String(date || "").slice(0, 7);
}

function formatCalendarMonth(monthKey) {
  const [year, month] = String(monthKey || "").split("-");
  if (!year || !month) return "";
  return `${year}年${Number(month)}月`;
}

async function renderDigestCalendar() {
  const root = document.querySelector("[data-digest-calendar]");
  const guide = document.getElementById("source-guide");
  if (!root || !guide) return;

  const dates = await loadCalendarDates();
  if (dates.length === 0) {
    root.innerHTML = "";
    return;
  }

  const currentDate = guide.getAttribute("data-calendar-current-date") || dates[0].date;
  const byDate = new Map(dates.map((x) => [x.date, x]));
  const monthKeys = Array.from(new Set(dates.map((x) => monthKeyFromDate(x.date))))
    .filter(Boolean)
    .sort();
  if (!ACTIVE_CALENDAR_MONTH || !monthKeys.includes(ACTIVE_CALENDAR_MONTH)) {
    ACTIVE_CALENDAR_MONTH = monthKeys.includes(monthKeyFromDate(currentDate))
      ? monthKeyFromDate(currentDate)
      : monthKeys[monthKeys.length - 1];
  }

  const monthIndex = monthKeys.indexOf(ACTIVE_CALENDAR_MONTH);
  const [yearText, monthText] = ACTIVE_CALENDAR_MONTH.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i += 1) cells.push('<span class="calendar-cell is-empty"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayText = String(day).padStart(2, "0");
    const date = `${ACTIVE_CALENDAR_MONTH}-${dayText}`;
    const entry = byDate.get(date);
    const isCurrent = date === currentDate;
    const label = `${Number(monthText)}月${day}日`;
    if (entry) {
      cells.push(
        `<a class="calendar-cell is-linked${isCurrent ? " is-current" : ""}" href="${sitePath(`/dates/${date}/index.html`)}" aria-label="${escapeHtml(label)} ${entry.count}件">${day}</a>`
      );
    } else {
      cells.push(`<span class="calendar-cell${isCurrent ? " is-current" : ""}">${day}</span>`);
    }
  }

  root.innerHTML = `
    <div class="calendar-head">
      <button type="button" class="calendar-nav" data-calendar-month="${escapeHtml(monthKeys[monthIndex - 1] || "")}" aria-label="Previous month"${monthIndex <= 0 ? " disabled" : ""}>‹</button>
      <h2>${escapeHtml(formatCalendarMonth(ACTIVE_CALENDAR_MONTH))}</h2>
      <button type="button" class="calendar-nav" data-calendar-month="${escapeHtml(monthKeys[monthIndex + 1] || "")}" aria-label="Next month"${monthIndex >= monthKeys.length - 1 ? " disabled" : ""}>›</button>
    </div>
    <div class="calendar-weekdays" aria-hidden="true">
      <span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>
    </div>
    <div class="calendar-grid">${cells.join("")}</div>
  `;

  root.querySelectorAll("[data-calendar-month]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextMonth = btn.getAttribute("data-calendar-month");
      if (!nextMonth) return;
      ACTIVE_CALENDAR_MONTH = nextMonth;
      renderDigestCalendar();
    });
  });
}

function renderSourceGuide(list) {
  const title = document.getElementById("source-guide-title");
  const root = document.getElementById("source-guide-list");
  if (!title || !root) return;
  title.textContent = sourceGuideTitle(ACTIVE_SOURCE);
  if (list.length === 0) {
    root.innerHTML = "<li>項目なし</li>";
    return;
  }
  root.innerHTML = list
    .map(
      (item, idx) =>
        `<li><a href="#item-card-${encodeURIComponent(item.id)}">${idx + 1}. ${escapeHtml(item.title)}</a></li>`
    )
    .join("");
}

function itemTimestamp(item) {
  const ts = Date.parse(item.published_at || "");
  return Number.isFinite(ts) ? ts : 0;
}

function rssFeedOrder(item) {
  if (item.rss_feed_order === null || item.rss_feed_order === undefined) return 999999;
  const order = Number(item.rss_feed_order);
  return Number.isFinite(order) ? order : 999999;
}

function getSourceItems(source) {
  const list = INDEX_ITEMS.filter((x) => x.source === source);
  if (source !== "rss") return list;
  return list.slice().sort((a, b) => {
    const feedDiff = rssFeedOrder(a) - rssFeedOrder(b);
    if (feedDiff !== 0) return feedDiff;
    const dateDiff = itemTimestamp(b) - itemTimestamp(a);
    if (dateDiff !== 0) return dateDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function renderItemCard(item) {
  const collapsed = COLLAPSED_ITEM_IDS.has(item.id);
  const collapseLabel = collapsed ? "展開" : "折りたたむ";
  const tagHtml = (item.tags_final || [])
    .map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`)
    .join("");
  const detailUrl = item.detail_url || sitePath(`/items/${encodeURIComponent(item.id)}/index.html`);
  return `
  <article class="item-card" id="item-card-${encodeURIComponent(item.id)}">
    <header class="item-head">
      <p class="item-meta">${escapeHtml(item.source_detail)} / ${escapeHtml(formatDateText(item.published_at))}</p>
      <div class="item-head-row">
        <h2>${escapeHtml(item.title)}</h2>
        <button type="button" class="collapse-button" data-card-collapse-toggle="${escapeHtml(item.id)}">${collapseLabel}</button>
      </div>
    </header>
    <div class="item-card-body${collapsed ? " is-collapsed" : ""}"${collapsed ? " hidden" : ""}>
      <div class="summary-long markdown-body">${renderMarkdown(item.summary_long_ja)}</div>
      <div class="tag-row">${tagHtml}</div>
      <div class="action-row">
        <a href="${escapeHtml(detailUrl)}">Open Detail</a>
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Open Original</a>
      </div>
    </div>
  </article>
  `;
}

function toggleCardCollapsed(itemId) {
  if (COLLAPSED_ITEM_IDS.has(itemId)) {
    COLLAPSED_ITEM_IDS.delete(itemId);
  } else {
    COLLAPSED_ITEM_IDS.add(itemId);
  }
  renderIndexCards();
}

function bindCollapseButtons() {
  document.querySelectorAll("[data-card-collapse-toggle]").forEach((btn) => {
    if (btn.getAttribute("data-card-collapse-bound") === "1") return;
    btn.setAttribute("data-card-collapse-bound", "1");
    btn.addEventListener("click", () => {
      const itemId = btn.getAttribute("data-card-collapse-toggle");
      toggleCardCollapsed(itemId || "");
    });
  });
}

function renderIndexCards() {
  const root = document.getElementById("index-cards-root");
  if (!root) return;
  const list = getSourceItems(ACTIVE_SOURCE);
  renderSourceGuide(list);
  if (list.length === 0) {
    root.innerHTML = "<p class=\"empty-state\">このソースには記事がありません。</p>";
    return;
  }

  let currentFeed = "";
  root.innerHTML = list
    .map((item) => {
      const feedName = item.source_detail || "RSS";
      const feedHeading =
        ACTIVE_SOURCE === "rss" && feedName !== currentFeed
          ? `<h2 class="feed-section-title">${escapeHtml(feedName)}</h2>`
          : "";
      currentFeed = feedName;
      return `${feedHeading}${renderItemCard(item)}`;
    })
    .join("");

  bindCollapseButtons();
}

function bindSourceTabs() {
  document.querySelectorAll("[data-source-tab]").forEach((btn) => {
    if (btn.getAttribute("data-source-tab-bound") === "1") return;
    btn.setAttribute("data-source-tab-bound", "1");
    btn.addEventListener("click", () => {
      ACTIVE_SOURCE = btn.getAttribute("data-source-tab");
      renderTabButtons();
      renderIndexCards();
    });
  });
}

function initIndexPage() {
  const raw = document.getElementById("index-items-json");
  if (!raw) return;
  try {
    INDEX_ITEMS = JSON.parse(raw.textContent || "[]");
  } catch (_e) {
    INDEX_ITEMS = [];
  }

  if (!SOURCE_ORDER.includes(ACTIVE_SOURCE)) {
    ACTIVE_SOURCE = "paper";
  }
  if (INDEX_ITEMS.length > 0 && !INDEX_ITEMS.some((x) => x.source === ACTIVE_SOURCE)) {
    ACTIVE_SOURCE = SOURCE_ORDER.find((source) => INDEX_ITEMS.some((x) => x.source === source)) || ACTIVE_SOURCE;
  }
  bindSourceTabs();
  renderDigestCalendar();
  renderTabButtons();
  renderIndexCards();
}

function initItemDetailPage() {
  const node = document.getElementById("item-summary-markdown");
  if (!node) return;
  node.innerHTML = renderMarkdown(node.textContent || "");
}

window.initIndexPage = initIndexPage;
window.renderMarkdown = renderMarkdown;
window.addEventListener("DOMContentLoaded", () => {
  bindThemeButtons();
  bindBackToTopButton();
  initIndexPage();
  initItemDetailPage();
});