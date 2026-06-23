// ================== YouTube 数据查询辅助函数 ==================

function extractVideoId(url) {
    try {
        if (url.includes('youtube.com/watch?v=')) return url.split('v=')[1].split('&')[0];
        if (url.includes('youtu.be/')) return url.split('youtu.be/')[1].split('?')[0];
        if (url.includes('youtube.com/shorts/')) return url.split('shorts/')[1].split('?')[0];
    } catch (e) { }
    return null;
}

function formatNumber(num) {
    const n = parseInt(num);
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
    if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
    return n.toString();
}

function parseDuration(duration) {
    const m = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
    const parts = [];
    if (m[1]) parts.push(m[1] + '小时');
    if (m[2]) parts.push(m[2] + '分钟');
    if (m[3]) parts.push(m[3] + '秒');
    return parts.join('') || "未知";
}

function formatUploadDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return "今天";
    if (diff === 1) return "昨天";
    if (diff < 30) return diff + "天前";
    if (diff < 365) return Math.floor(diff / 30) + "个月前";
    return Math.floor(diff / 365) + "年前";
}

function getAvailableKeyFromPool() {
    const totalKeys = CONFIG.YT_API_KEYS.length;
    for (let i = 0; i < totalKeys; i++) {
        const idx = (STATE.currentKeyIndex + i) % totalKeys;
        const key = CONFIG.YT_API_KEYS[idx];
        if (STATE.ytApiKeyStatus[key].isActive && !STATE.ytApiKeyStatus[key].quotaExceeded) {
            STATE.currentKeyIndex = (idx + 1) % totalKeys;
            return key;
        }
    }
    return null;
}

async function fetchVideoDataWithRetry(vid, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const key = getAvailableKeyFromPool();
        if (!key) {
            if (attempt < maxRetries - 1) { await delay(300 * (attempt + 1)); continue; }
            return null;
        }
        try {
            const r = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=${vid}&key=${key}`
            );
            if (r.status === 403) {
                STATE.ytApiKeyStatus[key].quotaExceeded = true;
                STATE.ytApiKeyStatus[key].isActive = false;
                continue;
            }
            if (!r.ok) { await delay(200 * (attempt + 1)); continue; }
            const j = await r.json();
            return j.items?.[0] || null;
        } catch (err) {
            if (attempt < maxRetries - 1) await delay(300 * (attempt + 1));
        }
    }
    return null;
}

function getBestThumbnailFromSnippet(snippet) {
    if (!snippet || !snippet.thumbnails) return null;
    const thumbs = snippet.thumbnails;
    return thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null;
}

async function getBestThumbnail(vid) {
    const url = `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
    try {
        const r = await fetch(url, { method: 'HEAD' });
        if (r.ok) return url;
    } catch (e) { }
    return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

async function getLosslessShortThumbnail(videoId) {
    try {
        const highResUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
        const img = await loadImage(highResUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.height * (9 / 16);
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, Math.round((img.width - canvas.width) / 2), 0, Math.round(canvas.width), img.height, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.9);
    } catch (error) {
        return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }
}

async function copyImage(img) {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const tempImg = new Image();
        tempImg.crossOrigin = 'anonymous';
        tempImg.src = img.src;
        await new Promise((resolve, reject) => {
            tempImg.onload = resolve;
            tempImg.onerror = reject;
        });
        canvas.width = tempImg.naturalWidth;
        canvas.height = tempImg.naturalHeight;
        ctx.drawImage(tempImg, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast("缩略图已复制");
    } catch (error) {
        await copyToClipboard(img.src);
        showToast("复制失败，已复制图片链接");
    }
}

async function downloadAllThumbnails() {
    const imgs = document.querySelectorAll(".youtube-thumbnail");
    if (!imgs.length) return;
    const zip = new JSZip();
    const f = zip.folder("youtube_thumbnails");
    const dp = document.getElementById("downloadProgress");
    dp.style.display = "block";
    for (let i = 0; i < imgs.length; i++) {
        try {
            const r = await fetch(imgs[i].src);
            const b = await r.blob();
            f.file(`${i + 1}.jpg`, b);
            const pct = Math.round(((i + 1) / imgs.length) * 100);
            document.getElementById("downloadProgressBar").style.width = pct + "%";
            document.getElementById("downloadProgressPercent").innerText = pct + "%";
            document.getElementById("downloadProgressText").innerText = `打包中 ${i + 1}/${imgs.length}`;
        } catch (e) { }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "youtube_thumbnails.zip";
    a.click();
    dp.style.display = "none";
    showToast("全部缩略图已打包下载");
}

function showVideoPlayer(url) {
    const tr = event.target.closest('tr');
    if (!tr) {
        openShortsPlayer(url, {
            title: '未知标题',
            channel: '未知频道',
            likeCount: '0',
            commentCount: '0',
            viewCount: '0',
            thumbnail: `https://i.ytimg.com/vi/${extractVideoIdSimple(url)}/mqdefault.jpg`
        });
        return;
    }
    const cells = tr.cells;
    let title = '', channel = '', likeCount = '0', commentCount = '0', viewCount = '0', thumbnail = '';
    if (cells.length >= 9) {
        title = cells[2]?.innerText.trim() || '未知标题';
        channel = cells[3]?.innerText.trim() || '未知频道';
        likeCount = tr.getAttribute('data-likecount') || '0';
        commentCount = cells[5]?.innerText.trim() || '0';
        viewCount = cells[4]?.innerText.trim() || '0';
        const img = cells[8]?.querySelector('img');
        if (img) thumbnail = img.src;
    }
    openShortsPlayer(url, { title, channel, likeCount, commentCount, viewCount, thumbnail });
}

function hideVideoPlayer() {
    const o = document.getElementById("videoPlayerOverlay");
    o.classList.remove("show");
    if (STATE.ytPlayer) STATE.ytPlayer.stopVideo();
}

function copyYoutubeColumn(colIndex) {
    const table = document.querySelector('.youtube-table');
    if (!table) return;
    const rows = table.querySelectorAll('tbody tr');
    const textList = [];
    rows.forEach(row => {
        const cell = row.cells[colIndex];
        if (!cell) return;
        let val;
        if (colIndex === 1) {
            const linkDiv = cell.querySelector('.link-url-text');
            val = linkDiv ? linkDiv.textContent.trim() : '';
        } else {
            val = cell.innerText.trim().replace(/^获取失败$/, '');
        }
        if (!val) return;
        if (colIndex === 4) val = `播放量：${val}`;
        textList.push(val);
    });
    if (textList.length) copyToClipboard(textList.join('\n')).then(() => showToast(`已复制该列共 ${textList.length} 条数据`));
}

function parseViewCount(str) {
    if (!str || str.includes('失败')) return 0;
    str = str.trim();
    if (str.includes('亿')) return parseFloat(str) * 100000000;
    if (str.includes('w')) return parseFloat(str) * 10000;
    const num = parseInt(str.replace(/[^0-9]/g, ''));
    return isNaN(num) ? 0 : num;
}

function toggleSortViews() {
    const tbody = document.querySelector('.youtube-table tbody');
    if (!tbody) return;
    const icon = document.getElementById('sortIcon');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    switch (STATE.sortState) {
        case 'original':
            rows.sort((a, b) => {
                const viewA = parseViewCount(a.cells[4].innerText);
                const viewB = parseViewCount(b.cells[4].innerText);
                return viewB - viewA;
            });
            STATE.sortState = 'desc';
            icon.className = 'fas fa-sort-amount-down';
            showToast('播放量已降序排列（从高到低）');
            break;
        case 'desc':
            rows.sort((a, b) => {
                const viewA = parseViewCount(a.cells[4].innerText);
                const viewB = parseViewCount(b.cells[4].innerText);
                return viewA - viewB;
            });
            STATE.sortState = 'asc';
            icon.className = 'fas fa-sort-amount-up';
            showToast('播放量已升序排列（从低到高）');
            break;
        case 'asc':
            if (STATE.originalRows.length > 0) {
                tbody.innerHTML = '';
                STATE.originalRows.forEach(row => tbody.appendChild(row));
            }
            STATE.sortState = 'original';
            icon.className = 'fas fa-sort';
            showToast('已恢复原始顺序');
            break;
    }
    if (STATE.sortState !== 'original') {
        rows.forEach(row => tbody.appendChild(row));
    }
}

function convertToShort() {
    const textarea = document.getElementById('youtubeUrls');
    const text = textarea.value.trim();
    if (!text) return showToast('请先输入链接');
    const lines = text.split('\n').map(line => line.trim());
    const result = lines.map(line => {
        const vid = extractVideoId(line);
        return vid ? `https://www.youtube.com/shorts/${vid}` : line;
    });
    textarea.value = result.join('\n');
    showToast('已转换为 Shorts 标准链接');
}

// ⚡ 核心：并发批量查询（需要在 Modules 上下文中调用，这里定义为全局函数）
async function processYoutubeUrls() {
    const text = document.getElementById("youtubeUrls").value.trim();
    const lines = text.split("\n").map(i => i.trim()).filter(Boolean);
    if (lines.length === 0) return showToast("请输入至少一个YouTube链接");

    const btn = document.getElementById("youtubeFetchBtn");
    const bar = document.getElementById("youtubeProgressContainer");
    const pText = document.getElementById("youtubeProgressText");
    const pCount = document.getElementById("youtubeProgressCount");
    const pBar = document.getElementById("youtubeProgressBar");
    const area = document.getElementById("youtubeResultsArea");
    const batchSize = CONFIG.YT_CONCURRENT_BATCH_SIZE;

    btn.disabled = true;
    bar.style.display = "block";
    area.innerHTML = "";
    pBar.style.width = "0%";
    pText.innerText = "⚡ 正在准备并发查询...";
    pCount.innerText = `0/${lines.length}`;

    const parsedItems = [];
    for (let i = 0; i < lines.length; i++) {
        const url = lines[i];
        const vid = extractVideoId(url);
        if (vid) {
            parsedItems.push({ url, vid, idx: i, isShort: url.includes("shorts") });
        }
    }

    if (parsedItems.length === 0) {
        btn.disabled = false;
        bar.style.display = "none";
        return showToast("未找到有效的YouTube链接");
    }

    const validUrls = parsedItems.map(p => p.url);

    // 创建表格 
    const table = document.createElement("table");
    table.className = "youtube-table";
    table.innerHTML = `
    <thead>
        <tr>
            <th class="select-col">
                <div class="select-all-checkbox-wrap">
                    <input type="checkbox" id="selectAllCheckbox" onclick="toggleAllCheckboxes(this)" title="全选/取消全选">
                    <button class="btn-copy-selected" onclick="event.stopPropagation(); copySelectedUrls()" title="复制选中行的链接"><i class="fas fa-copy"></i><span>复制选中</span></button>
                </div>
            </th>
            <th onclick="window.copyYoutubeColumn(1)">视频链接<br><small style="font-size:11px;opacity:0.6;font-weight:400;">点击复制整列</small></th>
            <th onclick="window.copyYoutubeColumn(2)">标题<br><small style="font-size:11px;opacity:0.6;font-weight:400;">点击复制</small></th>
            <th onclick="window.copyYoutubeColumn(3)">频道<br><small style="font-size:11px;opacity:0.6;font-weight:400;">点击复制</small></th>
            <th onclick="window.copyYoutubeColumn(4)" style="cursor: pointer;">
                播放 
                <button id="sortViewsBtn" class="sort-btn" style="margin-left:5px;">
                    <i id="sortIcon" class="fas fa-sort"></i>
                </button>
            </th>
            <th onclick="window.copyYoutubeColumn(5)">评论<br><small style="font-size:11px;opacity:0.6;font-weight:400;">点击复制</small></th>
            <th onclick="window.copyYoutubeColumn(6)">发布<br><small style="font-size:11px;opacity:0.6;font-weight:400;">点击复制</small></th>
            <th onclick="window.copyYoutubeColumn(7)">时长<br><small style="font-size:11px;opacity:0.6;font-weight:400;">点击复制</small></th>
            <th onclick="window.downloadAllThumbnails()" title="点击打包下载所有缩略图">缩略图<br><small style="font-size:11px;opacity:0.6;font-weight:400;">点击打包下载</small></th>
        </tr>
    </thead>
    <tbody></tbody>`;
    area.appendChild(table);
    const tbody = table.querySelector("tbody");

    const rowRefs = [];
    for (const item of parsedItems) {
        const { url, vid, idx, isShort } = item;
        const tr = document.createElement("tr");
        tr.setAttribute('data-url', url);

        const tdCheck = document.createElement("td");
        tdCheck.className = "select-col";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "row-checkbox";
        cb.addEventListener('change', function () {
            if (this.checked) tr.classList.add('row-selected');
            else tr.classList.remove('row-selected');
            const count = document.querySelectorAll('.row-checkbox:checked').length;
            const span = document.querySelector('.btn-copy-selected span');
            if (span) span.textContent = count > 0 ? `复制选中 (${count})` : '复制选中';
        });
        tdCheck.appendChild(cb);
        tr.appendChild(tdCheck);

        const td1 = document.createElement("td");
        td1.innerHTML = `
    <div class="link-url-text" style="font-size:12px;word-break:break-all;margin-bottom:6px;">${url}</div>
    <div class="youtube-link-btns">
        <button class="youtube-link-btn play" onclick="window.showVideoPlayer('${url}')"><i class="fas fa-play"></i>播放</button>
        <button class="youtube-link-btn jump" onclick="window.open('${url}','_blank')"><i class="fas fa-external-link-alt"></i>打开</button>
        <button class="youtube-link-btn copy" onclick="navigator.clipboard.writeText('${url}').then(()=>showToast('链接已复制'))"><i class="fas fa-copy"></i>复制</button>
    </div>`;
        tr.appendChild(td1);

        const td2 = document.createElement("td");
        td2.className = "youtube-title-cell";
        td2.innerText = "加载中...";
        tr.appendChild(td2);
        const td3 = document.createElement("td");
        td3.innerText = "...";
        tr.appendChild(td3);
        const td4 = document.createElement("td");
        td4.innerText = "...";
        tr.appendChild(td4);
        const td5 = document.createElement("td");
        td5.innerText = "...";
        tr.appendChild(td5);
        const td6 = document.createElement("td");
        td6.innerText = "...";
        tr.appendChild(td6);
        const td7 = document.createElement("td");
        td7.innerText = "...";
        tr.appendChild(td7);

        const td8 = document.createElement("td");
        const wrap = document.createElement("div");
        wrap.className = "youtube-thumbnail-container";
        const img = document.createElement("img");
        img.className = "youtube-thumbnail";
        img.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
        img.onerror = function () { this.src = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`; };
        const badge = document.createElement("div");
        badge.className = "youtube-badge";
        badge.innerText = isShort ? `#${idx + 1}竖` : `#${idx + 1}`;
        wrap.appendChild(img);
        wrap.appendChild(badge);
        td8.appendChild(wrap);
        tr.appendChild(td8);

        tbody.appendChild(tr);

        [td2, td3, td4, td5, td6, td7].forEach(cell => {
            cell.onclick = () => copyToClipboard(cell.innerText);
        });
        img.onclick = async () => {
            await copyImage(img);
            badge.innerText = "已复制";
            badge.classList.add('copied');
        };

        rowRefs.push({ tr, td2, td3, td4, td5, td6, td7, img, badge, url, vid, isShort, idx });
    }

    STATE.originalRows = Array.from(tbody.children);
    STATE.sortState = 'original';

    let completedCount = 0;
    const totalCount = parsedItems.length;
    const startTime = Date.now();

    const batches = [];
    for (let i = 0; i < parsedItems.length; i += batchSize) {
        batches.push(parsedItems.slice(i, i + batchSize));
    }

    pText.innerText = `⚡ 并发查询中（${batchSize}个/批，共${batches.length}批）...`;
    pCount.innerText = `0/${totalCount}`;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        pText.innerText = `⚡ 并发查询第 ${batchIdx + 1}/${batches.length} 批（${batch.length}个并发）...`;

        const batchResults = await Promise.allSettled(
            batch.map(item => fetchVideoDataWithRetry(item.vid, 3))
        );

        for (let j = 0; j < batchResults.length; j++) {
            const item = batch[j];
            const result = batchResults[j];
            const ref = rowRefs.find(r => r.vid === item.vid);
            if (!ref) continue;

            completedCount++;
            pCount.innerText = `${completedCount}/${totalCount}`;
            pBar.style.width = (completedCount / totalCount) * 100 + "%";

            if (result.status === 'fulfilled' && result.value) {
                const data = result.value;
                const snippet = data.snippet;
                const stats = data.statistics;
                const contentDetails = data.contentDetails;

                const title = snippet.title;
                ref.td2.innerText = title.length > 22 ? title.substring(0, 22) + "..." : title;
                ref.td2.title = title;
                ref.td3.innerText = snippet.channelTitle;
                ref.td4.innerHTML = `<span class="youtube-view-count">${formatNumber(stats.viewCount || 0)}</span>`;
                ref.td5.innerText = formatNumber(stats.commentCount || 0);
                ref.td6.innerText = formatUploadDate(snippet.publishedAt);
                ref.td7.innerText = parseDuration(contentDetails.duration);
                ref.tr.setAttribute('data-likecount', stats.likeCount || '0');

                const apiThumb = getBestThumbnailFromSnippet(snippet);
                if (apiThumb && !item.isShort) {
                    ref.img.src = apiThumb;
                } else if (item.isShort) {
                    getLosslessShortThumbnail(item.vid).then(u => { ref.img.src = u; });
                } else {
                    ref.img.src = `https://i.ytimg.com/vi/${item.vid}/maxresdefault.jpg`;
                    ref.img.onerror = function () {
                        this.src = `https://i.ytimg.com/vi/${item.vid}/hqdefault.jpg`;
                    };
                }
            } else {
                [ref.td2, ref.td3, ref.td4, ref.td5, ref.td6, ref.td7].forEach(c => c.innerHTML = `<span class='youtube-error'>获取失败</span>`);
            }
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    btn.disabled = false;
    pText.innerText = `✅ 查询完成（${totalCount}个视频，耗时${elapsed}秒，${batchSize}并发）`;
    showToast(`YouTube 数据查询完成！${totalCount}个视频，耗时${elapsed}秒`);

    const tableData = [];
    rowRefs.forEach(ref => {
        tableData.push({
            url: ref.url,
            title: ref.td2.innerText || '',
            channel: ref.td3.innerText || '',
            viewCount: ref.td4.innerText || '',
            commentCount: ref.td5.innerText || '',
            published: ref.td6.innerText || '',
            duration: ref.td7.innerText || '',
            likeCount: ref.tr.getAttribute('data-likecount') || '0'
        });
    });
    saveHistory(validUrls, tableData);

    const savedPref = loadSortPreference();
    if (savedPref === 'desc' || savedPref === 'asc') {
        const tbody = document.querySelector('.youtube-table tbody');
        if (tbody) {
            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows.sort((a, b) => {
                const viewA = parseViewCount(a.cells[4].innerText);
                const viewB = parseViewCount(b.cells[4].innerText);
                return savedPref === 'desc' ? viewB - viewA : viewA - viewB;
            });
            rows.forEach(row => tbody.appendChild(row));
            STATE.sortState = savedPref;
            const icon = document.getElementById('sortIcon');
            if (icon) icon.className = savedPref === 'desc' ? 'fas fa-sort-amount-down' : 'fas fa-sort-amount-up';
        }
    }
}