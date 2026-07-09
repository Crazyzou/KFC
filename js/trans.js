const BASE = 'https://149.28.88.166:3005';
let fileList = [];
let textList = [];
let transList = [];
let audioList = [];
let isTranscribing = false;
let currentPlayIdx = -1;
let currentAudioEl = null;
let voiceListCache = { google: [], aliyun: [] };
let pendingTtsItems = [];
const SOURCE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6',
    '#f97316', '#84cc16', '#a855f7', '#22d3ee', '#fb7185', '#2dd4bf', '#eab308'
];

const TTS_SETTINGS_KEY = 'tts_settings';
let pendingTranslateItems = null;

const LANG_CODE_MAP = {
    'hi': '印地语',
    'in': '印地语',
    'sa': '阿拉伯语',
    'ar': '阿拉伯语',
    'ja': '日语',
    'jp': '日语',
    'ko': '韩语',
    'kr': '韩语',
    'pt': '葡萄牙语',
    'en': '英语',
    'zh': '中文',
};

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
            // 应用非异步的部分（model、interval、useTextName）
            const modelSelect = document.getElementById('ttsModel');
            if (settings.model && modelSelect) modelSelect.value = settings.model;

            if (settings.interval !== undefined) {
                document.getElementById('ttsInterval').value = settings.interval;
                document.getElementById('ttsIntervalVal').textContent = settings.interval;
            }
            if (settings.useTextName !== undefined) {
                document.getElementById('ttsUseTextName').checked = settings.useTextName;
            }
            return settings; // 返回以便后续设置 voice 
        } catch (e) { }
    }
    return null;
}

function getSourceColor(fromTextId) {
    if (!fromTextId) return '#c0c5d0'; let hash = 0; for (let i = 0; i < fromTextId
        .length; i++) {
        hash = ((hash << 5) - hash) + fromTextId.charCodeAt(i);
        hash |= 0;
    } return SOURCE_COLORS[Math.abs(hash) % SOURCE_COLORS.length];
}

function getOriginSnippet(fromTextId) {
    if (!fromTextId) return ''; const o = textList.find(t => t.id === fromTextId); if (
        !o || !o.text) return ''; const c = o.text.replace(/\s+/g, ' ').trim(); return c.length > 25 ? c.slice(0, 25) +
            '...' : c;
}

function genId() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }

function formatSize(b) {
    if (!b || b === 0) return '0 B'; const k = 1024,
        arr = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(b) / Math.log(k)); return parseFloat((b / Math.pow(
            k, i)).toFixed(2)) + ' ' + arr[i];
}

function formatTime(s) {
    if (isNaN(s) || s < 0) return '0:00'; const m = Math.floor(s / 60),
        sec = Math.floor(s % 60); return m + ':' + sec.toString().padStart(2, '0');
}

function getLangName(c) {
    const m = { zh: '中文', pt: '葡萄牙语', en: '英语', jp: '日语', kr: '韩语' }; return m[c] || c ||
        '未知';
}

function getBadgeClass(c) {
    const m = {
        zh: 'badge-blue', en: 'badge-green', pt: 'badge-orange', jp: 'badge-gray',
        kr: 'badge-red'
    }; return m[c] || 'badge-gray';
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s; return d.innerHTML;
}

function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g,
        '&lt;').replace(/>/g, '&gt;');
}

function showToast(msg, type = 'info') {
    const e = document.querySelector('.toast-msg'); if (e) e.remove(); const t =
        document.createElement('div');
    t.className = 'toast-msg';
    t.textContent = msg; const c = { info: '#4f5ef0', success: '#0fa87a', error: '#e54545', warning: '#d4880a' };
    t.style.cssText =
        `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:200;background:${c[type] || c.info};color:#fff;padding:10px 20px;border-radius:18px;font-size:12.5px;font-weight:500;box-shadow:0 5px 16px rgba(0,0,0,0.16);pointer-events:none;animation:toastIn 0.3s ease;max-width:88vw;text-align:center;`;
    document.body.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transition = 'opacity 0.3s';
    }, 2300);
    setTimeout(() => t.remove(), 2900);
}

function showConfirm(msg) {
    return new Promise(r => {
        const o = document.createElement('div');
        o.className = 'modal-overlay';
        o.style.display = 'flex';
        o.innerHTML =
            `<div class="modal" style="width:350px;"><div class="modal-header"><span>确认操作</span><button class="modal-close close-confirm">&times;</button></div><div class="modal-body"><p style="font-size:13px;margin:0;line-height:1.5;">${msg}</p></div><div class="modal-footer"><button class="btn btn-outline cancel-confirm">取消</button><button class="btn btn-primary confirm-confirm">确认</button></div></div>`;
        document.body.appendChild(o); const c = (v) => {
            o.style.display = 'none';
            setTimeout(() => o.remove(), 180);
            r(v);
        };
        o.querySelector('.close-confirm').onclick = () => c(false);
        o.querySelector('.cancel-confirm').onclick = () => c(false);
        o.querySelector('.confirm-confirm').onclick = () => c(true);
        o.addEventListener('click', e => { if (e.target === o) c(false); });
    });
}

function copyText(t) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(t).then(() => showToast('已复制',
            'success')).catch(() => showToast('复制失败', 'error'));
    } else {
        const ta = document.createElement(
            'textarea');
        ta.value = t;
        ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('已复制', 'success');
    }
}

function downloadTxt(t, n) {
    const b = new Blob([t], { type: 'text/plain;charset=utf-8' }); const u = URL.createObjectURL(
        b); const a = document.createElement('a');
    a.href = u;
    a.download = (n || '文案') + '_' + Date.now() + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(u);
}

function openModal(id) { document.getElementById(id).classList.add('show'); }

function closeModal(id) { document.getElementById(id).classList.remove('show'); }
document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-overlay')) e.target.classList
        .remove('show');
});

function updateWorkflowSteps() {
    const s = {
        u: document.getElementById('stepUpload'), t: document.getElementById(
            'stepTranscribe'), r: document.getElementById('stepTranslate'), a: document.getElementById(
                'stepAudio')
    };
    Object.values(s).forEach(x => x.className = 'workflow-step'); if (fileList.length > 0) s.u.classList.add('done'); if (
        textList.length > 0) s.t.classList.add('done'); if (transList.length > 0) s.r.classList.add('done'); if (audioList
            .length > 0) s.a.classList.add('done'); if (isTranscribing) s.t.classList.add('active');
}
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    this.style.borderColor = '#4f5ef0';
    this.style.background = '#f0f1ff';
});
uploadZone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    this.style.borderColor = '#d8dce8';
    this.style.background = '#fafbfd';
});
uploadZone.addEventListener('drop', function (e) {
    e.preventDefault();
    this.style.borderColor = '#d8dce8';
    this.style.background = '#fafbfd'; const f = e.dataTransfer.files; if (f && f.length) processFiles(Array.from(
        f));
});

function handleFileInput(e) {
    const f = e.target.files; if (f && f.length) processFiles(Array.from(f));
    e.target.value = '';
}

function processFiles(files) {
    files.forEach(f => {
        const isVid = f.type.startsWith('video/');
        const isAud = f.type.startsWith('audio/');
        if (!isVid && !isAud) { showToast(f.name + ' 不是音视频文件，已跳过', 'warning'); return; }
        if (f.size > 1024 * 1024 * 1024) { showToast(f.name + ' 超过1GB，已跳过', 'warning'); return; }
        if (fileList.some(item => item.name === f.name && item.size === f.size)) { showToast(f.name + ' 已存在', 'warning'); return; }
        fileList.push({ uid: genId(), name: f.name, size: f.size, raw: f });
    });
    renderFileList();
    updateWorkflowSteps();

    // ✅ 新增：若当前没有正在进行的转录任务，且文件列表不为空，则自动开始转录 
    if (!isTranscribing && fileList.length > 0) {
        setTimeout(() => {
            if (!isTranscribing && fileList.length > 0) {
                startTranscribe();
            }
        }, 300); // 延迟300ms，确保UI渲染完成且拖拽事件处理完毕 
    }
}

function removeFile(i) {
    fileList.splice(i, 1);
    renderFileList();
    updateWorkflowSteps();
}

function renderTransList() {
    const c = document.getElementById('transListContainer'),
        bd = document.getElementById('btnDownloadTrans'),
        bt = document.getElementById('btnTts'),
        bdel = document.getElementById('btnDelTrans');

    if (transList.length === 0) {
        c.innerHTML = '<div class="empty-state"><div class="empty-icon">A</div><div class="empty-text">暂无翻译内容</div><div class="empty-sub">在原始文案中勾选条目，然后点击翻译选中即可</div></div>';
        bd.disabled = true;
        bt.disabled = true;
        bdel.disabled = true;
        return;
    }

    // ⚠️ 关键：每次渲染前必须重置为 null 
    let prevFromTextId = null;

    c.innerHTML = transList.map((item, i) => {
        // 判断是否是当前原文的第一条翻译 
        const isFirstOfGroup = (item.fromTextId !== prevFromTextId);

        // 立即更新 prevFromTextId 供下一条使用 
        prevFromTextId = item.fromTextId;

        // 第一条用彩色边框，其余用透明 
        const borderStyle = isFirstOfGroup
            ? `border-left:3px solid ${getSourceColor(item.fromTextId)};`
            : 'border-left:3px solid transparent;';

        const sn = getOriginSnippet(item.fromTextId);

        return `<div class="card" style="${borderStyle}">
            <div class="card-header">
                <div class="ch-left">
                    <label class="checkbox-wrap">
                        <input type="checkbox" ${item.selected ? 'checked' : ''} onchange="transList[${i}].selected=this.checked;updateToolbarTrans();">
                    </label>
                    <span class="badge ${getBadgeClass(item.lang)}">${getLangName(item.lang)}</span>
                    ${sn ? `<span class="badge-source" title="${escapeHtml(sn)}">${escapeHtml(sn)}</span>` : ''}
                    <span class="source-tag" title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</span>
                </div>
                <div class="ch-right">
                    <button class="btn btn-ghost btn-xs" onclick="copyText('${escapeAttr(item.text)}')" title="复制">复制</button>
                    <button class="btn btn-ghost btn-xs" onclick="downloadTxt('${escapeAttr(item.text)}','${escapeAttr(item.source)}')" title="下载">下载</button>
                    <button class="btn btn-primary btn-xs" onclick="singleTts(${i})" title="生成语音">语音</button>
                    <button class="btn btn-ghost btn-xs" style="color:#e54545;" onclick="deleteTrans(${i})" title="删除">删除</button>
                </div>
            </div>
            <textarea class="card-textarea" onchange="transList[${i}].text=this.value" rows="3">${escapeHtml(item.text)}</textarea>
        </div>`;
    }).join('');

    updateToolbarTrans();
}


async function startTranscribe() {
    if (fileList.length === 0) return showToast('请先选择文件', 'warning'); if (
        isTranscribing) return;
    isTranscribing = true;
    updateWorkflowSteps(); const ps = document.getElementById('progressSection'),
        pf = document.getElementById('progressFill'),
        pl = document.getElementById('progressLabel'),
        btn = document.getElementById('transcribeBtn');
    ps.style.display = 'block';
    btn.disabled = true;
    btn.textContent = '转录中...';
    pf.className = 'progress-fill progress-indeterminate';
    pl.textContent = '正在处理: ' + fileList[0].name; try {
        for (let i = 0; i < fileList.length; i++) {
            const fi =
                fileList[i];
            pl.textContent = `处理中 (${i + 1}/${fileList.length}): ${fi.name}`; const fd = new FormData(); const isV = fi
                .raw.type.startsWith('video/'); const url = isV ? '/api/transcribe' : '/api/transcribe-audio';
            fd.append(isV ? 'video' : 'audio', fi.raw); const res = await fetch(BASE + url, {
                method: 'POST',
                body: fd
            }); if (!res.ok) throw new Error('HTTP ' + res.status); if (isV) {
                const reader = res.body
                    .getReader(); const decoder = new TextDecoder(); let buf = ''; while (true) {
                        const { done,
                            value } = await reader.read(); if (done) break;
                        buf += decoder.decode(value, { stream: true }); const lines = buf.split('\n');
                        buf = lines.pop() || ''; for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try {
                                    const d =
                                        JSON.parse(line.slice(6)); if (d.type === 'complete') {
                                            textList.push({
                                                id: genId(),
                                                source: fi.name, origin: d.data.originalTranscription || '', text: d
                                                    .data.chineseTranscription || '', selected: false
                                            });
                                            renderTextList();
                                        }
                                } catch (e) { }
                            }
                        }
                    }
            } else {
                const json = await res.json();
                textList.push({
                    id: genId(), source: fi.name, origin: json.originalTranscription || '', text: json
                        .chineseTranscription || '', selected: false
                });
                renderTextList();
            }
        }
        pf.className = 'progress-fill';
        pf.style.width = '100%';
        pl.textContent = '转录完成';
        textList.forEach(x => x.selected = true);
        renderTextList();
        updateWorkflowSteps(); if (textList.length > 0) switchTab('tab-text', document.querySelector(
            '.tab-btn[data-tab="tab-text"]'));
        showToast('转录完成，共 ' + textList.length + ' 条文案', 'success');
    } catch (err) {
        pl.textContent = '转录失败: ' + err
            .message;
        showToast('转录失败: ' + err.message, 'error');
    } finally {
        isTranscribing = false;
        btn.disabled = false;
        btn.textContent = '开始转录';
        updateWorkflowSteps();
        setTimeout(() => {
            ps.style.display = 'none';
            pf.style.width = '0%';
            pf.className = 'progress-fill';
        }, 2200);
    }
}

function renderTextList() {
    const c = document.getElementById('textListContainer'),
        bt = document.getElementById('btnTranslate'),
        bd = document.getElementById('btnDelText');

    if (textList.length === 0) {
        c.innerHTML = '<div class="empty-state"><div class="empty-icon">T</div><div class="empty-text">暂无转录文案</div><div class="empty-sub">上传文件并点击开始转录后，文案会自动出现在这里</div></div>';
        bt.disabled = true;
        bd.disabled = true;
        document.getElementById('selectAllText').checked = false;
        return;
    }

    c.innerHTML = textList.map((item, i) =>
        `<div class="card">
            <div class="card-header">
                <div class="ch-left">
                    <label class="checkbox-wrap">
                        <input type="checkbox" ${item.selected ? 'checked' : ''} onchange="textList[${i}].selected=this.checked;updateToolbarText();">
                    </label>
                    <span class="badge badge-gray">#${i + 1}</span>
                    <span class="source-tag" title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</span>
                </div>
                <div class="ch-right">
                    <button class="btn btn-primary btn-xs" onclick="singleTranslate(${i})" title="单独翻译此条">翻译</button>
                    <button class="btn btn-ghost btn-xs" onclick="copyText('${escapeAttr(item.text)}')" title="复制">复制</button>
                    <button class="btn btn-ghost btn-xs" onclick="downloadTxt('${escapeAttr(item.text)}','${escapeAttr(item.source)}')" title="下载">下载</button>
                    <button class="btn btn-ghost btn-xs" style="color:#e54545;" onclick="deleteText(${i})" title="删除">删除</button>
                </div>
            </div>
            <textarea class="card-textarea" onchange="textList[${i}].text=this.value" rows="3">${escapeHtml(item.text)}</textarea>
        </div>`
    ).join('');

    updateToolbarText();
}

function singleTranslate(idx) {
    if (idx < 0 || idx >= textList.length) return;
    openTranslateDialog([textList[idx]]);
}

function updateToolbarText() {
    const s = textList.filter(i => i.selected).length;
    document.getElementById('btnTranslate').disabled = s === 0;
    document.getElementById('btnDelText').disabled = s === 0;
    document.getElementById('selectAllText').checked = textList.length > 0 && textList.every(i => i.selected);
}

function toggleAllText() {
    const c = document.getElementById('selectAllText').checked;
    textList.forEach(i => i.selected = c);
    renderTextList();
}
async function deleteText(i) {
    if (!await showConfirm('确定删除该条原始文案？')) return;
    textList.splice(i, 1);
    renderTextList();
    updateWorkflowSteps();
    showToast('已删除', 'success');
}
async function deleteSelectedText() {
    const s = textList.filter(i => i.selected); if (s.length === 0) return showToast(
        '请先勾选文案', 'warning'); if (!await showConfirm(`确定删除选中的 ${s.length} 条文案？`)) return; for (let i = textList.length -
            1; i >= 0; i--) { if (textList[i].selected) textList.splice(i, 1); }
    renderTextList();
    updateWorkflowSteps();
    showToast('已批量删除', 'success');
}

function addTextManually() {
    document.getElementById('addTextInput').value = '';
    openModal('modalAddText');
}

function saveAddText() {
    const v = document.getElementById('addTextInput').value.trim(); if (!v) return showToast('请输入内容',
        'warning');
    textList.push({ id: genId(), source: '手动输入', origin: v, text: v, selected: false });
    closeModal('modalAddText');
    renderTextList();
    updateWorkflowSteps();
    showToast('手动文案已添加', 'success');
}

function openTranslateDialog(items = null) {
    // 确定待翻译的条目 
    if (items && items.length > 0) {
        pendingTranslateItems = items;
    } else {
        const selected = textList.filter(i => i.selected);
        if (selected.length === 0) return showToast('请先在原始文案中勾选需要翻译的条目', 'warning');
        pendingTranslateItems = selected;
    }

    document.getElementById('translateInput').value = '';
    document.getElementById('translateProgress').style.display = 'none';
    document.getElementById('translateFailedList').style.display = 'none';
    document.getElementById('translateFooter').style.display = 'flex';
    document.getElementById('modalTranslateClose').style.display = '';
    document.getElementById('btnConfirmTranslate').disabled = false;
    openModal('modalTranslate');
    document.getElementById('translateInput').focus();
    document.getElementById('translateInput').onkeydown = function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            executeTranslate();
        }
    };
}

async function executeTranslate() {
    const rawInput = document.getElementById('translateInput').value.trim();
    if (!rawInput) return showToast('请输入目标语言', 'warning');

    // === 语言代码强制映射处理 === 
    const parts = rawInput.split(/[,，\n]+/).map(s => s.trim()).filter(s => s);
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
    cb.style.display = 'none';

    try {
        // 1. 解析目标语言 
        const lr = await fetch(BASE + '/api/extract-target-languages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ languageInstruction: input })
        });
        if (!lr.ok) throw new Error('语言解析失败');
        const lj = await lr.json();
        const langs = lj.extractedLanguages || [];
        if (!langs.length) throw new Error('未识别到有效目标语言');

        // 2. 确定待翻译条目（来自独立按钮或勾选）
        const sel = pendingTranslateItems || textList.filter(i => i.selected);
        if (!sel || sel.length === 0) throw new Error('没有可翻译的条目');
        pendingTranslateItems = null; // 用完即清，避免下次误用 

        const total = sel.length * langs.length;
        let done = 0;
        const failed = [];
        const successResults = []; // 收集成功结果，用于排序 

        pl.textContent = `正在翻译... 0/${total}`;
        pf.style.width = '0%';

        // 3. 构建任务，记录原文索引和语言索引 
        const tasks = [];
        sel.forEach((ti, srcIdx) => {
            langs.forEach((lo, langIdx) => {
                tasks.push({ ti, lo, srcIdx, langIdx });
            });
        });

        // 4. 并行翻译 
        const promises = tasks.map(task =>
            fetch(BASE + '/api/translate-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: task.ti.text, targetLanguage: task.lo.language })
            })
                .then(async r => {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const json = await r.json();
                    return { success: true, task, json };
                })
                .catch(err => {
                    return { success: false, task, error: err.message || '未知错误' };
                })
                .then(result => {
                    done++;
                    if (result.success) {
                        const { task, json } = result;
                        const lc = task.lo.ttsCode || task.lo.language || '';
                        successResults.push({
                            id: genId(),
                            text: json.translatedText || '',
                            lang: lc,
                            source: task.ti.source + ' - ' + getLangName(task.lo.language),
                            fromTextId: task.ti.id,
                            selected: false,
                            srcIdx: task.srcIdx,
                            langIdx: task.langIdx
                        });
                    } else {
                        failed.push({
                            text: (task.ti.text || '').slice(0, 40),
                            lang: getLangName(task.lo.language),
                            error: result.error
                        });
                    }
                    pl.textContent = `正在翻译... ${done}/${total}`;
                    pf.style.width = ((done / total) * 100) + '%';
                })
        );

        await Promise.allSettled(promises);

        // 5. 按原文顺序、语言顺序排序 
        successResults.sort((a, b) => {
            if (a.srcIdx !== b.srcIdx) return a.srcIdx - b.srcIdx;
            return a.langIdx - b.langIdx;
        });

        // 6. 一次性插入所有译文 
        transList.push(...successResults);

        // 7. 只选中本次翻译的条目（而非全选所有）
        sel.forEach(x => x.selected = true);
        renderTransList();
        updateWorkflowSteps();

        // 8. 处理失败提示 
        if (failed.length > 0) {
            fd.style.display = 'block';
            fd.innerHTML = `<div class="failed-list"><strong>以下 ${failed.length} 条翻译失败：</strong>${failed.map(f => '&bull; "' + escapeHtml(f.text) + '…" → ' + f.lang + ' (' + f.error + ')').join('<br>')}</div>`;
            showToast(`翻译部分完成：${successResults.length} 成功，${failed.length} 失败`, 'warning');
        } else {
            closeModal('modalTranslate');
            showToast(`翻译完成，共 ${successResults.length} 条译文`, 'success');
        }
        switchTab('tab-trans', document.querySelector('.tab-btn[data-tab="tab-trans"]'));
    } catch (err) {
        showToast('翻译失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        ft.style.display = 'flex';
        pd.style.display = 'none';
        cb.style.display = '';
        pendingTranslateItems = null; // 确保异常时也清空 
    }
}


function addTransManually() {
    document.getElementById('addTransLang').value = '';
    document.getElementById('addTransText').value = '';
    openModal('modalAddTrans');
}

function saveAddTrans() {
    const l = document.getElementById('addTransLang').value.trim() || 'en'; const t = document
        .getElementById('addTransText').value.trim(); if (!t) return showToast('请输入翻译内容', 'warning');
    transList.push({ id: genId(), text: t, lang: l, source: '手动输入', fromTextId: null, selected: false });
    closeModal('modalAddTrans');
    renderTransList();
    updateWorkflowSteps();
    showToast('翻译已添加', 'success');
}

function updateToolbarTrans() {
    const s = transList.filter(i => i.selected).length;
    document.getElementById('btnDownloadTrans').disabled = s === 0;
    document.getElementById('btnTts').disabled = s === 0;
    document.getElementById('btnDelTrans').disabled = s === 0;
    document.getElementById('selectAllTrans').checked = transList.length > 0 && transList.every(i => i.selected);
}

function toggleAllTrans() {
    const c = document.getElementById('selectAllTrans').checked;
    transList.forEach(i => i.selected = c);
    renderTransList();
}
async function deleteTrans(i) {
    if (!await showConfirm('确定删除该条翻译？')) return;
    transList.splice(i, 1);
    renderTransList();
    updateWorkflowSteps();
    showToast('已删除', 'success');
}
async function deleteSelectedTrans() {
    const s = transList.filter(i => i.selected); if (s.length === 0) return showToast(
        '请先勾选翻译', 'warning'); if (!await showConfirm(`确定删除选中的 ${s.length} 条翻译？`)) return; for (let i = transList.length -
            1; i >= 0; i--) { if (transList[i].selected) transList.splice(i, 1); }
    renderTransList();
    updateWorkflowSteps();
    showToast('已批量删除', 'success');
}

function batchDownloadTrans() {
    const s = transList.filter(i => i.selected); if (s.length === 0) return showToast(
        '请先勾选翻译', 'warning'); let str = '';
    s.forEach(i => { str += '[' + getLangName(i.lang) + '] ' + i.source + '\n' + i.text + '\n\n'; }); const now = new Date();
    downloadTxt(str, '翻译合集_' + (now.getMonth() + 1) + '月' + now.getDate() + '日');
    showToast('翻译合集已下载', 'success');
}
async function openTtsDialog() {
    const s = transList.filter(i => i.selected);
    if (s.length === 0) return showToast('请先勾选翻译条目', 'warning');
    pendingTtsItems = [...s];

    // --- 加载持久化设置 --- 
    const saved = loadTtsSettings();
    const currentModel = document.getElementById('ttsModel').value;
    // 如果 saved.model 与当前不同，需要重新加载音色列表 
    const modelToLoad = saved && saved.model ? saved.model : currentModel;

    document.getElementById('ttsInterval').value = saved ? saved.interval || 0.3 : 0.3;
    document.getElementById('ttsIntervalVal').textContent = saved ? saved.interval || 0.3 : 0.3;
    document.getElementById('ttsUseTextName').checked = saved ? saved.useTextName || false : false;

    document.getElementById('ttsProgress').style.display = 'none';
    document.getElementById('ttsFailedList').style.display = 'none';
    document.getElementById('ttsFooter').style.display = 'flex';
    document.getElementById('modalTtsClose').style.display = '';
    document.getElementById('btnConfirmTts').disabled = false;

    await loadVoiceOptions(modelToLoad);  // 加载音色列表 

    // 设置上次选择的音色（如果存在）
    if (saved && saved.voice) {
        const voiceSelect = document.getElementById('ttsVoice');
        if (voiceSelect.querySelector(`option[value="${saved.voice}"]`)) {
            voiceSelect.value = saved.voice;
        }
    }

    openModal('modalTts');
}

async function singleTts(i) {
    pendingTtsItems = [transList[i]];

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
        const voiceSelect = document.getElementById('ttsVoice');
        if (voiceSelect.querySelector(`option[value="${saved.voice}"]`)) {
            voiceSelect.value = saved.voice;
        }
    }
    openModal('modalTts');
}

async function onTtsModelChange() {
    const m = document.getElementById('ttsModel').value;
    document.getElementById('ttsIntervalRow').style.display = m === 'google' ? 'block' : 'none';
    await loadVoiceOptions(m);
    saveTtsSettings();  // 模型切换时立即保存 
}

async function loadVoiceOptions(m) {
    const s = document.getElementById('ttsVoice');
    s.innerHTML = '<option value="">加载中...</option>'; if (voiceListCache[m] && voiceListCache[m].length > 0) {
        s.innerHTML =
            voiceListCache[m].map(v => `<option value="${v.name}">${v.dname}</option>`).join(''); return;
    } try {
        const r =
            await fetch(BASE + '/api/voice-options?model=' + m); const j = await r.json(); const v = (j.voices || []).map(
                x => ({ name: x.name, dname: x.displayName || x.name }));
        voiceListCache[m] = v;
        s.innerHTML = v.map(x => `<option value="${x.name}">${x.dname}</option>`).join('');
    } catch (e) {
        s.innerHTML =
            '<option value="">加载失败</option>';
    }
}
async function playVoiceDemo() {
    const voice = document.getElementById('ttsVoice').value; const model = document
        .getElementById('ttsModel').value; if (!voice) return showToast('请先选择音色', 'warning'); const btn = document
            .getElementById('btnVoiceDemo');
    btn.disabled = true;
    btn.textContent = '...'; const a = document.getElementById('demoAudio');
    a.src = BASE + '/api/voice-sample/' + encodeURIComponent(voice) + '?model=' + model;
    a.volume = 0.6; try {
        await a.play();
        showToast('试听中...', 'info');
    } catch (e) { showToast('试听失败', 'error'); }
    a.onended = () => {
        btn.disabled = false;
        btn.textContent = '试听';
    };
    a.onerror = () => {
        btn.disabled = false;
        btn.textContent = '试听';
        showToast('试听加载失败', 'error');
    };
    setTimeout(() => {
        if (!a.ended && a.src) {
            btn.disabled = false;
            btn.textContent = '试听';
        }
    }, 7000);
}
async function singleTtsRequest(item, voice, model, interval, useTextName, maxRetries = 2) {
    let nt = ''; if (
        useTextName && item.fromTextId) {
        const o = textList.find(t => t.id === item.fromTextId); if (o && o.text) nt = o
            .text.slice(0, 50).replace(/[\\\/:*?"<>|]/g, '');
    } if (!nt && useTextName && item.text) nt = item.text.slice(
        0, 50).replace(/[\\\/:*?"<>|]/g, ''); const payload = {
            text: item.text, targetLanguage: item.lang,
            voiceName: voice, model: model, paragraphInterval: model === 'google' ? interval : 0,
            useContentFileName: useTextName, namingText: nt, skipTranslate: true, transcriptionId: item.id
        }; let le =
            ''; for (let a = 0; a <= maxRetries; a++) {
                try {
                    const r = await fetch(BASE + '/api/generate-speech',
                        {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(
                                payload)
                        }); if (!r.ok) {
                            const et = await r.text().catch(() => ''); let ed = 'HTTP ' + r
                                .status; try {
                                    const ej = JSON.parse(et);
                                    ed = ej.details || ej.error || ed;
                                } catch (e) { } throw new Error(ed);
                        } const j = await r.json(); if (
                        !j.audioFileName) throw new Error('响应中没有音频数据'); return {
                            success: true, item, result: {
                                id: genId(),
                                file: j.audioFileName, display: j.displayFileName || j.audioFileName, source: item.source,
                                lang: item.lang, selected: false
                            }
                        };
                } catch (err) {
                    le = err.message || '未知错误'; if (a <
                        maxRetries) await new Promise(r => setTimeout(r, 700 * (a + 1)));
                }
            } return {
                success: false,
                item, error: le
            };
}
async function executeTts() {
    const voice = document.getElementById('ttsVoice').value;
    const model = document.getElementById('ttsModel').value;
    const interval = parseFloat(document.getElementById('ttsInterval').value) || 0;
    const useTextName = document.getElementById('ttsUseTextName').checked;
    if (!voice) return showToast('请选择音色', 'warning');
    if (pendingTtsItems.length === 0) return showToast('没有待处理的条目', 'warning');

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
    cb.style.display = 'none';

    const total = pendingTtsItems.length;
    let done = 0;
    const success = [];
    const failed = [];

    pl.textContent = `正在生成... 0/${total}`;
    pf.style.width = '0%';

    // 并行发起所有TTS请求，每个完成时立即更新界面 
    const promises = pendingTtsItems.map(item =>
        singleTtsRequest(item, voice, model, interval, useTextName, 2)
            .then(result => {
                done++;
                if (result.success) {
                    success.push(result.result);
                    audioList.push(result.result);
                    renderAudioList(); // 实时显示新生成的音频 
                } else {
                    failed.push({
                        text: (result.item.text || '').slice(0, 50),
                        error: result.error
                    });
                }
                // 更新进度 
                pl.textContent = `正在生成... ${done}/${total}`;
                pf.style.width = ((done / total) * 100) + '%';
            })
    );

    try {
        // 等待所有请求完成（包括内部重试）
        await Promise.allSettled(promises);

        // 全部完成后的处理 
        if (success.length > 0) {
            audioList.forEach(x => x.selected = true);
            renderAudioList();
            updateWorkflowSteps();
            switchTab('tab-audio', document.querySelector('.tab-btn[data-tab="tab-audio"]'));
        }

        if (failed.length > 0) {
            fd.style.display = 'block';
            fd.innerHTML = `<div class="failed-list"><strong>以下 ${failed.length} 条语音生成失败（已重试2次）：</strong>${failed.map(f => '&bull; "' + escapeHtml(f.text) + '…" — ' + f.error).join('<br>')}<br><small style="color:#888;">请检查文本内容或稍后重试</small></div>`;
            if (success.length > 0) {
                showToast(`语音部分完成：${success.length} 成功，${failed.length} 失败`, 'warning');
            } else {
                showToast(`语音全部失败：${failed.length} 条未成功`, 'error');
            }
        } else {
            closeModal('modalTts');
            showToast(`语音生成完成，共 ${success.length} 个音频`, 'success');
        }
    } catch (err) {
        showToast('语音生成异常: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        ft.style.display = 'flex';
        pd.style.display = 'none';
        cb.style.display = '';
        pendingTtsItems = [];
    }
}
function renderAudioList() {
    const c = document.getElementById('audioListContainer'),
        bd = document.getElementById('btnBatchDownloadAudio'),
        bdel = document.getElementById('btnDelAudio'); if (audioList.length === 0) {
            c.innerHTML =
                '<div class="empty-state"><div class="empty-icon">S</div><div class="empty-text">暂无生成音频</div><div class="empty-sub">在翻译结果中勾选条目，点击生成语音即可</div></div>';
            bd.disabled = true;
            bdel.disabled = true; return;
        }
    c.innerHTML = audioList.map((item, i) =>
        `<div class="audio-card"><div class="ac-top"><label class="checkbox-wrap"><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="audioList[${i}].selected=this.checked;updateToolbarAudio();"></label><span class="badge ${getBadgeClass(item.lang)}">${getLangName(item.lang)}</span><span class="source-tag" title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</span></div><div class="ac-name" title="${escapeHtml(item.display || item.file)}">${escapeHtml(item.display || item.file)}</div><div class="ac-row" style="margin-top:4px;"><button class="btn btn-primary btn-sm" id="playBtn${i}" onclick="togglePlayAudio(${i})">播放</button><button class="btn btn-outline btn-sm" onclick="downloadAudioFile('${escapeAttr(item.file)}','${escapeAttr(item.display || item.file)}')">下载</button><button class="btn btn-ghost btn-sm" style="color:#e54545;" onclick="deleteAudio(${i})">删除</button></div><div id="audioProgressWrap${i}" style="display:none;margin-top:6px;"><div class="audio-progress-bar" onclick="seekAudio(event,${i})"><div class="audio-progress-fill" id="audioProgressFill${i}" style="width:0%;"></div></div><div class="audio-time" id="audioTime${i}">0:00 / 0:00</div></div><audio id="audioEl${i}" style="display:none;" src="${BASE}/api/download-audio/${encodeURIComponent(item.file)}" preload="metadata" onloadedmetadata="onAudioLoaded(${i})" ontimeupdate="onAudioTick(${i})" onended="onAudioEnd(${i})" onerror="onAudioError(${i})"></audio></div>`
    ).join('');
    updateToolbarAudio();
}

function updateToolbarAudio() {
    const s = audioList.filter(i => i.selected).length;
    document.getElementById('btnBatchDownloadAudio').disabled = s === 0;
    document.getElementById('btnDelAudio').disabled = s === 0;
    document.getElementById('selectAllAudio').checked = audioList.length > 0 && audioList.every(i => i.selected);
}

function toggleAllAudio() {
    const c = document.getElementById('selectAllAudio').checked;
    audioList.forEach(i => i.selected = c);
    renderAudioList();
}
async function deleteAudio(i) {
    if (!await showConfirm('确定删除该音频记录？')) return; if (currentPlayIdx === i) stopAudio();
    audioList.splice(i, 1);
    renderAudioList();
    updateWorkflowSteps();
    showToast('已删除', 'success');
}
async function deleteSelectedAudio() {
    const s = audioList.filter(i => i.selected); if (s.length === 0) return showToast(
        '请先勾选音频', 'warning'); if (!await showConfirm(`确定删除选中的 ${s.length} 个音频？`)) return; if (currentPlayIdx >= 0 && audioList[
            currentPlayIdx] && audioList[currentPlayIdx].selected) stopAudio(); for (let i = audioList.length - 1; i >=
                0; i--) { if (audioList[i].selected) audioList.splice(i, 1); }
    renderAudioList();
    updateWorkflowSteps();
    showToast('已批量删除', 'success');
}

function batchDownloadAudio() {
    const s = audioList.filter(i => i.selected); if (s.length === 0) return showToast(
        '请先勾选音频', 'warning');
    s.forEach(a => downloadAudioFile(a.file, a.display || a.file));
    showToast('开始批量下载', 'success');
}
async function downloadAudioFile(fn, dn) {
    try {
        const r = await fetch(BASE + '/api/download-audio/' +
            encodeURIComponent(fn), { method: 'GET', headers: { 'Accept': 'audio/*,*/*' } }); if (!r.ok) throw new Error(
                '下载失败'); const b = await r.blob(); const u = URL.createObjectURL(b); const a = document.createElement('a');
        a.href = u;
        a.download = dn || fn;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(u);
    } catch (e) {
        window.open(BASE + '/api/download-audio/' + encodeURIComponent(fn),
            '_blank');
    }
}

function stopAudio() {
    if (currentAudioEl) {
        currentAudioEl.pause();
        currentAudioEl = null;
    } const oi = currentPlayIdx;
    currentPlayIdx = -1; if (oi >= 0) {
        const w = document.getElementById('audioProgressWrap' + oi); const b = document
            .getElementById('playBtn' + oi); if (w) w.style.display = 'none'; if (b) b.textContent = '播放';
    }
}

function togglePlayAudio(i) {
    if (currentPlayIdx === i) { stopAudio(); return; }
    stopAudio();
    currentPlayIdx = i; const ae = document.getElementById('audioEl' + i); const b = document.getElementById('playBtn' + i); const
        w = document.getElementById('audioProgressWrap' + i); if (!ae) return;
    currentAudioEl = ae;
    ae.volume = 0.7;
    ae.play().catch(() => {
        showToast('音频加载失败', 'error');
        stopAudio();
    }); if (b) b.textContent = '暂停'; if (w) w.style.display = 'block';
}

function onAudioLoaded(i) {
    const ae = document.getElementById('audioEl' + i); const td = document.getElementById(
        'audioTime' + i); if (ae && td && ae.duration) td.textContent = '0:00 / ' + formatTime(ae.duration);
}

function onAudioTick(i) {
    const ae = document.getElementById('audioEl' + i); const f = document.getElementById(
        'audioProgressFill' + i); const td = document.getElementById('audioTime' + i); if (ae && f && ae.duration) {
            const p =
                (ae.currentTime / ae.duration) * 100;
            f.style.width = p + '%'; if (td) td.textContent = formatTime(ae.currentTime) + ' / ' + formatTime(ae.duration);
        }
}

function onAudioEnd(i) {
    const b = document.getElementById('playBtn' + i); const w = document.getElementById(
        'audioProgressWrap' + i); const f = document.getElementById('audioProgressFill' + i); if (b) b.textContent =
            '播放'; if (w) w.style.display = 'none'; if (f) f.style.width = '0%';
    currentPlayIdx = -1;
    currentAudioEl = null;
}

function onAudioError(i) {
    const b = document.getElementById('playBtn' + i); const w = document.getElementById(
        'audioProgressWrap' + i); if (b) b.textContent = '播放'; if (w) w.style.display = 'none';
    currentPlayIdx = -1;
    currentAudioEl = null;
    showToast('音频加载出错', 'error');
}

function seekAudio(e, i) {
    const ae = document.getElementById('audioEl' + i); if (!ae || !ae.duration) return; const r = e
        .currentTarget.getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    ae.currentTime = p * ae.duration;
}

function switchTab(tid, btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove(
        'active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); const c = document.getElementById(
        tid); if (c) c.classList.add('active'); if (btn) btn.classList.add('active');
}
async function clearAllData() {
    if (!await showConfirm('确定清空所有上传文件、文案、翻译和音频数据？此操作不可恢复！')) return;
    stopAudio();
    fileList = [];
    textList = [];
    transList = [];
    audioList = [];
    document.getElementById('fileListSection').style.display = 'none';
    document.getElementById('progressSection').style.display = 'none';
    renderTextList();
    renderTransList();
    renderAudioList();
    updateWorkflowSteps();
    showToast('全部数据已清空', 'success');
}
document.addEventListener('DOMContentLoaded', () => {
    renderTextList();
    renderTransList();
    renderAudioList();
    loadVoiceOptions('google');
    updateWorkflowSteps();

    // TTS 设置持久化监听 
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