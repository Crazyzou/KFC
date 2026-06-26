(function () {
    'use strict';

    // ==================== 配置 ====================
    const BQB_API_URL = 'https://tower-pc.tail3cd725.ts.net/api/bqb';
    const DEFAULT_LIMIT = 60;
    const FETCH_TIMEOUT = 15000;

    function getProxiedImgUrl(originalUrl) {
        if (!originalUrl) return '';
        const proxyBase = new URL(BQB_API_URL).origin + '/proxy-image';
        const params = new URLSearchParams();
        params.set('url', originalUrl);
        return `${proxyBase}?${params.toString()}`;
    }

    // ==================== DOM 引用 ====================
    let btnRandom, btnSearch, searchInput, grid, loading, loadingText, stats, countEl;
    let isFetching = false;

    const failedQueue = new Map();
    let batchTimer = null;
    const BATCH_DELAY = 300;

    function $(id) { return document.getElementById(id); }

    function showToast(msg, icon) {
        const toastEl = $('toast');
        const msgEl = $('toastMessage');
        if (!toastEl || !msgEl) return;
        msgEl.textContent = msg;
        const iconEl = toastEl.querySelector('i');
        if (iconEl && icon) iconEl.className = `fas ${icon}`;
        toastEl.classList.add('show');
        clearTimeout(toastEl._timeout);
        toastEl._timeout = setTimeout(() => toastEl.classList.remove('show'), 2200);
    }

    async function fetchWithTimeout(url, timeout, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { signal: controller.signal, ...options });
            return res;
        } finally {
            clearTimeout(timer);
        }
    }

    async function copyImageToClipboard(originalUrl, blobInfo = null) {
        const proxyUrl = getProxiedImgUrl(originalUrl);

        async function convertBlobToPng(blob) {
            if (blob.type === 'image/png') return blob;
            try {
                const bitmap = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);
                bitmap.close();
                return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            } catch {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    const url = URL.createObjectURL(blob);
                    img.onload = () => {
                        URL.revokeObjectURL(url);
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        canvas.toBlob(resolve, 'image/png');
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        reject(new Error('图片解码失败'));
                    };
                    img.src = url;
                });
            }
        }

        const blobInfoPromise = blobInfo
            ? Promise.resolve(blobInfo)
            : (async () => {
                let res;
                try {
                    res = await fetchWithTimeout(proxyUrl, 12000);
                    if (!res.ok) throw new Error('proxy fail');
                } catch {
                    res = await fetch(originalUrl);
                }
                const blob = await res.blob();
                if (!blob || blob.size === 0 || !blob.type.startsWith('image/'))
                    throw new Error('无效图片');
                return { blob, mime: blob.type };
            })();

        const pngBlobPromise = blobInfoPromise.then(info => convertBlobToPng(info.blob));
        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlobPromise })
            ]);
        } catch (e) {
            console.error('[BQB] 无法写入 PNG，完全失败:', e);
            try {
                await navigator.clipboard.writeText(originalUrl);
                return 'url';
            } catch { return null; }
        }

        const gifBlobPromise = blobInfoPromise.then(info => {
            if (info.mime === 'image/gif') return info.blob;
            throw new Error('not gif');
        });
        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/gif': gifBlobPromise })
            ]);
            return 'blob';
        } catch (e) {
            console.info('[BQB] 浏览器不支持 GIF 写入，保留静态图');
            return 'blob';
        }

        try {
            await navigator.clipboard.writeText(originalUrl);
            return 'url';
        } catch { return null; }
    }

    function scheduleBatchProxy(imgElement, originalUrl) {
        if (!failedQueue.has(originalUrl)) {
            failedQueue.set(originalUrl, new Set());
        }
        failedQueue.get(originalUrl).add(imgElement);
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(processBatchProxy, BATCH_DELAY);
    }

    async function processBatchProxy() {
        batchTimer = null;
        const urlMap = new Map();
        for (const [url, imgs] of failedQueue.entries()) {
            urlMap.set(url, imgs);
        }
        failedQueue.clear();
        if (urlMap.size === 0) return;

        const urls = Array.from(urlMap.keys());
        try {
            const proxyUrl = new URL(BQB_API_URL).origin + '/proxy-images-batch';
            const res = await fetchWithTimeout(proxyUrl, 20000, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls })
            });
            if (!res.ok) throw new Error(`Batch proxy HTTP ${res.status}`);
            const json = await res.json();
            const results = json.data || [];

            for (const item of results) {
                if (!item.success || !item.data) continue;
                const imgs = urlMap.get(item.url);
                if (!imgs) continue;
                const dataUri = `data:${item.contentType};base64,${item.data}`;
                for (const img of imgs) {
                    if (img.parentNode) {
                        img.src = dataUri;
                        img.onerror = function () {
                            this.style.display = 'none';
                            this.nextElementSibling && (this.nextElementSibling.style.display = 'flex');
                        };
                    }
                }
                urlMap.delete(item.url);
            }

            for (const [url, imgs] of urlMap.entries()) {
                for (const img of imgs) {
                    if (img.parentNode) {
                        img.style.display = 'none';
                        img.nextElementSibling && (img.nextElementSibling.style.display = 'flex');
                    }
                }
            }
        } catch (e) {
            console.error('[BQB] Batch proxy failed:', e);
            for (const imgs of urlMap.values()) {
                for (const img of imgs) {
                    if (img.parentNode) {
                        img.style.display = 'none';
                        img.nextElementSibling && (img.nextElementSibling.style.display = 'flex');
                    }
                }
            }
        }
    }

    // ==================== API 调用 ====================
    async function fetchBqb(params = {}) {
        const query = new URLSearchParams({
            type: params.type || 1,
            limit: params.limit || DEFAULT_LIMIT,
            ...params.extra
        }).toString();
        const url = `${BQB_API_URL}?${query}`;
        const res = await fetchWithTimeout(url, FETCH_TIMEOUT);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return (json.data || []).map(item => ({
            name: item.name || '',
            category: item.category || '',
            url: item.url,
            originalUrl: item.url
        }));
    }

    // ==================== 渲染网格 ====================
    function renderGrid(items) {
        grid.innerHTML = '';
        if (items.length === 0) {
            grid.innerHTML = '<div class="bqb-empty"><i class="fas fa-face-frown"></i><p>暂时没有获取到表情包，请稍后再试</p></div>';
            return;
        }

        items.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'bqb-card';
            card.style.animationDelay = `${index * 0.03}s`;
            card.title = `点击复制: ${item.name}`;

            const img = document.createElement('img');
            img.className = 'bqb-img';
            img.alt = item.name;
            img.loading = 'lazy';
            img.setAttribute('data-original-url', item.originalUrl);
            img.src = item.url;

            img.onerror = function () {
                const originalUrl = this.getAttribute('data-original-url');
                scheduleBatchProxy(this, originalUrl);
            };

            const fallback = document.createElement('div');
            fallback.className = 'bqb-fallback';
            fallback.style.display = 'none';
            fallback.innerHTML = '<i class="fas fa-image"></i>';

            const nameEl = document.createElement('span');
            nameEl.className = 'bqb-name';
            nameEl.textContent = `表情${index + 1}`;

            card.addEventListener('click', async (e) => {
                e.preventDefault();

                card.classList.add('bqb-pressing');
                setTimeout(() => card.classList.remove('bqb-pressing'), 150);

                // 避免重复点击 
                if (card.dataset.processing === 'true') return;
                card.dataset.processing = 'true';

                try {
                    const proxyUrl = getProxiedImgUrl(item.originalUrl);
                    let res;
                    try {
                        // 使用 fetch，不带 signal，避免与 img 标签的加载冲突 
                        res = await fetch(proxyUrl, { cache: 'force-cache' });
                        if (!res.ok) throw new Error('proxy fail');
                    } catch {
                        res = await fetch(item.originalUrl, { cache: 'force-cache' });
                    }
                    const blob = await res.blob();
                    const mime = blob.type;

                    if (mime === 'image/gif') {
                        // GIF 下载到本地 
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = (item.name || `表情${index + 1}`) + '.gif';
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        showToast('GIF 已下载到本地', 'fa-download');
                    } else {
                        // 静态图复制到剪贴板 
                        const copied = await copyImageToClipboard(item.originalUrl, { blob, mime });
                        if (copied === 'blob') {
                            showToast('表情包已复制，可直接粘贴！', 'fa-check-circle');
                        } else if (copied === 'url') {
                            showToast('链接已复制到剪贴板', 'fa-link');
                        } else {
                            showToast('复制失败，请重试', 'fa-exclamation-circle');
                        }
                    }

                    // 成功反馈（轻量动画）
                    card.classList.add('bqb-copied');
                    setTimeout(() => card.classList.remove('bqb-copied'), 800);
                } catch (fetchErr) {
                    console.error('操作失败:', fetchErr);
                    showToast('操作失败，请检查网络', 'fa-exclamation-circle');
                } finally {
                    card.dataset.processing = 'false';
                }
            });

            card.appendChild(img);
            card.appendChild(fallback);
            card.appendChild(nameEl);
            grid.appendChild(card);
        });

        if (stats) stats.style.display = 'flex';
        if (countEl) countEl.textContent = items.length;

        // 滚动到网格区域
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ==================== 加载逻辑 ====================
    async function doFetch(params) {
        if (isFetching) return;
        isFetching = true;

        if (btnRandom) btnRandom.disabled = true;
        if (btnSearch) btnSearch.disabled = true;
        if (loading) loading.style.display = 'flex';
        if (stats) stats.style.display = 'none';
        grid.innerHTML = '';
        if (loadingText) loadingText.textContent = '正在获取表情包...';

        try {
            const items = await fetchBqb(params);
            renderGrid(items);
        } catch (e) {
            grid.innerHTML = '<div class="bqb-empty"><i class="fas fa-exclamation-triangle"></i><p>加载失败，请检查网络后重试</p></div>';
            if (e.name === 'AbortError') {
                showToast('请求超时，请检查网络后重试', 'fa-exclamation-circle');
            } else {
                showToast('加载失败，请稍后重试', 'fa-exclamation-circle');
            }
            console.error('[BQB] 获取失败:', e);
        } finally {
            if (loading) loading.style.display = 'none';
            if (btnRandom) btnRandom.disabled = false;
            if (btnSearch) btnSearch.disabled = false;
            isFetching = false;
        }
    }

    function handleRandom(e) {
        e.preventDefault();
        doFetch({ type: 1, limit: DEFAULT_LIMIT });
    }

    function handleSearch(e) {
        e.preventDefault();
        const words = searchInput ? searchInput.value.trim() : '';
        if (!words) {
            showToast('请输入搜索关键词', 'fa-exclamation-circle');
            return;
        }
        doFetch({ type: 2, limit: DEFAULT_LIMIT, extra: { words } });
    }

    // ══════════════════════════════════════════════ 
    //  🔥 暴露给外部调用的自动加载函数
    // ══════════════════════════════════════════════ 
    function autoFetchRandom() {
        // 如果正在加载中，或 grid 已有内容，则跳过（避免重复请求）
        if (isFetching) return;
        if (grid && grid.children.length > 0 && !grid.querySelector('.bqb-empty')) return;
        handleRandom(new Event('click'));
    }

    // ══════════════════════════════════════════════ 
    //  注入样式（美化版）
    // ══════════════════════════════════════════════ 
    function injectStyles() {
        const css = `
        /* ========== 容器 ========== */
        .bqb-container {
            padding: 0;
            max-width: 100%;
        }
 
        /* ========== Hero 头部 ========== */
        .bqb-hero {
            text-align: center;
            padding: 28px 20px 18px;
            position: relative;
            overflow: hidden;
            border-radius: 20px;
            margin-bottom: 16px;
            background: transparent;
            border: none;
        }
        .bqb-hero-emoji {
            font-size: 4rem;
            margin-bottom: 6px;
            animation: bqbBounce 2.5s ease-in-out infinite;
            position: relative;
            z-index: 1;
        }
        @keyframes bqbBounce {
            0%, 100% { transform: translateY(0) scale(1); }
            15% { transform: translateY(-14px) scale(1.08); }
            30% { transform: translateY(0) scale(1); }
            45% { transform: translateY(-7px) scale(1.04); }
            60% { transform: translateY(0) scale(1); }
        }
        .bqb-hero-title {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text-primary, #e0e0e0);
            margin: 0 0 6px;
            position: relative;
            z-index: 1;
            letter-spacing: -0.02em;
        }
        .bqb-hero-desc {
            font-size: 0.9rem;
            color: var(--text-primary, #c0c0c0);
            margin: 0 0 16px;
            line-height: 1.6;
            position: relative;
            z-index: 1;
        }
 
        /* ========== 搜索栏 ========== */
        .bqb-search-row {
            display: flex;
            gap: 8px;
            justify-content: center;
            margin-bottom: 14px;
            flex-wrap: wrap;
            position: relative;
            z-index: 1;
        }
        .bqb-search-input {
            flex: 1;
            min-width: 180px;
            max-width: 280px;
            padding: 11px 18px;
            background: rgba(30, 30, 46, 0.8);
            border: 1.5px solid rgba(255, 255, 255, 0.15);
            border-radius: 50px;
            color: var(--text-primary, #e0e0e0);
            outline: none;
            font-size: 0.9rem;
            transition: all 0.3s ease;
        }
        .bqb-search-input:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.12);
            background: rgba(30, 30, 46, 0.95);
        }
        .bqb-search-input::placeholder {
            color: rgba(255, 255, 255, 0.35);
        }
 
        /* ========== 搜索按钮 ========== */
        .bqb-search-btn {
            padding: 11px 22px;
            border: none;
            border-radius: 50px;
            background: linear-gradient(135deg, #667eea, #5a6fd6);
            color: #fff;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.25);
            white-space: nowrap;
        }
        .bqb-search-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 22px rgba(102, 126, 234, 0.4);
        }
        .bqb-search-btn:active {
            transform: scale(0.95);
        }
 
        /* ========== 随机按钮 ========== */
        .bqb-fetch-btn {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 15px 40px;
            font-size: 1.05rem;
            font-weight: 600;
            border: none;
            border-radius: 50px;
            cursor: pointer;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: #fff;
            box-shadow: 0 6px 25px rgba(102, 126, 234, 0.3);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            z-index: 1;
            letter-spacing: 0.02em;
        }
        .bqb-fetch-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 35px rgba(102, 126, 234, 0.45);
        }
        .bqb-fetch-btn:active {
            transform: scale(0.95);
        }
        .bqb-fetch-btn:disabled,
        .bqb-search-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
            box-shadow: none !important;
        }
 
        /* ========== 加载状态 ========== */
        .bqb-loading {
            display: none;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 30px;
            color: var(--text-primary, #c0c0c0);
            font-size: 0.95rem;
        }
        .bqb-loading .spinner {
            width: 24px;
            height: 24px;
            border: 3px solid rgba(102, 126, 234, 0.2);
            border-top-color: #667eea;
            border-radius: 50%;
            animation: bqbSpin 0.7s linear infinite;
        }
        @keyframes bqbSpin {
            to { transform: rotate(360deg); }
        }
 
        /* ========== 统计条 ========== */
        .bqb-stats {
            display: none;
            align-items: center;
            gap: 8px;
            padding: 6px 0 16px;
            font-size: 0.9rem;
            color: var(--text-primary, #c0c0c0);
        }
        .bqb-stats strong {
            color: #667eea;
            font-weight: 700;
            font-size: 1rem;
        }
 
        /* ========== 网格 ========== */
        .bqb-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 16px;
            padding: 0 0 24px;
        }
 
        /* ========== 卡片 ========== */
        .bqb-card {
            position: relative;
            border-radius: 16px;
            overflow: hidden;
            background: var(--card-bg, #1e1e2e);
            cursor: pointer;
            border: 2px solid transparent;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            animation: bqbFadeIn 0.5s ease both;
            display: flex;
            flex-direction: column;
            align-items: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            
            transition: border-color 0.3s, transform 0.3s, box-shadow 0.3s;
        }
        @keyframes bqbFadeIn {
            from {
                opacity: 0;
                transform: translateY(20px) scale(0.95);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
        .bqb-card:hover {
            border-color: #667eea;
            transform: translateY(-6px);
            box-shadow: 0 12px 32px rgba(102, 126, 234, 0.25);
        }
        .bqb-card:active {
            transform: scale(0.96);
        }
        .bqb-card.bqb-copied {
    border-color: #667eea !important;
    transform: scale(0.96);
    transition: all 0.15s ease;
}
 
/* 新增：点击瞬间的脉冲效果（点下即触发） */
.bqb-card.bqb-pressing {
    transform: scale(0.92);
    box-shadow: 0 0 0 8px rgba(102, 126, 234, 0.25);
    transition: all 0.1s ease;
}
 
/* 若有需要，还可以添加一个中心涟漪（可选） */
.bqb-card::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    border-radius: 50%;
    background: rgba(102, 126, 234, 0.3);
    transform: translate(-50%, -50%);
    opacity: 0;
    pointer-events: none;
    transition: width 0.4s ease-out, height 0.4s ease-out, opacity 0.4s ease-out;
}
.bqb-card.bqb-ripple::after {
    width: 200%;
    height: 200%;
    opacity: 0;
}
        @keyframes bqbCopiedPulse {
            0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5); }
            100% { box-shadow: 0 0 0 12px rgba(74, 222, 128, 0); }
        }
 
        /* ========== 图片 ========== */
        .bqb-img {
            width: 100%;
            aspect-ratio: 1 / 1;
            object-fit: contain;
            background: #fff;
            display: block;
            transition: transform 0.3s ease;
        }
        .bqb-card:hover .bqb-img {
            transform: scale(1.04);
        }
 
        /* ========== 图片加载失败占位 ========== */
        .bqb-fallback {
            width: 100%;
            aspect-ratio: 1 / 1;
            display: none;
            align-items: center;
            justify-content: center;
            background: #2a2a3a;
            color: #666;
            font-size: 2.2rem;
        }
 
        /* ========== 名称标签 ========== */
        .bqb-name {
            display: block;
            padding: 10px 12px;
            font-size: 0.75rem;
            color: var(--text-primary, #c0c0c0);
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
            font-weight: 500;
            letter-spacing: 0.01em;
            transition: color 0.2s;
        }
        .bqb-card:hover .bqb-name {
            color: #667eea;
        }
 
        /* ========== 空状态 ========== */
        .bqb-empty {
            grid-column: 1 / -1;
            text-align: center;
            padding: 48px 20px;
            color: var(--text-primary, #c0c0c0);
        }
        .bqb-empty i {
            font-size: 3rem;
            margin-bottom: 12px;
            display: block;
            opacity: 0.7;
        }
        .bqb-empty p {
            margin: 0;
            font-size: 0.95rem;
        }
 
        /* ========== 响应式 ========== */
        @media (max-width: 768px) {
            .bqb-hero {
                padding: 20px 14px 14px;
                border-radius: 16px;
            }
            .bqb-hero-emoji {
                font-size: 3rem;
            }
            .bqb-hero-title {
                font-size: 1.25rem;
            }
            .bqb-hero-desc {
                font-size: 0.85rem;
            }
            .bqb-grid {
                grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
                gap: 10px;
            }
            .bqb-fetch-btn {
                padding: 13px 30px;
                font-size: 0.95rem;
            }
            .bqb-search-input {
                min-width: 140px;
                max-width: 200px;
            }
            .bqb-card {
                border-radius: 12px;
            }
        }
        @media (max-width: 480px) {
            .bqb-grid {
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
            }
            .bqb-card {
                border-radius: 10px;
            }
            .bqb-hero {
                border-radius: 12px;
                padding: 16px 10px 10px;
            }
            .bqb-hero-emoji {
                font-size: 2.5rem;
            }
            .bqb-hero-title {
                font-size: 1.1rem;
            }
            .bqb-search-row {
                flex-direction: column;
                align-items: center;
            }
            .bqb-search-input {
                max-width: 100%;
                width: 100%;
            }
            .bqb-search-btn {
                width: 100%;
                justify-content: center;
            }
        }
    `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ==================== 初始化 ====================
    function init() {
        btnRandom = $('bqbFetchBtn');
        btnSearch = $('bqbSearchBtn');
        searchInput = $('bqbSearchInput');
        grid = $('bqbGrid');
        loading = $('bqbLoading');
        loadingText = $('bqbLoadingText');
        stats = $('bqbStats');
        countEl = $('bqbCount');

        injectStyles();

        if (btnRandom) btnRandom.addEventListener('click', handleRandom);
        if (btnSearch) btnSearch.addEventListener('click', handleSearch);
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleSearch();
            });
        }
    }

    // ══════════════════════════════════════════════ 
    //  暴露到全局，供 app.js 调用 
    // ══════════════════════════════════════════════ 
    window.bqbAutoFetch = autoFetchRandom;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();