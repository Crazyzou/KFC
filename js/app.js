// ================== AI 处理器类 ==================
class AITitleProcessor {
    constructor() {
        this.apiKey = "6869437c-0d6b-42ee-8c6d-4c865ca9b475";
        this.apiUrl = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
    }
    async getAIResponse(prompt, retries = 2) {
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await fetch(this.apiUrl, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "doubao-1-5-pro-32k-250115",
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.3
                    })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();
                const content = result.choices?.[0]?.message?.content?.trim();
                if (content) return content;
                throw new Error("Empty response");
            } catch (error) {
                console.error(`AI请求错误 (尝试 ${i + 1}/${retries + 1}):`, error);
                if (i === retries) throw error;
                await delay(500);
            }
        }
    }
}

// ================== 界面控制器 ==================
const UIController = {
    toolCards: null,
    functionPanels: null,
    resultArea: null,
    emptyTip: null,
    init() {
        this.toolCards = document.querySelectorAll('.tool-card');
        this.functionPanels = document.querySelectorAll('.function-panel');
        this.resultArea = document.getElementById('resultArea');
        this.emptyTip = document.getElementById('emptyTip');
        this.bindToolSelection();
    },
    bindToolSelection() {
        this.toolCards.forEach(card => {
            card.addEventListener('click', () => {
                this.toolCards.forEach(c => c.classList.remove('active'));
                this.functionPanels.forEach(p => p.classList.remove('active'));
                card.classList.add('active');
                const targetPanel = document.getElementById(card.dataset.target);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                }
                this.resultArea.classList.add('show');
                this.emptyTip.style.display = 'none';

                // 🔥 切换到表情包面板时自动加载随机表情包
                if (card.dataset.target === 'panel3') {
                    setTimeout(() => {
                        if (window.bqbAutoFetch) {
                            window.bqbAutoFetch();
                        }
                    }, 150);
                }
            });
        });
    },
    setLoading(btnEl, loadingEl, isLoading, btnText = "处理中...") {
        if (btnEl) btnEl.disabled = isLoading;
        if (loadingEl) loadingEl.style.display = isLoading ? 'flex' : 'none';
    }
};

// ================== 模块主控 ==================
const Modules = {
    aiProcessor: null,
    init(aiProcessor) {
        this.aiProcessor = aiProcessor;
        this.initTextSeparator();
        this.initLinkLangExtractor();
        this.initCipherModule();
        this.initYoutubeModule();
    },
    initTextSeparator() {
        const input = document.getElementById('text-separator-input');
        const btn = document.getElementById('text-separator-btn');
        const loading = document.getElementById('separator-loading');
        const resContainer = document.getElementById('text-separator-result-container');
        const resContent = document.getElementById('text-separator-result');
        const langContainer = document.getElementById('lang-detection-result-container');
        const langContent = document.getElementById('lang-detection-result');
        btn.addEventListener('click', async () => {
            const text = input.value.trim();
            if (!text) return alert('请输入需要分隔的文本');
            UIController.setLoading(btn, loading, true);
            resContainer.style.display = 'none';
            langContainer.style.display = 'none';
            try {
                const langPrompt = `任务：识别语言。输入文本：${text}\n要求：只返回该语言的中文名称（如"英语"、"泰语"），不要其他任何内容。`;
                const sepPrompt = `任务：文本分句。\n输入文本：${text}\n要求：\n1. 识别所有标点（。！？、；：.?!;…—()[]{}"' 及泰语分隔符 ฯ ฯลฯ）进行分句。\n2. 不要按逗号分隔。\n3. 每句单独一行。\n4. 不要添加序号，不要解释。\n直接输出结果：`;
                const [langText, sepText] = await Promise.all([
                    this.aiProcessor.getAIResponse(langPrompt),
                    this.aiProcessor.getAIResponse(sepPrompt)
                ]);
                if (langText) {
                    langContent.textContent = langText;
                    langContainer.style.display = 'block';
                }
                const lines = sepText.split('\n').filter(l => l.trim());
                resContent.innerHTML = lines.map(line => `
                    <div class="result-line">${line}
                        <button class="line-copy-btn" onclick="copyLineText(this)" title="复制"><i class="far fa-copy"></i></button>
                    </div>`).join('');
                resContainer.style.display = 'block';
            } catch (err) {
                console.error(err);
                alert('处理出错，请重试');
            } finally { UIController.setLoading(btn, loading, false); }
        });
    },
    initLinkLangExtractor() {
        const input = document.getElementById('link-lang-input');
        const btn = document.getElementById('link-lang-btn');
        const sortBtn = document.getElementById('sort-link-lang-btn');
        const loading = document.getElementById('link-lang-loading');
        const tbody = document.getElementById('link-lang-tbody');
        const container = document.getElementById('link-lang-result-container');
        const copyLinksBtn = document.getElementById('copy-all-links');
        const copyLangsBtn = document.getElementById('copy-all-langs');
        const renderTable = (links, langs) => {
            STATE.extractedLinks = links;
            STATE.extractedLangs = langs;
            let html = '';
            const maxLen = Math.max(links.length, langs.length);
            for (let i = 0; i < maxLen; i++) html += `<tr><td>${links[i] || '-'}</td><td>${langs[i] || '-'}</td></tr>`;
            tbody.innerHTML = html;
            container.style.display = 'block';
        };
        btn.addEventListener('click', async () => {
            const text = input.value.trim();
            if (!text) return alert('请输入包含链接的文本');
            UIController.setLoading(btn, loading, true);
            container.style.display = 'none';
            try {
                const prompt = `任务：提取链接和语言。\n输入文本：\n${text}\n\n要求：\n1. 提取所有 http/https 链接。\n2. 识别每个链接对应的语言缩写（如en,es,ar,zh,ro,fr,de,ru,pt,ja,ko,it,hi,tr,pl,nl,sv,fi,da,el,id,ms,th,vi,hu,cs,sk,bg,uk,fa,ur,bn,sw等），如果是没有语言，us，en则填 "通用"，或无法识别则使用无法识别的缩写进行输出。\n3. 严格按以下 Markdown 表格格式输出，不要其他内容：\n\n| 链接 | 语言 |\n| --- | --- |\n| 链接1 | 语言缩写1 |\n| 链接2 | 语言缩写2 |`;
                const result = await this.aiProcessor.getAIResponse(prompt);
                const lines = result.split('\n').map(l => l.trim()).filter(l => l && !l.includes('|---') && !l.includes('链接'));
                const links = [];
                const langs = [];
                lines.forEach(line => {
                    const parts = line.split('|').map(p => p.trim()).filter(p => p);
                    if (parts.length >= 2) {
                        const linkMatch = parts.find(p => p.startsWith('http'));
                        if (linkMatch) {
                            links.push(linkMatch);
                            langs.push(parts.find(p => p !== linkMatch) || '通用');
                        }
                    }
                });
                if (links.length > 0) renderTable(links, langs);
                else throw new Error("Format parse failed");
            } catch (err) {
                console.error(err);
                alert('提取失败，请重试');
            } finally { UIController.setLoading(btn, loading, false); }
        });
        sortBtn.addEventListener('click', async () => {
            const text = input.value.trim();
            if (!text) return showToast('请先粘贴内容');
            const oldText = sortBtn.innerText;
            sortBtn.disabled = true;
            sortBtn.innerText = 'AI整理中...';
            try {
                const prompt = `任务：内容整理。\n请把以下文本整理成清晰的格式。\n规则：\n1. 保留所有主题块（如 "Depression 翻："、"改："、"阿兹海默" 等）。\n2. 每个主题块内，相同语言合并，链接列在下方。\n3. 不同语言、不同主题块之间空一行。\n4. 保留 @xxx 备注。\n5. 只输出纯文本，不要解释。\n\n待整理内容：\n${text}`;
                const result = await this.aiProcessor.getAIResponse(prompt);
                if (result) {
                    input.value = result.trim();
                    showToast('AI 整理完成！');
                }
            } catch (err) {
                console.error(err);
                showToast('AI整理失败');
            } finally {
                sortBtn.disabled = false;
                sortBtn.innerText = oldText;
            }
        });
        copyLinksBtn.addEventListener('click', () => {
            if (STATE.extractedLinks.length) copyToClipboard(STATE.extractedLinks.join('\n'));
        });
        copyLangsBtn.addEventListener('click', () => {
            if (STATE.extractedLangs.length) copyToClipboard(STATE.extractedLangs.join('\n'));
        });
    },
    initCipherModule() {
        const tabBtns = document.querySelectorAll('[data-cipher-tab]');
        const panels = {
            encrypt: document.getElementById('cipher-encrypt-panel'),
            decrypt: document.getElementById('cipher-decrypt-panel')
        };
        const encryptInput = document.getElementById('cipher-encrypt-input');
        const encryptBtn = document.getElementById('cipher-encrypt-btn');
        const encryptResultArea = document.getElementById('cipher-encrypt-result-area');
        const encryptOutput = document.getElementById('cipher-encrypt-output');
        const copyBtn = document.getElementById('cipher-copy-btn');
        const decryptInput = document.getElementById('cipher-decrypt-input');
        const decryptBtn = document.getElementById('cipher-decrypt-btn');
        const decryptResultArea = document.getElementById('cipher-decrypt-result-area');
        const decryptOutput = document.getElementById('cipher-decrypt-output');
        const pasteBtn = document.getElementById('cipher-paste-btn');

        // Tab 切换 
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.cipherTab;
                panels.encrypt.style.display = tab === 'encrypt' ? 'flex' : 'none';
                panels.decrypt.style.display = tab === 'decrypt' ? 'flex' : 'none';
            });
        });

        function updateEncryptBtn() { encryptBtn.disabled = !encryptInput.value.trim(); }
        function updateDecryptBtn() { decryptBtn.disabled = !decryptInput.value.trim(); }

        // 时间窗口显示 
        function updateTimeWindow() {
            const d = new Date();
            const h = String(d.getHours()).padStart(2, '0');
            const block = Math.floor(d.getMinutes() / 10) * 10;
            const m = String(block).padStart(2, '0');
            const nextBlock = (block + 10) % 60;
            const nextH = block + 10 >= 60 ? String((d.getHours() + 1) % 24).padStart(2, '0') : h;
            const nextM = String(nextBlock).padStart(2, '0');
            const text = `${h}:${m} → ${nextH}:${nextM}`;
            document.getElementById('cipher-key-window-encrypt').textContent = text;
            document.getElementById('cipher-key-window-decrypt').textContent = text;
            const remaining = ((10 - (d.getMinutes() % 10)) * 60) - d.getSeconds();
            setTimeout(updateTimeWindow, (remaining + 1) * 1000);
        }
        updateTimeWindow();

        encryptInput.addEventListener('input', updateEncryptBtn);
        decryptInput.addEventListener('input', updateDecryptBtn);

        // ====================== 加密 调用CloudCipher（自动ECDH协商） ======================
        encryptBtn.addEventListener('click', async () => {
            if (encryptBtn.disabled) return;
            const plaintext = encryptInput.value.trim();
            if (!plaintext) return;

            encryptBtn.disabled = true;
            encryptBtn.innerHTML = '<span class="btn-content"><i class="fas fa-spinner fa-pulse"></i> 加密中…</span>';
            encryptResultArea.style.display = 'none';

            try {
                // 统一使用封装好的ECDH加密工具，自动完成握手
                const ciphertext = await CloudCipher.encrypt(plaintext);

                encryptOutput.textContent = ciphertext;
                encryptResultArea.style.display = 'block';
                await navigator.clipboard.writeText(ciphertext);
                showToast('✅ 密文已生成并复制（云加密）');
            } catch (e) {
                console.error('加密失败', e);
                showToast('❌ 加密失败：' + e.message);
            } finally {
                encryptBtn.disabled = false;
                encryptBtn.innerHTML = '<span class="btn-content"><i class="fas fa-lock"></i> 加密并复制</span>';
                updateEncryptBtn();
            }
        });

        copyBtn.addEventListener('click', async () => {
            const text = encryptOutput.textContent.trim();
            if (!text) return;
            await navigator.clipboard.writeText(text);
            showToast('密文已复制');
        });

        // ====================== 解密 调用CloudCipher ======================
        async function performDecrypt() {
            if (decryptBtn.disabled) return;
            const rawStr = decryptInput.value.trim();
            if (!rawStr) {
                showToast('请输入密文');
                return;
            }

            decryptBtn.disabled = true;
            decryptBtn.innerHTML = '<span class="btn-content"><i class="fas fa-spinner fa-pulse"></i> 解密中…</span>';
            decryptResultArea.style.display = 'none';

            try {
                const plaintext = await CloudCipher.decrypt(rawStr);
                decryptOutput.textContent = plaintext;
                decryptResultArea.style.display = 'block';
                showToast('✅ 解密成功（云解密）');
            } catch (e) {
                console.error('解密失败', e);
                showToast('❌ 解密失败：' + e.message);
            } finally {
                decryptBtn.disabled = false;
                decryptBtn.innerHTML = '<span class="btn-content"><i class="fas fa-unlock"></i> 解密</span>';
                updateDecryptBtn();
            }
        }

        decryptBtn.addEventListener('click', performDecrypt);

        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text && text.trim()) {
                    decryptInput.value = text.trim();
                    updateDecryptBtn();
                    performDecrypt();
                } else {
                    showToast('剪贴板为空');
                }
            } catch {
                showToast('无法读取剪贴板，请手动粘贴后点击解密');
            }
        });

        encryptBtn.innerHTML = '<span class="btn-content"><i class="fas fa-lock"></i> 加密并复制</span>';
        updateEncryptBtn();
        updateDecryptBtn();
    },
    // ================== YouTube 模块初始化 ==================
    initYoutubeModule() {
        const fetchBtn = document.getElementById('youtubeFetchBtn');
        const urlInput = document.getElementById('youtubeUrls');
        const convertBtn = document.getElementById('convertToShortBtn');
        const closePlayerBtn = document.getElementById('closePlayer');
        const clearInputBtn = document.getElementById('clearYoutubeInputBtn');
        const ytResultsArea = document.getElementById('youtubeResultsArea');
        const backToTopBtn = document.getElementById('backToTopBtn');
        const historyBtn = document.getElementById('historyBtn');

        // 将需要全局调用的函数挂载到 window 
        window.showVideoPlayer = showVideoPlayer;
        window.hideVideoPlayer = hideVideoPlayer;
        window.copyYoutubeColumn = copyYoutubeColumn;
        window.toggleSortViews = toggleSortViews;
        window.processYoutubeUrls = processYoutubeUrls;
        window.copyImage = copyImage;
        window.downloadAllThumbnails = downloadAllThumbnails;
        window.getLosslessShortThumbnail = getLosslessShortThumbnail;
        window.loadImage = loadImage;

        window.toggleAllCheckboxes = function (selectAllCheckbox) {
            const checked = selectAllCheckbox.checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.checked = checked;
                const row = cb.closest('tr');
                if (row) {
                    checked ? row.classList.add('row-selected') : row.classList.remove('row-selected');
                }
            });
            updateSelectedCount();
        };

        window.copySelectedUrls = function () {
            const selected = [];
            document.querySelectorAll('.row-checkbox:checked').forEach(cb => {
                const url = cb.closest('tr').getAttribute('data-url');
                if (url) selected.push(url);
            });
            if (selected.length === 0) {
                showToast('⚠️ 请至少选择一个视频');
                return;
            }
            navigator.clipboard.writeText(selected.join('\n')).then(() => {
                showToast(`✅ 已复制 ${selected.length} 个链接到剪贴板`);
            });
        };

        function updateSelectedCount() {
            const count = document.querySelectorAll('.row-checkbox:checked').length;
            const span = document.querySelector('.btn-copy-selected span');
            if (span) span.textContent = count > 0 ? `复制选中 (${count})` : '复制选中';
        }

        // 滚动回到顶部按钮 
        ytResultsArea.addEventListener('scroll', () => {
            if (ytResultsArea.scrollTop > 300) backToTopBtn.classList.add('show');
            else backToTopBtn.classList.remove('show');
        });
        backToTopBtn.addEventListener('click', () => { ytResultsArea.scrollTo({ top: 0, behavior: 'smooth' }); });

        // 绑定按钮事件 
        fetchBtn.addEventListener('click', () => processYoutubeUrls());
        urlInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') processYoutubeUrls();
        });
        convertBtn.addEventListener('click', () => convertToShort());
        closePlayerBtn.addEventListener('click', () => hideVideoPlayer());
        clearInputBtn.addEventListener('click', () => {
            document.getElementById('youtubeUrls').value = '';
            showToast('输入框已清空');
        });
        historyBtn.addEventListener('click', openHistory);

        // 长按排序按钮保存偏好 
        let pressTimer = null;
        let isLongPress = false;
        ytResultsArea.addEventListener('pointerdown', (e) => {
            const btn = e.target.closest('#sortViewsBtn');
            if (!btn) return;
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                saveSortPreference(STATE.sortState);
                showToast(`已将“${STATE.sortState === 'desc' ? '降序' : STATE.sortState === 'asc' ? '升序' : '原始顺序'}”设为默认排序`);
            }, 800);
        });
        ytResultsArea.addEventListener('pointerup', () => clearTimeout(pressTimer));
        ytResultsArea.addEventListener('pointerleave', () => clearTimeout(pressTimer));
        ytResultsArea.addEventListener('click', (e) => {
            const btn = e.target.closest('#sortViewsBtn');
            if (!btn || isLongPress) return;
            e.stopPropagation();
            toggleSortViews();
        });
    }
};

// ================== YouTube API 就绪回调 ==================
window.onYouTubeIframeAPIReady = function () {
    STATE.youtubeApiReady = true;
    STATE.ytPlayer = new YT.Player('playerContainer', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1 },
        events: {
            onError: () => {
                showToast("视频无法播放，已为你打开新标签页");
                window.open(`https://youtu.be/${STATE.currentVideoId}`, "_blank");
                hideVideoPlayer();
            }
        }
    });
};

// ================== 页面启动 ==================
document.addEventListener('DOMContentLoaded', function () {
    const ai = new AITitleProcessor();
    UIController.init();
    Modules.init(ai);
    window.Modules = Modules;
});