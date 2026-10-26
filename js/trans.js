/* ============================================================
 * 数据模型
 * textList:  [{ id, source, origin, lines: [str], deletedLines: [int] }]
 * transList: [{ id, lang, fromTextId, lines: [str], text, source }]
 * audioList: [{ id, file, display, source, lang, fromTextId, fromTransId }]
 * ============================================================ */
const BASE = 'https://tower-pc.tail3cd725.ts.net';
let fileList = [];
let textList = [];
let transList = [];
let audioList = [];
let isTranscribing = false;
let cardState = {};
let pendingTtsItems = [];
let pendingTranslateItems = null;
let voiceListCache = { google: [], aliyun: [] };
let ttsFailedMap = {};   // transId -> 错误信息（用于单条重试按钮）
const TTS_SETTINGS_KEY = 'tts_settings';

/* ============================================================
 * AI 翻译配置（DeepSeek / 火山引擎方舟）
 * ============================================================ */
const AI_CONFIG = {
    apiKey: '6869437c-0d6b-42ee-8c6d-4c865ca9b475',
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: 'deepseek-v4-1-flash-260910'
};
const AI_TRANSLATE_MAX_CHARS = 8000;   // 单块最大字符数，块间并行
const AI_TRANSLATE_TIMEOUT = 90000;    // 单次请求超时 90s

/* 语言别名 → 中文名 */
const LANG_CODE_MAP = {
    'hi': '印地语', 'in': '印地语',
    'sa': '阿拉伯语', 'ar': '阿拉伯语',
    'ja': '日语', 'jp': '日语',
    'ko': '韩语', 'kr': '韩语',
    'pt': '葡萄牙语', 'en': '英语',
    'zh': '中文', 'cn': '中文',
    'id': '印度尼西亚语', 'ind': '印度尼西亚语',
    'indonesia': '印度尼西亚语', 'indonesian': '印度尼西亚语',
    'ms': '马来语', 'th': '泰语',
    'vi': '越南语', 'vn': '越南语',
    'es': '西班牙语', 'fr': '法语', 'de': '德语',
    'it': '意大利语', 'ru': '俄语'
};

/* ============================================================
 * 工具
 * ============================================================ */
function genId() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatSize(b) {
    if (!b || b === 0) return '0 B';
    const k = 1024, arr = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + arr[i];
}
function formatTime(s) {
    if (isNaN(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + sec.toString().padStart(2, '0');
}
function getLangName(c) {
    const m = {
        zh: '中文', cn: '中文', pt: '葡萄牙语', en: '英语', jp: '日语', ja: '日语', kr: '韩语', ko: '韩语',
        es: '西班牙语', fr: '法语', de: '德语', it: '意大利语', ru: '俄语',
        ar: '阿拉伯语', sa: '阿拉伯语', hi: '印地语', in: '印地语',
        id: '印度尼西亚语', ind: '印度尼西亚语', indonesia: '印度尼西亚语', indonesian: '印度尼西亚语',
        ms: '马来语', th: '泰语', vi: '越南语', vn: '越南语'
    };
    const k = String(c || '').toLowerCase();
    return m[k] || c || '未知';
}

/**
 * 把用户输入的语种 token（中文名 / 代码）解析为内部语言代码。
 * 优先复用 items 里已有的语言代码，避免 zh/cn、ja/jp 这类别名被改写。
 */
function resolveLangCode(token, items) {
    const raw = String(token || '').trim();
    if (!raw) return '';
    const k = raw.toLowerCase();
    if (LANG_CODE_MAP[k]) return k;
    const list = items || [];
    for (const it of list) {
        if (getLangName(it.lang) === raw) return it.lang;
    }
    for (const [code, cn] of Object.entries(LANG_CODE_MAP)) {
        if (cn === raw) return code;
    }
    return raw;
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}
function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function splitText(t) {
    const s = String(t || '').replace(/\r/g, '');
    const out = [];
    s.split('\n').forEach(para => {
        let buf = '', i = 0;
        for (; i < para.length; i++) {
            const ch = para[i]; buf += ch;
            const isCjk = '。！？；'.indexOf(ch) >= 0;
            const isEnd = isCjk || '!?;…'.indexOf(ch) >= 0 || ch === '.';
            if (isEnd) {
                const nxt = para[i + 1];
                if (isCjk || nxt === undefined || nxt === ' ' || nxt === '\n') {
                    if (buf.trim()) out.push(buf.trim());
                    buf = '';
                    if (nxt === ' ') i++;
                }
            }
        }
        if (buf.trim()) out.push(buf.trim());
    });
    return out.length ? out : [String(t || '').trim()];
}
function nowFileName() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日_${p(d.getHours())}${p(d.getMinutes())}.txt`;
}

/* ============================================================
 * Toast / Confirm
 * ============================================================ */
function showToast(msg, type = 'info') {
    const e = document.querySelector('.toast-msg');
    if (e) e.remove();
    const t = document.createElement('div');
    t.className = 'toast-msg';
    t.textContent = msg;
    const c = { info: '#4f5bd5', success: '#0e9f6e', error: '#c0392b', warning: '#b7791f' };
    t.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:300;background:${c[type] || c.info};color:#fff;padding:9px 18px;border-radius:16px;font-size:12px;font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,0.14);pointer-events:none;animation:toastIn 0.3s ease;max-width:88vw;text-align:center;`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 2300);
    setTimeout(() => t.remove(), 2900);
}
function showConfirm(msg) {
    return new Promise(r => {
        const o = document.createElement('div');
        o.className = 'modal-overlay';
        o.style.display = 'flex';
        o.innerHTML = `<div class="modal" style="width:340px;">
      <div class="modal-header"><span>确认操作</span><button class="modal-close close-confirm">&times;</button></div>
      <div class="modal-body"><p style="font-size:12.5px;margin:0;line-height:1.5;">${msg}</p></div>
      <div class="modal-footer"><button class="btn btn-outline cancel-confirm">取消</button><button class="btn btn-primary confirm-confirm">确认</button></div>
    </div>`;
        document.body.appendChild(o);
        const c = v => { o.style.display = 'none'; setTimeout(() => o.remove(), 180); r(v); };
        o.querySelector('.close-confirm').onclick = () => c(false);
        o.querySelector('.cancel-confirm').onclick = () => c(false);
        o.querySelector('.confirm-confirm').onclick = () => c(true);
        o.addEventListener('click', e => { if (e.target === o) c(false); });
    });
}

/* ============================================================
 * 复制 / 下载
 * ============================================================ */
function copyText(t, okMsg) {
    try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) showToast(okMsg || '已复制', 'success');
        else showToast('复制失败', 'error');
        return ok;
    } catch (e) {
        showToast('复制失败', 'error');
        return false;
    }
}
function downloadTxt(t, name) {
    const b = new Blob([t], { type: 'text/plain;charset=utf-8' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = name || nowFileName();
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(u);
}

function openModal(id) { const el = document.getElementById(id); if (el) el.classList.add('show'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('show'); }
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('show');
});

/* ============================================================
 * 复制状态
 * ============================================================ */
const COPIED_KEY = 'transCopied_v7';
let COPIED = {};
try { COPIED = JSON.parse(localStorage.getItem(COPIED_KEY)) || {}; } catch (e) { COPIED = {}; }

function getCopied(transId) {
    if (!COPIED[transId]) COPIED[transId] = [];
    return COPIED[transId];
}
function isCopied(transId, idx) { return getCopied(transId).indexOf(idx) >= 0; }
function markCopied(transId, idx) {
    const arr = getCopied(transId);
    if (arr.indexOf(idx) < 0) {
        arr.push(idx);
        try { localStorage.setItem(COPIED_KEY, JSON.stringify(COPIED)); } catch (e) { }
    }
}
function langCopyProgress(trans) {
    if (!trans || !trans.lines) return { done: 0, total: 0 };
    const textItem = textList.find(x => x.id === trans.fromTextId);
    const origDeleted = (textItem && textItem.deletedLines) || [];
    const copied = getCopied(trans.id);
    const visibleIdx = trans.lines
        .map((_, i) => i)
        .filter(i => !origDeleted.includes(i));
    const done = visibleIdx.filter(i => copied.indexOf(i) >= 0).length;
    return { done, total: visibleIdx.length };
}
function isLangDone(trans) {
    if (!trans || !trans.lines) return false;
    const p = langCopyProgress(trans);
    return p.total > 0 && p.done === p.total;
}

/* ============================================================
 * 工作流
 * ============================================================ */
function updateWorkflowSteps() {
    const s = {
        u: document.getElementById('stepUpload'),
        t: document.getElementById('stepTranscribe'),
        r: document.getElementById('stepTranslate'),
        a: document.getElementById('stepAudio')
    };
    Object.values(s).forEach(x => x && (x.className = 'workflow-step'));
    if (fileList.length > 0) s.u?.classList.add('done');
    if (textList.length > 0) s.t?.classList.add('done');
    if (transList.length > 0) s.r?.classList.add('done');
    if (audioList.length > 0) s.a?.classList.add('done');
    if (isTranscribing) s.t?.classList.add('active');
}

/* ============================================================
 * 文件上传
 * ============================================================ */
const uploadZone = document.getElementById('uploadZone');
if (uploadZone) {
    uploadZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        this.style.borderColor = '#4f5bd5';
    });
    uploadZone.addEventListener('dragleave', function (e) {
        e.preventDefault();
        this.style.borderColor = '#d5d8de';
    });
    uploadZone.addEventListener('drop', function (e) {
        e.preventDefault();
        this.style.borderColor = '#d5d8de';
        const f = e.dataTransfer.files;
        if (f && f.length) processFiles(Array.from(f));
    });
}
function handleFileInput(e) {
    const f = e.target.files;
    if (f && f.length) processFiles(Array.from(f));
    e.target.value = '';
}
function processFiles(files) {
    files.forEach(f => {
        const isVid = f.type.startsWith('video/');
        const isAud = f.type.startsWith('audio/');
        if (!isVid && !isAud) { showToast(f.name + ' 不是音视频文件，已跳过', 'warning'); return; }
        if (f.size > 1024 * 1024 * 1024) { showToast(f.name + ' 超过1GB，已跳过', 'warning'); return; }
        if (fileList.some(item => item.name === f.name && item.size === f.size)) {
            showToast(f.name + ' 已存在', 'warning'); return;
        }
        fileList.push({ uid: genId(), name: f.name, size: f.size, raw: f });
    });
    renderFileList();
    updateWorkflowSteps();
    if (!isTranscribing && fileList.length > 0) {
        setTimeout(() => { if (!isTranscribing && fileList.length > 0) startTranscribe(); }, 300);
    }
}
function removeFile(i) { fileList.splice(i, 1); renderFileList(); updateWorkflowSteps(); }

function renderFileList() {
    const s = document.getElementById('fileListSection'),
        c = document.getElementById('fileListContainer'),
        t = document.getElementById('fileListTitle');
    if (!s) return;
    if (fileList.length === 0) {
        s.style.display = 'none';
        syncUploadZone();
        updateWorkflowSteps();
        return;
    }
    s.style.display = 'block';
    t.textContent = '已选择文件 (' + fileList.length + ')';
    c.innerHTML = fileList.map((f, i) =>
        `<div class="file-item">
      <span class="fi-icon">F</span>
      <div class="fi-info">
        <div class="fi-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
        <div class="fi-size">${formatSize(f.size)}</div>
      </div>
      <button class="fi-del" onclick="removeFile(${i})" title="移除">&times;</button>
    </div>`
    ).join('');
    syncUploadZone();
    updateWorkflowSteps();
}
function syncUploadZone() {
    const zone = document.getElementById('uploadZone');
    const fs = document.getElementById('fileListSection');
    const fl = document.getElementById('fileListTitle');
    if (!zone || !fs) return;
    const textEl = zone.querySelector('.upload-text');
    if (!textEl) return;
    const visible = fs.style.display !== 'none' && fs.style.display !== '';
    if (visible) {
        zone.classList.add('is-collapsed');
        const m = fl ? fl.textContent.match(/(\d+)/) : null;
        const n = m ? m[1] : '0';
        textEl.innerHTML = '已选 ' + n + ' 个文件 · <span>点击继续添加</span>';
    } else {
        zone.classList.remove('is-collapsed');
        textEl.innerHTML = '拖拽文件到此处，或<span>点击上传</span>';
    }
}

/* ============================================================
 * 转录
 * ============================================================ */
async function startTranscribe() {
    if (fileList.length === 0) return showToast('请先选择文件', 'warning');
    if (isTranscribing) return;
    isTranscribing = true;
    updateWorkflowSteps();
    const ps = document.getElementById('progressSection'),
        pf = document.getElementById('progressFill'),
        pl = document.getElementById('progressLabel'),
        btn = document.getElementById('transcribeBtn');
    if (ps) ps.style.display = 'block';
    if (btn) { btn.disabled = true; btn.textContent = '转录中...'; }
    if (pf) pf.className = 'progress-fill progress-indeterminate';
    if (pl) pl.textContent = '正在处理: ' + fileList[0].name;

    try {
        for (let i = 0; i < fileList.length; i++) {
            const fi = fileList[i];
            if (pl) pl.textContent = `处理中 (${i + 1}/${fileList.length}): ${fi.name}`;
            const fd = new FormData();
            const isV = fi.raw.type.startsWith('video/');
            const url = isV ? '/api/transcribe' : '/api/transcribe-audio';
            fd.append(isV ? 'video' : 'audio', fi.raw);
            const res = await fetch(BASE + url, { method: 'POST', body: fd });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (isV) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop() || '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const d = JSON.parse(line.slice(6));
                                if (d.type === 'complete') {
                                    addTextFromTranscribe(fi.name, d.data.originalTranscription || '', d.data.chineseTranscription || '');
                                    renderMainList();
                                }
                            } catch (e) { }
                        }
                    }
                }
            } else {
                const json = await res.json();
                addTextFromTranscribe(fi.name, json.originalTranscription || '', json.chineseTranscription || '');
                renderMainList();
            }
        }
        if (pf) { pf.className = 'progress-fill'; pf.style.width = '100%'; }
        if (pl) pl.textContent = '转录完成';
        renderMainList();
        updateWorkflowSteps();
        showToast('转录完成，共 ' + textList.length + ' 条文案', 'success');
    } catch (err) {
        if (pl) pl.textContent = '转录失败: ' + err.message;
        showToast('转录失败: ' + err.message, 'error');
    } finally {
        isTranscribing = false;
        if (btn) { btn.disabled = false; btn.textContent = '开始转录'; }
        updateWorkflowSteps();
        setTimeout(() => {
            if (ps) ps.style.display = 'none';
            if (pf) { pf.style.width = '0%'; pf.className = 'progress-fill'; }
        }, 2200);
    }
}
function addTextFromTranscribe(source, origin, text) {
    textList.push({
        id: genId(),
        source,
        origin,
        lines: splitText(text),
        deletedLines: []
    });
}

/* ============================================================
 * 数据查找
 * ============================================================ */
function getTransOfText(textId) { return transList.filter(t => t.fromTextId === textId); }
function getAudioForTrans(trans) {
    if (!trans) return null;
    return audioList.find(a => a.fromTransId === trans.id) || null;
}
function sortLangs(langs) {
    const order = ['zh', 'en', 'pt', 'jp', 'kr', 'id', 'hi', 'ar'];
    return langs.slice().sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
}

/* ============================================================
 * 主列表渲染
 * ============================================================ */
function renderMainList() {
    const c = document.getElementById('mainListContainer');
    if (!c) return;
    const lc = document.getElementById('listCount');
    if (lc) lc.textContent = textList.length;
    if (textList.length === 0) {
        c.innerHTML = '<div class="empty-state"><div class="empty-icon">文</div><div class="empty-text">暂无文案</div><div class="empty-sub">上传文件开始转录，或点击「+ 新增文案」手动输入</div></div>';
        updateWorkflowSteps();
        return;
    }
    c.innerHTML = textList.map((item, i) => renderCard(item, i)).join('');
    updateWorkflowSteps();
}

function renderCard(item, idx) {
    const trans = getTransOfText(item.id);
    const langs = sortLangs([...new Set(trans.map(t => t.lang))]);
    const curLang = (cardState[item.id] && cardState[item.id].lang) || (langs[0] || '');
    if (curLang) {
        if (!cardState[item.id]) cardState[item.id] = {};
        cardState[item.id].lang = curLang;
    }

    const deletedLines = item.deletedLines || [];
    const originLinesHtml = item.lines.map((line, i) => {
        const deleted = deletedLines.includes(i);
        return `<div class="oline${deleted ? ' deleted' : ''}">
      <span class="no">${i + 1}</span>
      <span class="tx" contenteditable="${deleted ? 'false' : 'true'}"
        onblur="updateOriginLine('${escapeAttr(item.id)}',${i},this.textContent)">${escapeHtml(line)}</span>
      <button class="rm" onclick="toggleOriginLineDel('${escapeAttr(item.id)}',${i})"
        title="${deleted ? '撤回此行' : '删除此行（译文同步隐藏）'}">${deleted ? '↺' : '✕'}</button>
    </div>`;
    }).join('');

    const colorClass = 'c' + (idx % 4);

    return `
  <div class="mcard ${colorClass}" data-textid="${escapeAttr(item.id)}">
    <div class="mcard-head">
      <span class="no">${idx + 1}</span>
      <span class="src" title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</span>
      <div class="head-actions">
        <button class="btn btn-outline btn-xs" onclick="singleTranslate('${escapeAttr(item.id)}')">翻译</button>
        <button class="btn btn-outline btn-xs" onclick="openTtsForCard('${escapeAttr(item.id)}')">语音</button>
        <button class="btn btn-ghost btn-xs danger" onclick="deleteTextById('${escapeAttr(item.id)}')">删除</button>
      </div>
    </div>
    <div class="mcard-origin">
      <div class="label-row">原文<button class="btn btn-ghost btn-xs add-line-btn" onclick="addOriginLine('${escapeAttr(item.id)}')">+ 添加行</button></div>
      <div class="origin-lines">${originLinesHtml}</div>
    </div>
    ${langs.length > 0
            ? renderLangTabs(item, trans, curLang) + renderLangPanes(item, trans, curLang)
            : `<div class="lang-tabs"><span class="empty-hint">还没有译文，点右上「翻译」生成</span></div>`}
  </div>`;
}

function renderLangTabs(item, trans, curLang) {
    const langs = sortLangs([...new Set(trans.map(t => t.lang))]);
    return `<div class="lang-tabs">${langs.map(lang => {
        const t = trans.find(x => x.lang === lang);
        const done = t && isLangDone(t);
        const p = t ? langCopyProgress(t) : { done: 0, total: 0 };
        const active = lang === curLang;
        return `<button class="lang-tab${active ? ' active' : ''}${done ? ' done' : ''}"
      data-lang="${escapeAttr(lang)}" data-transid="${escapeAttr(t ? t.id : '')}"
      onclick="switchLangTab('${escapeAttr(item.id)}','${escapeAttr(lang)}')">
      ${escapeHtml(getLangName(lang))}
      <span class="cnt">${p.done}/${p.total}${done ? ' ✓' : ''}</span>
    </button>`;
    }).join('')}
  <button class="btn-tts-all" onclick="openTtsForCard('${escapeAttr(item.id)}')">
    全部语言生成语音
  </button>
  </div>`;
}

function renderLangPanes(item, trans, curLang) {
    return trans.map(t => renderLangPane(item, t, t.lang === curLang)).join('');
}

function renderLangPane(item, t, isActive) {
    const lines = t.lines || [];
    const audio = getAudioForTrans(t);
    const textItem = textList.find(x => x.id === t.fromTextId);
    const origDeleted = (textItem && textItem.deletedLines) || [];

    const visibleIdx = lines.map((_, i) => i).filter(i => !origDeleted.includes(i));

    const visibleLinesHtml = lines.map((line, i) => {
        if (origDeleted.includes(i)) return '';
        const done = isCopied(t.id, i);
        return `<div class="line${done ? ' done' : ''}" data-transid="${escapeAttr(t.id)}" data-idx="${i}">
      <span class="no">${i + 1}</span>
      <span class="tx" contenteditable="true"
        onblur="updateTransLine('${escapeAttr(t.id)}',${i},this.textContent)">${escapeHtml(line)}</span>
      <button class="cp${done ? ' done' : ''}"
        onclick="copyLine('${escapeAttr(t.id)}',${i},this)">
        ${done ? '已复制 ✓' : '复制'}
      </button>
    </div>`;
    }).join('');

    const failErr = audio ? '' : (ttsFailedMap[t.id] || '');
    const audioHtml = audio
        ? `<div class="audio-inline">
        <div class="ai-head">
          <button class="play-btn" id="playBtn_${escapeAttr(t.id)}"
            onclick="togglePlayInline('${escapeAttr(t.id)}')">▶</button>
          <span class="ai-name" title="${escapeHtml(audio.display || audio.file)}">${escapeHtml(audio.display || audio.file)}</span>
          <button class="ai-dl"
            onclick="downloadAudioFile('${escapeAttr(audio.file)}','${escapeAttr(audio.display || audio.file)}')">下载</button>
        </div>
        <div class="ai-bar" onclick="seekInline(event,'${escapeAttr(t.id)}')">
          <div class="ai-fill" id="aiFill_${escapeAttr(t.id)}" style="width:0%;"></div>
        </div>
        <div class="ai-foot">
          <span id="aiCur_${escapeAttr(t.id)}">0:00</span>
          <span id="aiDur_${escapeAttr(t.id)}">0:00</span>
        </div>
        <audio id="audioEl_${escapeAttr(t.id)}" style="display:none;" preload="metadata"
          src="${BASE}/api/download-audio/${encodeURIComponent(audio.file)}"></audio>
      </div>`
        : (failErr
            ? `<div class="tts-failed">
          <span class="tts-failed-tip" title="${escapeAttr(failErr)}">语音生成失败：${escapeHtml(failErr)}</span>
          <button class="btn btn-outline btn-xs" onclick="retryTtsSingle('${escapeAttr(t.id)}',this)">重新生成语音</button>
        </div>`
            : '');

    const paneActionsHtml = visibleIdx.length > 0
        ? `<div class="pane-actions">
      <button class="btn btn-outline btn-xs" onclick="copyAllTransLines('${escapeAttr(t.id)}',this)">复制全部译文</button>
      <span class="pane-hint">共 ${visibleIdx.length} 行</span>
    </div>`
        : '';

    return `
  <div class="lang-pane${isActive ? ' active' : ''}" data-lang="${escapeAttr(t.lang)}">
    ${paneActionsHtml}
    <div class="lines">${visibleLinesHtml || '<div style="color:#999;font-size:12px;padding:6px;">该语言暂无可见译文行</div>'}</div>
    ${audioHtml}
  </div>`;
}

/* ============================================================
 * 交互
 * ============================================================ */
function updateOriginLine(textId, idx, val) {
    const t = textList.find(x => x.id === textId);
    if (t && t.lines[idx] !== undefined) t.lines[idx] = val;
}
function updateTransLine(transId, idx, val) {
    const t = transList.find(x => x.id === transId);
    if (!t || !t.lines) return;
    if (t.lines[idx] !== undefined) {
        t.lines[idx] = val;
        t.text = t.lines.join('\n');
    }
}

/* 新增：追加一行原文并自动聚焦 */
function addOriginLine(textId) {
    const t = textList.find(x => x.id === textId);
    if (!t) return;
    t.lines.push('');
    renderMainList();
    setTimeout(() => {
        const card = document.querySelector(`.mcard[data-textid="${textId}"]`);
        if (!card) return;
        const els = card.querySelectorAll('.mcard-origin .oline .tx');
        const last = els[els.length - 1];
        if (!last) return;
        last.focus();
        try {
            const range = document.createRange();
            range.selectNodeContents(last);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) { }
    }, 0);
}

function toggleOriginLineDel(textId, idx) {
    const t = textList.find(x => x.id === textId);
    if (!t) return;
    if (!t.deletedLines) t.deletedLines = [];
    const p = t.deletedLines.indexOf(idx);
    if (p >= 0) {
        t.deletedLines.splice(p, 1);
        renderMainList();
        showToast('已撤回该行', 'success');
    } else {
        t.deletedLines.push(idx);
        renderMainList();
        showToast('已删除该行（译文同步隐藏）', 'info');
    }
}

function switchLangTab(textId, lang) {
    if (!cardState[textId]) cardState[textId] = {};
    cardState[textId].lang = lang;
    const card = document.querySelector(`.mcard[data-textid="${textId}"]`);
    if (!card) return;
    card.querySelectorAll('.lang-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.lang === lang);
    });
    card.querySelectorAll('.lang-pane').forEach(pane => {
        pane.classList.toggle('active', pane.dataset.lang === lang);
    });
}

function copyLine(transId, idx, btn) {
    const t = transList.find(x => x.id === transId);
    if (!t || !t.lines || t.lines[idx] === undefined) return;
    if (btn) {
        btn.classList.add('done');
        btn.textContent = '已复制 ✓';
        const lineEl = btn.closest('.line');
        if (lineEl) lineEl.classList.add('done');
    }
    markCopied(transId, idx);
    updateLangTab(transId);
    copyText(t.lines[idx]);
}
function updateLangTab(transId) {
    const t = transList.find(x => x.id === transId);
    if (!t) return;
    const tab = document.querySelector(`.lang-tab[data-transid="${transId}"]`);
    if (!tab) return;
    const p = langCopyProgress(t);
    const done = p.total > 0 && p.done === p.total;
    tab.classList.toggle('done', done);
    tab.innerHTML = `${escapeHtml(getLangName(t.lang))} <span class="cnt">${p.done}/${p.total}${done ? ' ✓' : ''}</span>`;
}

function copyAllTransLines(transId, btn) {
    const t = transList.find(x => x.id === transId);
    if (!t || !t.lines) return;
    const textItem = textList.find(x => x.id === t.fromTextId);
    const origDeleted = (textItem && textItem.deletedLines) || [];
    const visibleIdx = t.lines.map((_, i) => i).filter(i => !origDeleted.includes(i));
    const parts = visibleIdx
        .map(i => String(t.lines[i] || ''))
        .filter(s => s.trim());

    if (!parts.length) return showToast('没有可复制的译文', 'warning');
    if (!copyText(parts.join('\n'), `已复制全部 ${parts.length} 行译文`)) return;

    visibleIdx.forEach(i => markCopied(transId, i));

    const pane = btn ? btn.closest('.lang-pane') : null;
    if (pane) {
        pane.querySelectorAll('.line').forEach(lineEl => {
            const idx = parseInt(lineEl.dataset.idx, 10);
            if (origDeleted.includes(idx)) return;
            lineEl.classList.add('done');
            const cp = lineEl.querySelector('.cp');
            if (cp) { cp.classList.add('done'); cp.textContent = '已复制 ✓'; }
        });
    }

    updateLangTab(transId);
}

/* ============================================================
 * 内嵌音频
 * ============================================================ */
let currentInlineAudio = null;
let currentInlineId = null;
function togglePlayInline(transId) {
    const el = document.getElementById('audioEl_' + transId);
    const btn = document.getElementById('playBtn_' + transId);
    if (!el || !btn) return;
    if (!el.paused) {
        el.pause();
        btn.textContent = '▶';
        return;
    }
    if (currentInlineAudio && currentInlineAudio !== el) {
        try { currentInlineAudio.pause(); } catch (e) { }
        if (currentInlineId) {
            const pb = document.getElementById('playBtn_' + currentInlineId);
            if (pb) pb.textContent = '▶';
        }
    }
    currentInlineAudio = el; currentInlineId = transId;
    el.volume = 0.7;
    el.play().then(() => { btn.textContent = '⏸'; })
        .catch(() => { showToast('音频加载失败', 'error'); btn.textContent = '▶'; });
    if (!el.dataset.bound) {
        el.addEventListener('timeupdate', () => {
            const cur = document.getElementById('aiCur_' + transId);
            const dur = document.getElementById('aiDur_' + transId);
            const fill = document.getElementById('aiFill_' + transId);
            if (!cur || !dur || !fill || !el.duration) return;
            cur.textContent = formatTime(el.currentTime);
            dur.textContent = formatTime(el.duration);
            fill.style.width = (el.currentTime / el.duration * 100) + '%';
        });
        el.addEventListener('ended', () => {
            btn.textContent = '▶';
            const fill = document.getElementById('aiFill_' + transId);
            if (fill) fill.style.width = '0%';
        });
        el.dataset.bound = '1';
    }
}
function seekInline(e, transId) {
    const el = document.getElementById('audioEl_' + transId);
    if (!el || !el.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    el.currentTime = p * el.duration;
}

/* ============================================================
 * AI 调用 / 整体翻译（本土化）
 * ============================================================ */
async function aiChat(prompt, { temperature = 0.3, retries = 2, timeout = AI_TRANSLATE_TIMEOUT } = {}) {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            const res = await fetch(AI_CONFIG.apiUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${AI_CONFIG.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: AI_CONFIG.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature
                }),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) {
                const et = await res.text().catch(() => '');
                throw new Error('HTTP ' + res.status + (et ? ' ' + et.slice(0, 120) : ''));
            }
            const json = await res.json();
            const content = json.choices && json.choices[0] && json.choices[0].message
                ? String(json.choices[0].message.content || '').trim()
                : '';
            if (!content) throw new Error('Empty response');
            return content;
        } catch (err) {
            console.error(`AI请求错误 (尝试 ${i + 1}/${retries + 1}):`, err);
            if (i === retries) throw err;
            await delay(400 * (i + 1));
        }
    }
}

function buildTranslatePrompt(chunk, langName) {
    const body = chunk.map(c => `${c.no}. ${c.text}`).join('\n');
    return `你是资深本地化译者。请将下列带编号的文本逐条翻译成【${langName}】。

严格遵循：
1. 每条与输入编号一一对应，输出格式必须是“编号. 译文”。
2. 不合并、不拆分、不遗漏任何编号；输入多少条，输出就多少条。
3. 保持原意与句式结构，不增删信息。
4. 使用【${langName}】母语者日常自然、地道的表达（本土化），避免逐字直译与翻译腔。
5. 只输出翻译结果，不要解释、不要加代码块标记、不要额外空行。

原文：
${body}

翻译结果：`;
}

function parseNumberedTranslation(text, expectedNos) {
    const map = new Map();
    const lines = String(text).replace(/\r/g, '').split('\n');
    let curNo = null;
    for (let raw of lines) {
        const line = raw.replace(/\*\*/g, '').trim();
        if (!line) continue;
        const m = line.match(/^(\d+)\s*[.、．:：)\]]\s*(.*)$/);
        if (m) {
            curNo = parseInt(m[1], 10);
            map.set(curNo, (m[2] || '').trim());
        } else if (curNo !== null) {
            const prev = map.get(curNo) || '';
            map.set(curNo, prev ? prev + ' ' + line : line);
        }
    }
    if (map.size === 0) {
        const arr = lines.map(s => s.replace(/\*\*/g, '').trim()).filter(Boolean);
        expectedNos.forEach((no, i) => map.set(no, arr[i] || ''));
    }
    expectedNos.forEach(no => { if (!map.has(no)) map.set(no, ''); });
    return map;
}

async function translateTextItem(textItem, langName) {
    const linesSrc = textItem.lines || [];
    const deleted = textItem.deletedLines || [];
    const active = [];
    linesSrc.forEach((lineText, idx) => {
        if (deleted.includes(idx)) return;
        if (!lineText || !lineText.trim()) return;
        active.push({ no: idx + 1, text: lineText });
    });
    if (active.length === 0) return new Array(linesSrc.length).fill('');

    const chunks = [];
    let cur = [], curLen = 0;
    for (const item of active) {
        const add = item.text.length + 8;
        if (curLen + add > AI_TRANSLATE_MAX_CHARS && cur.length > 0) {
            chunks.push(cur);
            cur = []; curLen = 0;
        }
        cur.push(item);
        curLen += add;
    }
    if (cur.length) chunks.push(cur);

    const chunkResults = await Promise.all(chunks.map(async chunk => {
        const prompt = buildTranslatePrompt(chunk, langName);
        const raw = await aiChat(prompt, { temperature: 0.3, timeout: AI_TRANSLATE_TIMEOUT });
        return { chunk, map: parseNumberedTranslation(raw, chunk.map(c => c.no)) };
    }));

    const out = new Array(linesSrc.length).fill('');
    for (const { chunk, map } of chunkResults) {
        for (const item of chunk) {
            const t = map.get(item.no);
            if (t !== undefined) out[item.no - 1] = t;
        }
    }
    return out;
}

/* ============================================================
 * 翻译入口（整体翻译 + 多语言并行）
 * ============================================================ */
function singleTranslate(textId) {
    const t = textList.find(x => x.id === textId);
    if (t) openTranslateDialog([t]);
}
function openTranslateDialog(items = null) {
    pendingTranslateItems = items && items.length > 0 ? items : textList.slice();
    if (pendingTranslateItems.length === 0) return showToast('请先添加文案', 'warning');
    document.getElementById('translateInput').value = '';
    document.getElementById('translateProgress').style.display = 'none';
    document.getElementById('translateFailedList').style.display = 'none';
    document.getElementById('translateFooter').style.display = 'flex';
    document.getElementById('modalTranslateClose').style.display = '';
    document.getElementById('btnConfirmTranslate').disabled = false;
    openModal('modalTranslate');
    document.getElementById('translateInput').focus();
    document.getElementById('translateInput').onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); executeTranslate(); }
    };
}

async function executeTranslate() {
    const rawInput = document.getElementById('translateInput').value.trim();
    if (!rawInput) return showToast('请输入目标语言', 'warning');

    const KNOWN_LANG_NAMES = new Set(Object.values(LANG_CODE_MAP));
    const cleaned = rawInput.replace(
        /^\s*(?:请|帮我|帮忙|给我|把|将)?\s*(?:翻译成|翻译为|翻译|译成|译为|译|转成|转为|转)\s*[:：]?\s*/i,
        ''
    );

    const isLangToken = t => {
        const raw = String(t || '').trim();
        if (!raw) return false;
        const k = raw.toLowerCase();
        if (LANG_CODE_MAP[k]) return true;
        if (KNOWN_LANG_NAMES.has(raw)) return true;
        if (/^[a-z]{2,3}$/.test(k)) return true;
        return false;
    };

    const parts = cleaned
        .split(/[,，\n\/／|、;；+＋\s]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .filter(isLangToken);

    if (!parts.length) {
        return showToast('未识别到有效目标语言，请输入如：es/pt/de/fr/hi', 'warning');
    }

    const mappedParts = parts.map(p => LANG_CODE_MAP[p.toLowerCase()] || p);
    const input = mappedParts.join(',');

    const btn = document.getElementById('btnConfirmTranslate');
    const pd = document.getElementById('translateProgress');
    const pl = document.getElementById('translateProgressLabel');
    const pf = document.getElementById('translateProgressFill');
    const ft = document.getElementById('translateFooter');
    const cb = document.getElementById('modalTranslateClose');
    const fd = document.getElementById('translateFailedList');

    btn.disabled = true;
    ft.style.display = 'none';
    pd.style.display = 'block';
    fd.style.display = 'none';
    if (cb) cb.style.display = 'none';

    try {
        const lr = await fetch(BASE + '/api/extract-target-languages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ languageInstruction: input })
        });
        if (!lr.ok) throw new Error('语言解析失败');
        const lj = await lr.json();
        let langs = lj.extractedLanguages || [];
        if (!langs.length) throw new Error('未识别到有效目标语言');

        const seen = new Set();
        langs = langs.filter(lo => {
            const code = String(lo.ttsCode || lo.language || '').toLowerCase();
            if (seen.has(code)) return false;
            seen.add(code);
            return true;
        });

        const sel = pendingTranslateItems || [];
        if (sel.length === 0) throw new Error('没有可翻译的条目');
        pendingTranslateItems = null;

        const tasks = [];
        sel.forEach(textItem => {
            langs.forEach(lo => {
                const lc = lo.ttsCode || lo.language || '';
                tasks.push({ textItem, lc, langName: getLangName(lo.language) });
            });
        });

        const total = tasks.length;
        let done = 0;
        const failed = [];
        const newTransList = [];

        pl.textContent = `正在翻译... 0/${total}`;
        pf.style.width = '0%';

        await Promise.allSettled(tasks.map(task =>
            translateTextItem(task.textItem, task.langName)
                .then(lines => {
                    if (lines && lines.length) {
                        newTransList.push({
                            id: genId(),
                            lang: task.lc,
                            fromTextId: task.textItem.id,
                            lines,
                            text: lines.join('\n'),
                            source: task.textItem.source + ' - ' + task.langName
                        });
                    }
                })
                .catch(err => {
                    failed.push({
                        text: task.textItem.source,
                        lang: task.langName,
                        error: err.message || '未知错误'
                    });
                })
                .then(() => {
                    done++;
                    pl.textContent = `正在翻译... ${done}/${total}`;
                    pf.style.width = ((done / total) * 100) + '%';
                })
        ));

        transList.push(...newTransList);
        renderMainList();

        if (failed.length > 0) {
            fd.style.display = 'block';
            fd.innerHTML = `<div class="failed-list"><strong>以下 ${failed.length} 项翻译失败：</strong>${failed.map(f => '&bull; "' + escapeHtml(f.text) + '" → ' + f.lang + ' (' + f.error + ')').join('<br>')}</div>`;
            showToast(`翻译部分完成：${newTransList.length} 成功，${failed.length} 失败`, 'warning');
        } else {
            closeModal('modalTranslate');
            showToast(`翻译完成，共 ${newTransList.length} 个语种`, 'success');
        }
    } catch (err) {
        showToast('翻译失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        ft.style.display = 'flex';
        pd.style.display = 'none';
        if (cb) cb.style.display = '';
        pendingTranslateItems = null;
    }
}

/* ============================================================
 * 新增 / 删除
 * ============================================================ */
function addTextManually() {
    document.getElementById('addTextInput').value = '';
    openModal('modalAddText');
}
function saveAddText() {
    const v = document.getElementById('addTextInput').value.trim();
    if (!v) return showToast('请输入内容', 'warning');
    textList.push({
        id: genId(),
        source: '手动输入',
        origin: '',
        lines: splitText(v),
        deletedLines: []
    });
    closeModal('modalAddText');
    renderMainList();
    showToast('文案已添加', 'success');
}
function deleteTextById(textId) {
    const transOfThis = transList.filter(x => x.fromTextId === textId);
    transOfThis.forEach(tr => {
        delete COPIED[tr.id];
        delete ttsFailedMap[tr.id];
    });
    delete ttsFailedMap['orig_' + textId];
    textList = textList.filter(x => x.id !== textId);
    transList = transList.filter(x => x.fromTextId !== textId);
    audioList = audioList.filter(x => x.fromTextId !== textId);
    delete cardState[textId];
    try { localStorage.setItem(COPIED_KEY, JSON.stringify(COPIED)); } catch (e) { }
    renderMainList();
    showToast('已删除', 'success');
}

/* ============================================================
 * 下载音频
 * ============================================================ */
async function downloadAudioFile(fn, dn) {
    try {
        const r = await fetch(BASE + '/api/download-audio/' + encodeURIComponent(fn), {
            method: 'GET', headers: { 'Accept': 'audio/*,*/*' }
        });
        if (!r.ok) throw new Error('下载失败');
        const b = await r.blob();
        const u = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = u; a.download = dn || fn;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(u), 3000);
    } catch (e) {
        window.open(BASE + '/api/download-audio/' + encodeURIComponent(fn), '_blank');
    }
}

/* ============================================================
 * TTS 设置
 * ============================================================ */
function saveTtsSettings() {
    const settings = {
        model: document.getElementById('ttsModel').value,
        voice: document.getElementById('ttsVoice').value,
        interval: document.getElementById('ttsInterval').value,
        useTextName: document.getElementById('ttsUseTextName').checked
    };
    localStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(settings));
}
function loadTtsSettings() {
    const saved = localStorage.getItem(TTS_SETTINGS_KEY);
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            const m = document.getElementById('ttsModel');
            if (settings.model && m) m.value = settings.model;
            if (settings.interval !== undefined) {
                document.getElementById('ttsInterval').value = settings.interval;
                document.getElementById('ttsIntervalVal').textContent = settings.interval;
            }
            if (settings.useTextName !== undefined) {
                document.getElementById('ttsUseTextName').checked = settings.useTextName;
            }
            return settings;
        } catch (e) { }
    }
    return null;
}
async function loadVoiceOptions(m) {
    const s = document.getElementById('ttsVoice');
    if (!s) return;
    s.innerHTML = '<option value="">加载中...</option>';
    if (voiceListCache[m] && voiceListCache[m].length > 0) {
        s.innerHTML = voiceListCache[m].map(v => `<option value="${v.name}">${v.dname}</option>`).join('');
        return;
    }
    try {
        const r = await fetch(BASE + '/api/voice-options?model=' + m);
        const j = await r.json();
        const v = (j.voices || []).map(x => ({ name: x.name, dname: x.displayName || x.name }));
        voiceListCache[m] = v;
        s.innerHTML = v.map(x => `<option value="${x.name}">${x.dname}</option>`).join('');
    } catch (e) {
        s.innerHTML = '<option value="">加载失败</option>';
    }
}
async function onTtsModelChange() {
    const m = document.getElementById('ttsModel').value;
    document.getElementById('ttsIntervalRow').style.display = m === 'google' ? 'block' : 'none';
    await loadVoiceOptions(m);
    saveTtsSettings();
}
async function playVoiceDemo() {
    const voice = document.getElementById('ttsVoice').value;
    const model = document.getElementById('ttsModel').value;
    if (!voice) return showToast('请先选择音色', 'warning');
    const btn = document.getElementById('btnVoiceDemo');
    btn.disabled = true; btn.textContent = '...';
    const a = document.getElementById('demoAudio');
    a.src = BASE + '/api/voice-sample/' + encodeURIComponent(voice) + '?model=' + model;
    a.volume = 0.6;
    try { await a.play(); showToast('试听中...', 'info'); } catch (e) { showToast('试听失败', 'error'); }
    a.onended = () => { btn.disabled = false; btn.textContent = '试听'; };
    a.onerror = () => { btn.disabled = false; btn.textContent = '试听'; showToast('试听加载失败', 'error'); };
    setTimeout(() => { if (!a.ended && a.src) { btn.disabled = false; btn.textContent = '试听'; } }, 7000);
}

/* ============================================================
 * 语音生成
 * ============================================================ */

/* 根据 transId 还原 TTS item（含无译文时的伪条目 orig_<textId>） */
function getTtsItemById(transId) {
    const t = transList.find(x => x.id === transId);
    if (t) return t;
    if (String(transId).startsWith('orig_')) {
        const textId = transId.slice(5);
        const textItem = textList.find(x => x.id === textId);
        if (!textItem) return null;
        const deleted = textItem.deletedLines || [];
        const text = textItem.lines
            .filter((_, i) => !deleted.includes(i))
            .join('\n')
            .trim();
        if (!text) return null;
        return {
            id: transId,
            lang: 'zh',
            fromTextId: textId,
            text,
            source: textItem.source
        };
    }
    return null;
}

async function openTtsForCard(textId) {
    const textItem = textList.find(t => t.id === textId);
    if (!textItem) return showToast('文案不存在', 'warning');

    let items = transList.filter(t => t.fromTextId === textId);

    if (items.length === 0) {
        const fallback = getTtsItemById('orig_' + textId);
        if (!fallback) return showToast('该文案没有可生成语音的内容', 'warning');
        items = [fallback];
    }

    pendingTtsItems = items;
    await openTtsDialogInternal(items);
}
async function openTtsDialogInternal(items) {
    const summary = document.getElementById('ttsSummary');
    if (summary) {
        summary.textContent = `即将生成 ${items.length} 个音频，完成后自动下载`;
    }
    const langInput = document.getElementById('ttsLangInput');
    if (langInput) {
        const langs = [...new Set(items.map(i => i.lang))];
        langInput.value = langs.map(l => getLangName(l)).join('、');
    }
    const saved = loadTtsSettings();
    const modelToLoad = saved && saved.model ? saved.model : 'google';
    document.getElementById('ttsModel').value = modelToLoad;
    document.getElementById('ttsInterval').value = saved ? saved.interval || 0.3 : 0.3;
    document.getElementById('ttsIntervalVal').textContent = saved ? saved.interval || 0.3 : 0.3;
    document.getElementById('ttsUseTextName').checked = saved ? saved.useTextName || false : false;
    document.getElementById('ttsProgress').style.display = 'none';
    document.getElementById('ttsFailedList').style.display = 'none';
    document.getElementById('ttsFooter').style.display = 'flex';
    document.getElementById('modalTtsClose').style.display = '';
    document.getElementById('btnConfirmTts').disabled = false;
    await loadVoiceOptions(modelToLoad);
    if (saved && saved.voice) {
        const vs = document.getElementById('ttsVoice');
        if (vs.querySelector(`option[value="${saved.voice}"]`)) vs.value = saved.voice;
    }
    openModal('modalTts');
}

async function generateTtsForTrans(item, voice, model, interval, useTextName, maxRetries = 3) {
    let nt = '';
    if (useTextName && item.fromTextId) {
        const o = textList.find(t => t.id === item.fromTextId);
        if (o && o.lines) nt = o.lines.join('').slice(0, 50).replace(/[\\\/:*?"<>|]/g, '');
    }
    if (!nt && useTextName && item.text) nt = item.text.slice(0, 50).replace(/[\\\/:*?"<>|]/g, '');
    const payload = {
        text: item.text, targetLanguage: item.lang,
        voiceName: voice, model: model,
        paragraphInterval: model === 'google' ? interval : 0,
        useContentFileName: useTextName, namingText: nt,
        skipTranslate: true, transcriptionId: item.id
    };
    let lastErr = '';
    for (let a = 0; a <= maxRetries; a++) {
        try {
            const r = await fetch(BASE + '/api/generate-speech', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!r.ok) {
                const et = await r.text().catch(() => '');
                let ed = 'HTTP ' + r.status;
                try { const ej = JSON.parse(et); ed = ej.details || ej.error || ed; } catch (e) { }
                throw new Error(ed);
            }
            const j = await r.json();
            if (!j.audioFileName) throw new Error('响应中没有音频数据');
            return {
                success: true, item, result: {
                    id: genId(),
                    file: j.audioFileName,
                    display: j.displayFileName || j.audioFileName,
                    source: item.source,
                    lang: item.lang,
                    fromTextId: item.fromTextId,
                    fromTransId: item.id
                }
            };
        } catch (err) {
            lastErr = err.message || '未知错误';
            if (a < maxRetries) {
                const wait = 800 * Math.pow(2, a);
                await new Promise(r => setTimeout(r, wait));
            }
        }
    }
    return { success: false, item, error: lastErr };
}

/* 单条重试：仅重新生成某个 transId 的语音 */
async function retryTtsSingle(transId, btn) {
    const item = getTtsItemById(transId);
    if (!item) return showToast('找不到该译文', 'warning');

    const saved = loadTtsSettings();
    const voice = saved && saved.voice;
    const model = (saved && saved.model) || 'google';
    const interval = saved && saved.interval !== undefined ? (parseFloat(saved.interval) || 0) : 0.3;
    const useTextName = !!(saved && saved.useTextName);

    if (!voice) {
        // 没有保存过音色 → 打开弹窗，让用户先选
        pendingTtsItems = [item];
        await openTtsDialogInternal([item]);
        return;
    }

    const oldText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
    try {
        const res = await generateTtsForTrans(item, voice, model, interval, useTextName, 3);
        if (res.success) {
            delete ttsFailedMap[transId];
            audioList = audioList.filter(a => a.fromTransId !== res.result.fromTransId);
            audioList.push(res.result);
            renderMainList();
            updateWorkflowSteps();
            showToast('语音已重新生成，开始下载', 'success');
            downloadAudioFile(res.result.file, res.result.display || res.result.file);
        } else {
            ttsFailedMap[transId] = res.error || '未知错误';
            renderMainList();
            showToast('重新生成失败：' + (res.error || '未知错误'), 'error');
        }
    } finally {
        if (btn && document.body.contains(btn)) {
            btn.disabled = false;
            btn.textContent = oldText || '重新生成语音';
        }
    }
}

async function executeTts() {
    const voice = document.getElementById('ttsVoice').value;
    const model = document.getElementById('ttsModel').value;
    const interval = parseFloat(document.getElementById('ttsInterval').value) || 0;
    const useTextName = document.getElementById('ttsUseTextName').checked;
    if (!voice) return showToast('请选择音色', 'warning');
    if (pendingTtsItems.length === 0) return showToast('没有待处理的条目', 'warning');

    /* —— 应用「目标语种」输入 —— */
    const langRaw = (document.getElementById('ttsLangInput').value || '').trim();
    if (langRaw) {
        const tokens = langRaw.split(/[,，、;；\/\s]+/).map(s => s.trim()).filter(Boolean);
        if (tokens.length === 1) {
            const code = resolveLangCode(tokens[0], pendingTtsItems);
            pendingTtsItems = pendingTtsItems.map(it => ({ ...it, lang: code }));
        } else if (tokens.length === pendingTtsItems.length) {
            const base = pendingTtsItems;
            pendingTtsItems = base.map((it, i) => ({ ...it, lang: resolveLangCode(tokens[i], base) }));
        } else {
            return showToast(`语种数量(${tokens.length})与待生成条目(${pendingTtsItems.length})不一致`, 'warning');
        }
    }

    saveTtsSettings();
    pendingTtsItems.forEach(it => { delete ttsFailedMap[it.id]; });

    const btn = document.getElementById('btnConfirmTts');
    const pd = document.getElementById('ttsProgress');
    const pl = document.getElementById('ttsProgressLabel');
    const pf = document.getElementById('ttsProgressFill');
    const ft = document.getElementById('ttsFooter');
    const cb = document.getElementById('modalTtsClose');
    const fd = document.getElementById('ttsFailedList');

    btn.disabled = true;
    ft.style.display = 'none';
    pd.style.display = 'block';
    fd.style.display = 'none';
    if (cb) cb.style.display = 'none';

    let remaining = [...pendingTtsItems];
    const successResults = [];
    let finalFailed = [];
    const MAX_ROUNDS = 3;

    try {
        for (let round = 0; round < MAX_ROUNDS && remaining.length > 0; round++) {
            if (round > 0) {
                pl.textContent = `第 ${round + 1} 轮自动重试（${remaining.length} 条）...`;
                await new Promise(r => setTimeout(r, 1500 * round));
            }
            let done = 0;
            const roundTotal = remaining.length;
            const roundFailedItems = [];
            const roundFailedErrors = [];
            pf.style.width = '0%';
            pl.textContent = round === 0
                ? `正在生成... 0/${roundTotal}`
                : `第 ${round + 1} 轮重试... 0/${roundTotal}`;

            await Promise.allSettled(
                remaining.map(item =>
                    generateTtsForTrans(item, voice, model, interval, useTextName, 3)
                        .then(result => {
                            done++;
                            if (result.success) {
                                successResults.push(result.result);
                                delete ttsFailedMap[result.result.fromTransId];
                                audioList = audioList.filter(a => a.fromTransId !== result.result.fromTransId);
                                audioList.push(result.result);
                            } else {
                                roundFailedItems.push(result.item);
                                ttsFailedMap[result.item.id] = result.error || '未知错误';
                                roundFailedErrors.push({
                                    text: (result.item.text || '').slice(0, 50),
                                    error: result.error
                                });
                            }
                            pl.textContent = (round === 0
                                ? `正在生成... ${done}/${roundTotal}`
                                : `第 ${round + 1} 轮重试... ${done}/${roundTotal}`);
                            pf.style.width = ((done / roundTotal) * 100) + '%';
                        })
                )
            );

            finalFailed = roundFailedErrors;
            remaining = roundFailedItems;

            if (successResults.length > 0) {
                renderMainList();
                updateWorkflowSteps();
            }
        }

        renderMainList();

        if (finalFailed.length > 0) {
            fd.style.display = 'block';
            fd.innerHTML = `<div class="failed-list"><strong>${MAX_ROUNDS} 轮自动重试后仍有 ${finalFailed.length} 条失败：</strong>${finalFailed.map(f => '&bull; "' + escapeHtml(f.text) + '…" — ' + f.error).join('<br>')}</div>`;
            showToast(`已完成：${successResults.length} 成功，${finalFailed.length} 失败`, 'warning');
        } else {
            closeModal('modalTts');
            showToast(`语音生成完成，共 ${successResults.length} 个音频，开始自动下载`, 'success');
        }

        if (successResults.length > 0) {
            (async () => {
                for (let i = 0; i < successResults.length; i++) {
                    const a = successResults[i];
                    try {
                        await downloadAudioFile(a.file, a.display || a.file);
                    } catch (e) { }
                    if (i < successResults.length - 1) {
                        await new Promise(r => setTimeout(r, 700));
                    }
                }
            })();
        }

    } catch (err) {
        showToast('语音生成异常: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        ft.style.display = 'flex';
        pd.style.display = 'none';
        if (cb) cb.style.display = '';
        pendingTtsItems = [];
    }
}

/* ============================================================
 * 清空 / 初始化
 * ============================================================ */
async function clearAllData() {
    if (!await showConfirm('确定清空所有数据？此操作不可恢复！')) return;
    if (currentInlineAudio) { try { currentInlineAudio.pause(); } catch (e) { } currentInlineAudio = null; currentInlineId = null; }
    fileList = []; textList = []; transList = []; audioList = []; cardState = {};
    COPIED = {};
    ttsFailedMap = {};
    try { localStorage.removeItem(COPIED_KEY); } catch (e) { }
    const fs = document.getElementById('fileListSection');
    const ps = document.getElementById('progressSection');
    if (fs) fs.style.display = 'none';
    if (ps) ps.style.display = 'none';
    renderFileList();
    renderMainList();
    updateWorkflowSteps();
    showToast('已清空', 'success');
}

document.addEventListener('DOMContentLoaded', () => {
    renderMainList();
    loadVoiceOptions('google');
    updateWorkflowSteps();
    syncUploadZone();

    const ttsModel = document.getElementById('ttsModel');
    const ttsVoice = document.getElementById('ttsVoice');
    const ttsInterval = document.getElementById('ttsInterval');
    const ttsUseTextName = document.getElementById('ttsUseTextName');
    if (ttsModel) ttsModel.addEventListener('change', saveTtsSettings);
    if (ttsVoice) ttsVoice.addEventListener('change', saveTtsSettings);
    if (ttsInterval) ttsInterval.addEventListener('input', () => {
        document.getElementById('ttsIntervalVal').textContent = ttsInterval.value;
        saveTtsSettings();
    });
    if (ttsUseTextName) ttsUseTextName.addEventListener('change', saveTtsSettings);
});