// app.js - 视频人声转文本工具 

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

/* ========== 工具函数 ========== */
function genId() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }
function formatSize(b) {
    if (!b || b === 0) return '0 B';
    const k = 1024,
        arr = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + arr[i];
}
function formatTime(s) {
    if (isNaN(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60),
        sec = Math.floor(s % 60);
    return m + ':' + sec.toString().padStart(2, '0');
}
function getLangName(c) {
    const map = { zh: '中文', pt: '葡萄牙语', en: '英语', jp: '日语', kr: '韩语' };
    return map[c] || c || '未知';
}
function getBadgeClass(c) {
    const map = { zh: 'badge-blue', en: 'badge-green', pt: 'badge-orange', jp: 'badge-gray', kr: 'badge-red' };
    return map[c] || 'badge-gray';
}
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast-msg');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = msg;
    const bgColors = { info: '#6366f1', success: '#10b981', error: '#ef4444', warning: '#f59e0b' };
    toast.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:200;background:${bgColors[type] || bgColors.info};color:#fff;padding:11px 22px;border-radius:22px;font-size:13px;font-weight:500;box-shadow:0 6px 20px rgba(0,0,0,0.18);pointer-events:none;animation:toastIn 0.35s ease;`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 2200);
    setTimeout(() => toast.remove(), 2700);
}

function showConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
          <div class="modal" style="width:370px;animation:modalIn 0.2s ease;">
            <div class="modal-header"><span>确认操作</span><button class="modal-close close-confirm">✕</button></div>
            <div class="modal-body"><p style="font-size:13.5px;margin:0;line-height:1.5;">${message}</p></div>
            <div class="modal-footer">
              <button class="btn btn-outline cancel-confirm">取消</button>
              <button class="btn btn-primary confirm-confirm">确认</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        const closeModal = (confirmed) => { overlay.style.display = 'none'; setTimeout(() => overlay.remove(), 200); resolve(confirmed); };
        overlay.querySelector('.close-confirm').onclick = () => closeModal(false);
        overlay.querySelector('.cancel-confirm').onclick = () => closeModal(false);
        overlay.querySelector('.confirm-confirm').onclick = () => closeModal(true);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(false); });
    });
}

function copyText(txt) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(txt).then(() => showToast('已复制到剪贴板', 'success')).catch(() => showToast('复制失败', 'error'));
    } else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('已复制到剪贴板', 'success');
    }
}
function downloadTxt(txt, name) {
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name || '文案') + '_' + Date.now() + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
document.addEventListener('click', function (e) { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('show'); });

/* ========== 工作流步骤更新 ========== */
function updateWorkflowSteps() {
    const steps = {
        upload: document.getElementById('stepUpload'),
        transcribe: document.getElementById('stepTranscribe'),
        translate: document.getElementById('stepTranslate'),
        audio: document.getElementById('stepAudio')
    };
    Object.values(steps).forEach(s => { s.className = 'workflow-step'; });
    if (fileList.length > 0) steps.upload.classList.add('done');
    if (textList.length > 0) steps.transcribe.classList.add('done');
    if (transList.length > 0) steps.translate.classList.add('done');
    if (audioList.length > 0) steps.audio.classList.add('done');
    if (isTranscribing) steps.transcribe.classList.add('active');
}

/* ========== 文件上传 ========== */
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    this.style.borderColor = '#6366f1';
    this.style.background = '#eef0ff';
});
uploadZone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    this.style.borderColor = '#d8dce8';
    this.style.background = '#fafbfd';
});
uploadZone.addEventListener('drop', function (e) {
    e.preventDefault();
    this.style.borderColor = '#d8dce8';
    this.style.background = '#fafbfd';
    const files = e.dataTransfer.files;
    if (files && files.length) processFiles(Array.from(files));
});

function handleFileInput(event) {
    const files = event.target.files;
    if (files && files.length) processFiles(Array.from(files));
    event.target.value = '';
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
}

function removeFile(index) {
    fileList.splice(index, 1);
    renderFileList();
    updateWorkflowSteps();
}

function renderFileList() {
    const section = document.getElementById('fileListSection');
    const container = document.getElementById('fileListContainer');
    const title = document.getElementById('fileListTitle');
    if (fileList.length === 0) { section.style.display = 'none'; updateWorkflowSteps(); return; }
    section.style.display = 'block';
    title.textContent = '📁 已选择文件 (' + fileList.length + ')';
    container.innerHTML = fileList.map((f, i) => `
        <div class="file-item">
          <span class="fi-icon">🎵</span>
          <div class="fi-info"><div class="fi-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div><div class="fi-size">${formatSize(f.size)}</div></div>
          <button class="fi-del" onclick="removeFile(${i})" title="移除">✕</button>
        </div>`).join('');
    updateWorkflowSteps();
}

/* ========== 转录 ========== */
async function startTranscribe() {
    if (fileList.length === 0) return showToast('请先选择文件', 'warning');
    if (isTranscribing) return;
    isTranscribing = true;
    updateWorkflowSteps();
    const progressSection = document.getElementById('progressSection');
    const progressFill = document.getElementById('progressFill');
    const progressLabel = document.getElementById('progressLabel');
    const btn = document.getElementById('transcribeBtn');
    progressSection.style.display = 'block';
    btn.disabled = true;
    btn.textContent = '⏳ 转录中...';
    progressFill.className = 'progress-fill progress-indeterminate';
    progressLabel.textContent = '正在处理: ' + fileList[0].name;
    try {
        for (let idx = 0; idx < fileList.length; idx++) {
            const fileItem = fileList[idx];
            progressLabel.textContent = `处理中 (${idx + 1}/${fileList.length}): ${fileItem.name}`;
            const fd = new FormData();
            const isVideo = fileItem.raw.type.startsWith('video/');
            const url = isVideo ? '/api/transcribe' : '/api/transcribe-audio';
            fd.append(isVideo ? 'video' : 'audio', fileItem.raw);
            const res = await fetch(BASE + url, { method: 'POST', body: fd });
            if (!res.ok) throw new Error('请求失败 HTTP ' + res.status);
            if (isVideo) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const d = JSON.parse(line.slice(6));
                                if (d.type === 'complete') {
                                    textList.push({
                                        id: genId(),
                                        source: fileItem.name,
                                        origin: d.data.originalTranscription || '',
                                        text: d.data.chineseTranscription || '',
                                        selected: false
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
                    id: genId(),
                    source: fileItem.name,
                    origin: json.originalTranscription || '',
                    text: json.chineseTranscription || '',
                    selected: false
                });
                renderTextList();
            }
        }
        progressFill.className = 'progress-fill';
        progressFill.style.width = '100%';
        progressLabel.textContent = '转录完成！';
        textList.forEach(item => item.selected = true);
        renderTextList();
        updateWorkflowSteps();
        if (textList.length > 0) switchTab('tab-text', document.querySelector('.tab-btn[data-tab="tab-text"]'));
        showToast('转录完成！共生成 ' + textList.length + ' 条文案', 'success');
    } catch (err) {
        progressLabel.textContent = '转录失败: ' + err.message;
        showToast('转录失败: ' + err.message, 'error');
    } finally {
        isTranscribing = false;
        btn.disabled = false;
        btn.textContent = '▶ 开始转录';
        updateWorkflowSteps();
        setTimeout(() => {
            progressSection.style.display = 'none';
            progressFill.style.width = '0%';
            progressFill.className = 'progress-fill';
        }, 2500);
    }
}

/* ========== 原始文案 ========== */
function renderTextList() {
    const container = document.getElementById('textListContainer');
    const btnTrans = document.getElementById('btnTranslate');
    const btnDel = document.getElementById('btnDelText');
    if (textList.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-text">暂无转录文案</div><div class="empty-sub">上传文件并点击"开始转录"后，文案会自动出现在这里</div></div>';
        btnTrans.disabled = true;
        btnDel.disabled = true;
        document.getElementById('selectAllText').checked = false;
        return;
    }
    container.innerHTML = textList.map((item, i) => `
        <div class="card">
          <div class="card-header">
            <div class="ch-left">
              <label class="checkbox-wrap"><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="textList[${i}].selected=this.checked;updateToolbarText();"></label>
              <span class="badge badge-gray">#${i + 1}</span>
              <span class="source-tag" title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</span>
            </div>
            <div class="ch-right">
              <button class="btn btn-ghost btn-xs" onclick="copyText('${item.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="复制">📋</button>
              <button class="btn btn-ghost btn-xs" onclick="downloadTxt('${item.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}','${item.source.replace(/'/g, "\\'")}')" title="下载">📥</button>
              <button class="btn btn-ghost btn-xs" style="color:#ef4444;" onclick="deleteText(${i})" title="删除">✕</button>
            </div>
          </div>
          <textarea class="card-textarea" onchange="textList[${i}].text=this.value" rows="3">${escapeHtml(item.text)}</textarea>
        </div>`).join('');
    updateToolbarText();
}

function updateToolbarText() {
    const selCount = textList.filter(i => i.selected).length;
    document.getElementById('btnTranslate').disabled = selCount === 0;
    document.getElementById('btnDelText').disabled = selCount === 0;
    document.getElementById('selectAllText').checked = textList.length > 0 && textList.every(i => i.selected);
}

function toggleAllText() {
    const c = document.getElementById('selectAllText').checked;
    textList.forEach(i => i.selected = c);
    renderTextList();
}

async function deleteText(index) {
    if (!await showConfirm('确定删除该条原始文案？')) return;
    textList.splice(index, 1);
    renderTextList();
    updateWorkflowSteps();
    showToast('已删除', 'success');
}

async function deleteSelectedText() {
    const sel = textList.filter(i => i.selected);
    if (sel.length === 0) return showToast('请先勾选文案', 'warning');
    if (!await showConfirm(`确定删除选中的 ${sel.length} 条文案？`)) return;
    for (let i = textList.length - 1; i >= 0; i--) { if (textList[i].selected) textList.splice(i, 1); }
    renderTextList();
    updateWorkflowSteps();
    showToast('已批量删除', 'success');
}

function addTextManually() {
    document.getElementById('addTextInput').value = '';
    openModal('modalAddText');
}

function saveAddText() {
    const val = document.getElementById('addTextInput').value.trim();
    if (!val) return showToast('请输入内容', 'warning');
    textList.push({ id: genId(), source: '手动输入', origin: val, text: val, selected: false });
    closeModal('modalAddText');
    renderTextList();
    updateWorkflowSteps();
    showToast('手动文案已添加', 'success');
}

/* ========== 翻译 ========== */
function openTranslateDialog() {
    const sel = textList.filter(i => i.selected);
    if (sel.length === 0) return showToast('请先在原始文案中勾选需要翻译的条目', 'warning');
    document.getElementById('translateInput').value = '';
    document.getElementById('translateProgress').style.display = 'none';
    document.getElementById('translateFooter').style.display = 'flex';
    openModal('modalTranslate');
    const textarea = document.getElementById('translateInput');
    textarea.onkeydown = function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            executeTranslate();
        }
    };
}

async function executeTranslate() {
    const input = document.getElementById('translateInput').value.trim();
    if (!input) return showToast('请输入目标语言', 'warning');
    const btn = document.getElementById('btnConfirmTranslate');
    const progressDiv = document.getElementById('translateProgress');
    const progressLabel = document.getElementById('translateProgressLabel');
    const progressFill = document.getElementById('translateProgressFill');
    const footer = document.getElementById('translateFooter');
    const closeBtn = document.getElementById('modalTranslateClose');
    btn.disabled = true;
    footer.style.display = 'none';
    progressDiv.style.display = 'block';
    closeBtn.style.display = 'none';
    try {
        const langRes = await fetch(BASE + '/api/extract-target-languages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ languageInstruction: input })
        });
        if (!langRes.ok) throw new Error('语言解析失败');
        const langJson = await langRes.json();
        const langs = langJson.extractedLanguages || [];
        if (!langs.length) throw new Error('未识别到有效目标语言');
        const selTexts = textList.filter(i => i.selected);
        const totalTasks = selTexts.length * langs.length;
        let completed = 0;
        progressLabel.textContent = `正在翻译... 0/${totalTasks}`;
        progressFill.style.width = '0%';
        for (const t of selTexts) {
            for (const langObj of langs) {
                const tr = await fetch(BASE + '/api/translate-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: t.text, targetLanguage: langObj.language })
                });
                if (tr.ok) {
                    const trJson = await tr.json();
                    const langCode = langObj.ttsCode || langObj.language || '';
                    transList.push({
                        id: genId(),
                        text: trJson.translatedText || '',
                        lang: langCode,
                        source: t.source + ' (' + getLangName(langObj.language) + ')',
                        fromTextId: t.id,
                        selected: false
                    });
                    renderTransList();
                }
                completed++;
                progressLabel.textContent = `正在翻译... ${completed}/${totalTasks}`;
                progressFill.style.width = ((completed / totalTasks) * 100) + '%';
            }
        }
        transList.forEach(item => item.selected = true);
        renderTransList();
        updateWorkflowSteps();
        closeModal('modalTranslate');
        switchTab('tab-trans', document.querySelector('.tab-btn[data-tab="tab-trans"]'));
        showToast('翻译完成！共生成 ' + completed + ' 条译文', 'success');
    } catch (err) {
        showToast('翻译失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        footer.style.display = 'flex';
        progressDiv.style.display = 'none';
        closeBtn.style.display = '';
    }
}

function addTransManually() {
    document.getElementById('addTransLang').value = '';
    document.getElementById('addTransText').value = '';
    openModal('modalAddTrans');
}

function saveAddTrans() {
    const lang = document.getElementById('addTransLang').value.trim() || 'en';
    const text = document.getElementById('addTransText').value.trim();
    if (!text) return showToast('请输入翻译内容', 'warning');
    transList.push({ id: genId(), text: text, lang: lang, source: '手动输入', fromTextId: null, selected: false });
    closeModal('modalAddTrans');
    renderTransList();
    updateWorkflowSteps();
    showToast('翻译已添加', 'success');
}

function renderTransList() {
    const container = document.getElementById('transListContainer');
    const btnDownload = document.getElementById('btnDownloadTrans');
    const btnTts = document.getElementById('btnTts');
    const btnDel = document.getElementById('btnDelTrans');
    if (transList.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-text">暂无翻译内容</div><div class="empty-sub">在原始文案中勾选条目，然后点击"翻译选中"即可</div></div>';
        btnDownload.disabled = true;
        btnTts.disabled = true;
        btnDel.disabled = true;
        return;
    }
    container.innerHTML = transList.map((item, i) => `
        <div class="card">
          <div class="card-header">
            <div class="ch-left">
              <label class="checkbox-wrap"><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="transList[${i}].selected=this.checked;updateToolbarTrans();"></label>
              <span class="badge ${getBadgeClass(item.lang)}">${getLangName(item.lang)}</span>
              <span class="source-tag" title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</span>
            </div>
            <div class="ch-right">
              <button class="btn btn-ghost btn-xs" onclick="copyText('${item.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="复制">📋</button>
              <button class="btn btn-ghost btn-xs" onclick="downloadTxt('${item.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}','${item.source.replace(/'/g, "\\'")}')" title="下载">📥</button>
              <button class="btn btn-primary btn-xs" onclick="singleTts(${i})" title="生成语音">🔊</button>
              <button class="btn btn-ghost btn-xs" style="color:#ef4444;" onclick="deleteTrans(${i})" title="删除">✕</button>
            </div>
          </div>
          <textarea class="card-textarea" onchange="transList[${i}].text=this.value" rows="3">${escapeHtml(item.text)}</textarea>
        </div>`).join('');
    updateToolbarTrans();
}

function updateToolbarTrans() {
    const selCount = transList.filter(i => i.selected).length;
    document.getElementById('btnDownloadTrans').disabled = selCount === 0;
    document.getElementById('btnTts').disabled = selCount === 0;
    document.getElementById('btnDelTrans').disabled = selCount === 0;
    document.getElementById('selectAllTrans').checked = transList.length > 0 && transList.every(i => i.selected);
}

function toggleAllTrans() {
    const c = document.getElementById('selectAllTrans').checked;
    transList.forEach(i => i.selected = c);
    renderTransList();
}

async function deleteTrans(index) {
    if (!await showConfirm('确定删除该条翻译？')) return;
    transList.splice(index, 1);
    renderTransList();
    updateWorkflowSteps();
    showToast('已删除', 'success');
}

async function deleteSelectedTrans() {
    const sel = transList.filter(i => i.selected);
    if (sel.length === 0) return showToast('请先勾选翻译', 'warning');
    if (!await showConfirm(`确定删除选中的 ${sel.length} 条翻译？`)) return;
    for (let i = transList.length - 1; i >= 0; i--) { if (transList[i].selected) transList.splice(i, 1); }
    renderTransList();
    updateWorkflowSteps();
    showToast('已批量删除', 'success');
}

function batchDownloadTrans() {
    const sel = transList.filter(i => i.selected);
    if (sel.length === 0) return showToast('请先勾选翻译', 'warning');
    let str = '';
    sel.forEach(item => { str += '[' + getLangName(item.lang) + '] ' + item.source + '\n' + item.text + '\n\n'; });
    const now = new Date();
    downloadTxt(str, '翻译合集_' + (now.getMonth() + 1) + '月' + now.getDate() + '日');
    showToast('翻译合集TXT已下载', 'success');
}

/* ========== TTS ========== */
async function openTtsDialog() {
    const sel = transList.filter(i => i.selected);
    if (sel.length === 0) return showToast('请先勾选翻译条目', 'warning');
    pendingTtsItems = [...sel];
    document.getElementById('ttsModel').value = 'google';
    document.getElementById('ttsInterval').value = '0.3';
    document.getElementById('ttsIntervalVal').textContent = '0.3';
    document.getElementById('ttsUseTextName').checked = false;
    document.getElementById('ttsProgress').style.display = 'none';
    document.getElementById('ttsFooter').style.display = 'flex';
    document.getElementById('modalTtsClose').style.display = '';
    await loadVoiceOptions('google');
    openModal('modalTts');
}

function singleTts(index) {
    pendingTtsItems = [transList[index]];
    document.getElementById('ttsModel').value = 'google';
    document.getElementById('ttsInterval').value = '0.3';
    document.getElementById('ttsIntervalVal').textContent = '0.3';
    document.getElementById('ttsUseTextName').checked = false;
    document.getElementById('ttsProgress').style.display = 'none';
    document.getElementById('ttsFooter').style.display = 'flex';
    document.getElementById('modalTtsClose').style.display = '';
    loadVoiceOptions('google');
    openModal('modalTts');
}

async function onTtsModelChange() {
    const model = document.getElementById('ttsModel').value;
    document.getElementById('ttsIntervalRow').style.display = model === 'google' ? 'block' : 'none';
    await loadVoiceOptions(model);
}

async function loadVoiceOptions(model) {
    const select = document.getElementById('ttsVoice');
    select.innerHTML = '<option value="">加载中...</option>';
    if (voiceListCache[model] && voiceListCache[model].length > 0) {
        select.innerHTML = voiceListCache[model].map(v => `<option value="${v.name}">${v.dname}</option>`).join('');
        return;
    }
    try {
        const res = await fetch(BASE + '/api/voice-options?model=' + model);
        const json = await res.json();
        const voices = (json.voices || []).map(v => ({ name: v.name, dname: v.displayName || v.name }));
        voiceListCache[model] = voices;
        select.innerHTML = voices.map(v => `<option value="${v.name}">${v.dname}</option>`).join('');
    } catch (err) {
        select.innerHTML = '<option value="">加载失败</option>';
    }
}

async function playVoiceDemo() {
    const voice = document.getElementById('ttsVoice').value;
    const model = document.getElementById('ttsModel').value;
    if (!voice) return showToast('请先选择音色', 'warning');
    const btn = document.getElementById('btnVoiceDemo');
    btn.disabled = true;
    btn.textContent = '⏳...';
    const audio = document.getElementById('demoAudio');
    audio.src = BASE + '/api/voice-sample/' + encodeURIComponent(voice) + '?model=' + model;
    audio.volume = 0.6;
    try {
        await audio.play();
        showToast('正在试听...', 'info');
    } catch (err) { showToast('试听失败', 'error'); }
    audio.onended = () => { btn.disabled = false; btn.textContent = '🔊 试听'; };
    audio.onerror = () => { btn.disabled = false; btn.textContent = '🔊 试听'; showToast('试听加载失败', 'error'); };
    setTimeout(() => { if (!audio.ended && audio.src) { btn.disabled = false; btn.textContent = '🔊 试听'; } }, 8000);
}

async function executeTts() {
    const voice = document.getElementById('ttsVoice').value;
    const model = document.getElementById('ttsModel').value;
    const interval = parseFloat(document.getElementById('ttsInterval').value) || 0;
    const useTextName = document.getElementById('ttsUseTextName').checked;
    if (!voice) return showToast('请选择音色', 'warning');
    const btn = document.getElementById('btnConfirmTts');
    const progressDiv = document.getElementById('ttsProgress');
    const progressLabel = document.getElementById('ttsProgressLabel');
    const progressFill = document.getElementById('ttsProgressFill');
    const footer = document.getElementById('ttsFooter');
    const closeBtn = document.getElementById('modalTtsClose');
    btn.disabled = true;
    footer.style.display = 'none';
    progressDiv.style.display = 'block';
    closeBtn.style.display = 'none';
    const total = pendingTtsItems.length;
    let completed = 0;
    progressLabel.textContent = `正在生成... 0/${total}`;
    progressFill.style.width = '0%';
    try {
        for (const item of pendingTtsItems) {
            let namingText = '';
            if (useTextName && item.fromTextId) {
                const origin = textList.find(t => t.id === item.fromTextId);
                if (origin && origin.text) namingText = origin.text.slice(0, 50).replace(/[\\\/:*?"<>|]/g, '');
            }
            if (!namingText && useTextName && item.text) namingText = item.text.slice(0, 50).replace(/[\\\/:*?"<>|]/g, '');
            const res = await fetch(BASE + '/api/generate-speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: item.text,
                    targetLanguage: item.lang,
                    voiceName: voice,
                    model: model,
                    paragraphInterval: model === 'google' ? interval : 0,
                    useContentFileName: useTextName,
                    namingText: namingText,
                    skipTranslate: true,
                    transcriptionId: item.id
                })
            });
            if (res.ok) {
                const json = await res.json();
                audioList.push({
                    id: genId(),
                    file: json.audioFileName,
                    display: json.displayFileName || json.audioFileName,
                    source: item.source,
                    lang: item.lang,
                    selected: false
                });
                renderAudioList();
            }
            completed++;
            progressLabel.textContent = `正在生成... ${completed}/${total}`;
            progressFill.style.width = ((completed / total) * 100) + '%';
        }
        audioList.forEach(item => item.selected = true);
        renderAudioList();
        updateWorkflowSteps();
        closeModal('modalTts');
        switchTab('tab-audio', document.querySelector('.tab-btn[data-tab="tab-audio"]'));
        showToast('语音生成完成！共 ' + completed + ' 个音频', 'success');
    } catch (err) {
        showToast('语音生成失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        footer.style.display = 'flex';
        progressDiv.style.display = 'none';
        closeBtn.style.display = '';
        pendingTtsItems = [];
    }
}

/* ========== 音频列表 ========== */
function renderAudioList() {
    const container = document.getElementById('audioListContainer');
    const btnDownload = document.getElementById('btnBatchDownloadAudio');
    const btnDel = document.getElementById('btnDelAudio');
    if (audioList.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎧</div><div class="empty-text">暂无生成音频</div><div class="empty-sub">在翻译结果中勾选条目，点击"生成语音"即可</div></div>';
        btnDownload.disabled = true;
        btnDel.disabled = true;
        return;
    }
    container.innerHTML = audioList.map((item, i) => `
        <div class="audio-card">
          <div class="ac-top">
            <label class="checkbox-wrap"><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="audioList[${i}].selected=this.checked;updateToolbarAudio();"></label>
            <span class="badge ${getBadgeClass(item.lang)}">${getLangName(item.lang)}</span>
            <span class="source-tag" title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</span>
          </div>
          <div class="ac-name" title="${escapeHtml(item.display || item.file)}">${escapeHtml(item.display || item.file)}</div>
          <div class="ac-row" style="margin-top:5px;">
            <button class="btn btn-primary btn-sm" id="playBtn${i}" onclick="togglePlayAudio(${i})">▶ 播放</button>
            <button class="btn btn-outline btn-sm" onclick="downloadAudioFile('${escapeHtml(item.file)}','${escapeHtml(item.display || item.file)}')">📥 下载</button>
            <button class="btn btn-ghost btn-sm" style="color:#ef4444;" onclick="deleteAudio(${i})">✕</button>
          </div>
          <div id="audioProgressWrap${i}" style="display:none;margin-top:7px;">
            <div class="audio-progress-bar" onclick="seekAudio(event, ${i})"><div class="audio-progress-fill" id="audioProgressFill${i}" style="width:0%;"></div></div>
            <div class="audio-time" id="audioTime${i}">0:00 / 0:00</div>
          </div>
          <audio id="audioEl${i}" style="display:none;" src="${BASE}/api/download-audio/${encodeURIComponent(item.file)}"
                preload="metadata" onloadedmetadata="onAudioLoaded(${i})" ontimeupdate="onAudioTick(${i})"
                onended="onAudioEnd(${i})" onerror="onAudioError(${i})"></audio>
        </div>`).join('');
    updateToolbarAudio();
}

function updateToolbarAudio() {
    const selCount = audioList.filter(i => i.selected).length;
    document.getElementById('btnBatchDownloadAudio').disabled = selCount === 0;
    document.getElementById('btnDelAudio').disabled = selCount === 0;
    document.getElementById('selectAllAudio').checked = audioList.length > 0 && audioList.every(i => i.selected);
}

function toggleAllAudio() {
    const c = document.getElementById('selectAllAudio').checked;
    audioList.forEach(i => i.selected = c);
    renderAudioList();
}

async function deleteAudio(index) {
    if (!await showConfirm('确定删除该音频记录？')) return;
    if (currentPlayIdx === index) stopAudio();
    audioList.splice(index, 1);
    renderAudioList();
    updateWorkflowSteps();
    showToast('已删除', 'success');
}

async function deleteSelectedAudio() {
    const sel = audioList.filter(i => i.selected);
    if (sel.length === 0) return showToast('请先勾选音频', 'warning');
    if (!await showConfirm(`确定删除选中的 ${sel.length} 个音频？`)) return;
    if (currentPlayIdx >= 0 && audioList[currentPlayIdx] && audioList[currentPlayIdx].selected) stopAudio();
    for (let i = audioList.length - 1; i >= 0; i--) { if (audioList[i].selected) audioList.splice(i, 1); }
    renderAudioList();
    updateWorkflowSteps();
    showToast('已批量删除', 'success');
}

function batchDownloadAudio() {
    const sel = audioList.filter(i => i.selected);
    if (sel.length === 0) return showToast('请先勾选音频', 'warning');
    sel.forEach(a => downloadAudioFile(a.file, a.display || a.file));
    showToast('开始批量下载', 'success');
}

async function downloadAudioFile(fileName, downloadName) {
    try {
        const response = await fetch(BASE + '/api/download-audio/' + encodeURIComponent(fileName), {
            method: 'GET',
            headers: { 'Accept': 'audio/*,*/*' }
        });
        if (!response.ok) throw new Error('下载失败');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName || fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        window.open(BASE + '/api/download-audio/' + encodeURIComponent(fileName), '_blank');
    }
}

/* ========== 音频播放 ========== */
function stopAudio() {
    if (currentAudioEl) {
        currentAudioEl.pause();
        currentAudioEl = null;
    }
    const oldIdx = currentPlayIdx;
    currentPlayIdx = -1;
    if (oldIdx >= 0) {
        const wrap = document.getElementById('audioProgressWrap' + oldIdx);
        const btn = document.getElementById('playBtn' + oldIdx);
        if (wrap) wrap.style.display = 'none';
        if (btn) btn.textContent = '▶ 播放';
    }
}

function togglePlayAudio(index) {
    if (currentPlayIdx === index) { stopAudio(); return; }
    stopAudio();
    currentPlayIdx = index;
    const audioEl = document.getElementById('audioEl' + index);
    const btn = document.getElementById('playBtn' + index);
    const wrap = document.getElementById('audioProgressWrap' + index);
    if (!audioEl) return;
    currentAudioEl = audioEl;
    audioEl.volume = 0.7;
    audioEl.play().catch(() => { showToast('音频加载失败', 'error'); stopAudio(); });
    if (btn) btn.textContent = '⏸ 暂停';
    if (wrap) wrap.style.display = 'block';
}

function onAudioLoaded(index) {
    const audioEl = document.getElementById('audioEl' + index);
    const timeDiv = document.getElementById('audioTime' + index);
    if (audioEl && timeDiv && audioEl.duration) timeDiv.textContent = '0:00 / ' + formatTime(audioEl.duration);
}

function onAudioTick(index) {
    const audioEl = document.getElementById('audioEl' + index);
    const fill = document.getElementById('audioProgressFill' + index);
    const timeDiv = document.getElementById('audioTime' + index);
    if (audioEl && fill && audioEl.duration) {
        const pct = (audioEl.currentTime / audioEl.duration) * 100;
        fill.style.width = pct + '%';
        if (timeDiv) timeDiv.textContent = formatTime(audioEl.currentTime) + ' / ' + formatTime(audioEl.duration);
    }
}

function onAudioEnd(index) {
    const btn = document.getElementById('playBtn' + index);
    const wrap = document.getElementById('audioProgressWrap' + index);
    const fill = document.getElementById('audioProgressFill' + index);
    if (btn) btn.textContent = '▶ 播放';
    if (wrap) wrap.style.display = 'none';
    if (fill) fill.style.width = '0%';
    currentPlayIdx = -1;
    currentAudioEl = null;
}

function onAudioError(index) {
    const btn = document.getElementById('playBtn' + index);
    const wrap = document.getElementById('audioProgressWrap' + index);
    if (btn) btn.textContent = '▶ 播放';
    if (wrap) wrap.style.display = 'none';
    currentPlayIdx = -1;
    currentAudioEl = null;
    showToast('音频加载出错', 'error');
}

function seekAudio(event, index) {
    const audioEl = document.getElementById('audioEl' + index);
    if (!audioEl || !audioEl.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audioEl.currentTime = pct * audioEl.duration;
}

/* ========== 全局 ========== */
function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    const content = document.getElementById(tabId);
    if (content) content.classList.add('active');
    if (btn) btn.classList.add('active');
}

async function clearAllData() {
    if (!await showConfirm('⚠️ 确定清空所有上传文件、文案、翻译和音频数据？此操作不可恢复！')) return;
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
});