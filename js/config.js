// ================== 全局配置与工具类 ==================
const CONFIG = {
    POSITIVE_PROMPT: "masterpiece, best quality, 8K UHD, ultra detailed, hyper realistic, intricate details, sharp focus, cinematic lighting, professional photography, vibrant colors, depth of field, cinematic composition",
    NEGATIVE_PROMPT: "worst quality, low quality, blurry, pixelated, ugly, deformed, disfigured, bad anatomy, extra limbs, missing fingers, watermark, text, signature",
    YT_API_KEYS: [
        "AIzaSyBX7YiD9hL6V5_uoG-5dVvoZ6mdNTvLWIM",
        "AIzaSyDIC5HCCD0UIjHu3F988-3rYg7Eax2hnAQ",
        "AIzaSyCYRu3QAFeX9fIqBBrA0LD5Hysut-NFpqs"
    ],
    YT_CONCURRENT_BATCH_SIZE: 10
};

const STATE = {
    extractedLinks: [],
    extractedLangs: [],
    ytApiKeyStatus: {},
    youtubeApiReady: false,
    ytPlayer: null,
    currentVideoId: "",
    sortState: 'original',
    originalRows: [],
    currentKeyIndex: 0
};

CONFIG.YT_API_KEYS.forEach(key => {
    STATE.ytApiKeyStatus[key] = { lastUsed: null, errorCount: 0, isActive: true, quotaExceeded: false };
});

// ========== 通用 UI 工具函数 ==========
function showToast(msg = "已复制到剪贴板") {
    const toast = document.getElementById('toast');
    document.getElementById("toastMessage").innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

function copyToClipboard(text) {
    return navigator.clipboard.writeText(text).then(() => showToast()).catch(err => console.error('复制失败:', err));
}

function copyLineText(button) {
    copyToClipboard(button.parentElement.textContent.replace('复制', '').trim());
}

function copyCodeBlock(button) {
    const code = button.parentElement.querySelector('code').textContent;
    copyToClipboard(code).then(() => {
        const originalText = button.textContent;
        button.textContent = '已复制!';
        setTimeout(() => button.textContent = originalText, 2000);
    });
}

// ========== Shorts 播放器相关函数 ==========
function extractVideoIdSimple(url) {
    try {
        let cleanUrl = url.replace(/\?_.*$/, '');
        if (cleanUrl.includes('youtube.com/watch?v=')) return cleanUrl.split('v=')[1].split('&')[0];
        if (cleanUrl.includes('youtu.be/')) return cleanUrl.split('youtu.be/')[1].split('?')[0];
        if (cleanUrl.includes('youtube.com/shorts/')) return cleanUrl.split('shorts/')[1].split('?')[0];
    } catch (e) { }
    return null;
}




function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function openShortsPlayer(videoUrl, videoData) {
    const overlay = document.getElementById('shortsPlayerOverlay');
    document.getElementById('shortsChannelNameBottom').innerText = videoData.channel || '频道名称';
    const avatar = document.getElementById('shortsChannelAvatar');
    if (videoData.channel) {
        avatar.style.backgroundColor = stringToColor(videoData.channel);
        avatar.innerText = videoData.channel.charAt(0).toUpperCase();
    }
    document.getElementById('shortsLikeCount').innerText = videoData.likeCount || '0';
    document.getElementById('shortsCommentCount').innerText = videoData.commentCount || '0';
    document.getElementById('shortsViewCountBadge').innerText = '👁 ' + (videoData.viewCount || '0');
    document.getElementById('shortsLikeCountBadge').innerText = '👍 ' + (videoData.likeCount || '0');
    const vid = extractVideoIdSimple(videoUrl);
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${vid}?autoplay=1&controls=0&modestbranding=1&rel=0&showinfo=0&playsinline=1`;
    iframe.allow = 'autoplay; encrypted-media';
    iframe.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;border:none;';
    const wrapper = document.getElementById('shortsPlayerIframe');
    wrapper.innerHTML = '';
    wrapper.appendChild(iframe);
    overlay.classList.add('show');
    startShortsProgress();
}

function closeShortsPlayer() {
    const overlay = document.getElementById('shortsPlayerOverlay');
    overlay.classList.remove('show');
    document.getElementById('shortsPlayerIframe').innerHTML = '';
    stopShortsProgress();
}

let progressInterval;
function startShortsProgress() {
    const fill = document.getElementById('shortsProgressFill');
    fill.style.width = '0%';
    let progress = 0;
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        progress += 0.5;
        fill.style.width = Math.min(progress, 100) + '%';
        if (progress >= 100) clearInterval(progressInterval);
    }, 200);
}

function stopShortsProgress() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    document.getElementById('shortsProgressFill').style.width = '0%';
}

// ========== 历史记录管理 ==========
function saveHistory(urls, tableData) {
    const history = JSON.parse(localStorage.getItem('youtubeQueryHistory') || '[]');
    history.unshift({
        timestamp: Date.now(),
        timeStr: new Date().toLocaleString('zh-CN'),
        urls: urls,
        tableData: tableData
    });
    if (history.length > 20) history.pop();
    localStorage.setItem('youtubeQueryHistory', JSON.stringify(history));
}

function getHistory() {
    return JSON.parse(localStorage.getItem('youtubeQueryHistory') || '[]');
}

function deleteHistory(index) {
    const history = getHistory();
    history.splice(index, 1);
    localStorage.setItem('youtubeQueryHistory', JSON.stringify(history));
    renderHistoryList();
}

function renderHistoryList() {
    const listEl = document.getElementById('historyList');
    const detailEl = document.getElementById('historyDetail');
    const history = getHistory();
    if (history.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:40px;">暂无查询历史</div>';
        return;
    }
    let html = '';
    history.forEach((item, index) => {
        html += `
        <div class="history-item">
            <div style="flex:1;">
                <div class="history-item-time">${item.timeStr}</div>
                <div style="font-size:13px;color:#6b7280;margin-top:4px;">${item.urls.length} 个链接</div>
            </div>
            <div class="history-item-actions">
                <button class="btn-copy-selected" onclick="fillAndQueryHistory(${index})" style="background: #3b82f6;"><i class="fas fa-arrow-left"></i> 填充当前表</button>
                <button onclick="viewHistoryDetail(${index})">查看详情</button>
                <button onclick="deleteHistory(${index})">删除</button>
            </div>
        </div>`;
    });
    listEl.innerHTML = html;
    detailEl.style.display = 'none';
}

function viewHistoryDetail(index) {
    const history = getHistory();
    const item = history[index];
    if (!item) return;
    const detailEl = document.getElementById('historyDetail');
    const listEl = document.getElementById('historyList');
    listEl.style.display = 'none';
    detailEl.style.display = 'block';
    let tableHtml = `
        <button class="history-back-btn" onclick="backToHistoryList()">← 返回列表</button>
        <div style="font-size:14px;color:#374151;margin-bottom:12px;">查询时间：${item.timeStr}（${item.urls.length} 个视频）</div>
        <button class="btn-copy-selected" onclick="copyHistoryUrls(${index})" style="margin-bottom:12px;"><i class="fas fa-copy"></i> 复制全部链接</button>
        <button class="btn-copy-selected" onclick="fillAndQueryHistory(${index})" style="background: #3b82f6;margin-bottom:12px;"><i class="fas fa-arrow-left"></i> 填充当前表</button>
        <table class="youtube-table">
            <thead><tr><th>链接</th><th>标题</th><th>频道</th><th>播放量</th><th>评论</th><th>发布</th><th>时长</th></tr></thead>
            <tbody>`;
    item.tableData.forEach(row => {
        tableHtml += `
            <tr>
                <td style="max-width:180px;word-break:break-all;font-size:12px;">${row.url}</td>
                <td>${row.title || '—'}</td><td>${row.channel || '—'}</td><td>${row.viewCount || '—'}</td>
                <td>${row.commentCount || '—'}</td><td>${row.published || '—'}</td><td>${row.duration || '—'}</td>
            </tr>`;
    });
    tableHtml += '</tbody></table>';
    detailEl.innerHTML = tableHtml;
}

function backToHistoryList() {
    document.getElementById('historyDetail').style.display = 'none';
    document.getElementById('historyList').style.display = 'flex';
}

function copyHistoryUrls(index) {
    const history = getHistory();
    const urls = history[index]?.tableData?.map(r => r.url) || [];
    if (urls.length) {
        copyToClipboard(urls.join('\n'));
        showToast(`已复制 ${urls.length} 个链接`);
    }
}

function openHistory() {
    document.getElementById('historyOverlay').style.display = 'flex';
    renderHistoryList();
}

function closeHistory() {
    document.getElementById('historyOverlay').style.display = 'none';
}

document.addEventListener('click', function (e) {
    if (e.target.id === 'historyOverlay') closeHistory();
});

function fillAndQueryHistory(index) {
    const history = getHistory();
    const item = history[index];
    if (!item || !item.urls || !item.urls.length) {
        showToast('没有可填充的链接');
        return;
    }
    document.getElementById('youtubeUrls').value = item.urls.join('\n');
    closeHistory();
    if (window.Modules && typeof window.Modules.processYoutubeUrls === 'function') {
        window.Modules.processYoutubeUrls();
    } else {
        console.error('查询模块未就绪');
    }
    showToast('已填充链接并开始查询');
}

function saveSortPreference(state) {
    localStorage.setItem('youtubeSortPreference', state);
}

function loadSortPreference() {
    return localStorage.getItem('youtubeSortPreference') || null;
}