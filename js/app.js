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
                        model: "deepseek-v4-1-flash-260910",
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
        this.initBonusModule();
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

        const metaProgressEl = document.getElementById('cipher-meta-progress');
        const metaIconEl = document.getElementById('cipher-meta-icon');
        const metaStepEl = document.getElementById('cipher-meta-step');
        const metaLabelEl = document.getElementById('cipher-meta-label');

        // ====================== 步骤定义 ======================
        const CHIP_STEPS = [
            { key: 'request', label: '请求' },
            { key: 'negotiate', label: '协商' },
            { key: 'verify', label: '签名' },
            { key: 'session', label: '会话' },
            { key: 'generate', label: '生成' },
            { key: 'copy', label: '复制' }
        ];

        const chipStates = { encrypt: {}, decrypt: {} };
        const seenNegotiate = { encrypt: false, decrypt: false };
        let activeCipherOperation = null;
        let currentTab = 'encrypt';

        // ====================== meta 栏渲染：图标 + 序号/总数 + 步骤名 ======================
        function renderMeta(type) {
            if (!metaProgressEl || !metaIconEl || !metaStepEl || !metaLabelEl) return;
            const state = chipStates[type] || {};
            const total = CHIP_STEPS.length;

            const anyFail = CHIP_STEPS.some(s => state[s.key] === 'fail');
            const anyWarn = CHIP_STEPS.some(s => state[s.key] === 'warn');
            const activeStep = CHIP_STEPS.find(s => state[s.key] === 'active');
            const failIdx = CHIP_STEPS.findIndex(s => state[s.key] === 'fail');
            const doneCount = CHIP_STEPS.filter(s => state[s.key] === 'done' || state[s.key] === 'warn').length;
            const allDone = doneCount === total && !anyFail;

            let iconHtml, stepText, labelText, progressClass;

            if (anyFail) {
                iconHtml = '<i class="fas fa-times-circle"></i>';
                stepText = `${failIdx + 1}/${total}`;
                labelText = CHIP_STEPS[failIdx] ? CHIP_STEPS[failIdx].label : '失败';
                progressClass = 'is-fail';
            } else if (allDone) {
                if (anyWarn) {
                    iconHtml = '<i class="fas fa-exclamation-circle"></i>';
                    stepText = `${total}/${total}`;
                    labelText = '完成';
                    progressClass = 'is-warn';
                } else {
                    iconHtml = '<i class="fas fa-check-circle"></i>';
                    stepText = `${total}/${total}`;
                    labelText = '完成';
                    progressClass = 'is-success';
                }
            } else if (activeStep) {
                iconHtml = '<i class="fas fa-circle-notch fa-spin"></i>';
                const idx = CHIP_STEPS.findIndex(s => s.key === activeStep.key) + 1;
                stepText = `${idx}/${total}`;
                labelText = activeStep.label;
                progressClass = 'is-active';
            } else {
                iconHtml = '<i class="far fa-circle"></i>';
                stepText = `0/${total}`;
                labelText = '未开始';
                progressClass = '';
            }

            metaIconEl.innerHTML = iconHtml;
            metaStepEl.textContent = stepText;
            metaLabelEl.textContent = labelText;
            metaProgressEl.classList.remove('is-active', 'is-success', 'is-fail', 'is-warn');
            if (progressClass) metaProgressEl.classList.add(progressClass);
        }

        function setChipState(type, key, status) {
            chipStates[type][key] = status;
            if (currentTab === type) renderMeta(type);
        }

        function markStepsDoneBefore(type, stepKey) {
            const idx = CHIP_STEPS.findIndex(s => s.key === stepKey);
            if (idx < 0) return;
            const state = chipStates[type];
            for (let i = 0; i < idx; i++) {
                const k = CHIP_STEPS[i].key;
                if (state[k] !== 'fail' && state[k] !== 'warn') state[k] = 'done';
            }
        }

        function resetChips(type) {
            chipStates[type] = {};
            seenNegotiate[type] = false;
            if (currentTab === type) renderMeta(type);
        }

        function handleStatus(type, payload) {
            const msg = payload.message || '';
            const state = chipStates[type];

            if (msg.indexOf('🔄') === 0) {
                seenNegotiate[type] = true;
                markStepsDoneBefore(type, 'negotiate');
                setChipState(type, 'negotiate', 'active');
                return;
            }
            if (msg.indexOf('⚠️ 会话过期') === 0) {
                seenNegotiate[type] = true;
                markStepsDoneBefore(type, 'negotiate');
                setChipState(type, 'negotiate', 'active');
                return;
            }
            if (msg.indexOf('✅ Ed25519') === 0) {
                markStepsDoneBefore(type, 'verify');
                setChipState(type, 'verify', 'done');
                setChipState(type, 'session', 'active');
                return;
            }
            if (msg.indexOf('✅ ECDH') === 0) {
                markStepsDoneBefore(type, 'session');
                setChipState(type, 'session', 'done');
                setChipState(type, 'generate', 'active');
                return;
            }
            if (msg.indexOf('✅ 密文已生成') === 0 || msg.indexOf('✅ 解密成功') === 0) {
                markStepsDoneBefore(type, 'generate');
                if (!seenNegotiate[type]) {
                    setChipState(type, 'negotiate', 'done');
                    setChipState(type, 'verify', 'done');
                    setChipState(type, 'session', 'done');
                }
                setChipState(type, 'generate', 'done');
                setChipState(type, 'copy', 'active');
                return;
            }
            if (msg.indexOf('📋') === 0) {
                setChipState(type, 'copy', 'done');
                return;
            }
            if (msg.indexOf('⚠️ 自动复制') === 0) {
                setChipState(type, 'copy', 'warn');
                return;
            }
            if (msg.indexOf('❌') === 0) {
                const activeKey = CHIP_STEPS.map(s => s.key).find(k => state[k] === 'active');
                if (activeKey) setChipState(type, activeKey, 'fail');
                return;
            }
        }

        // 注册 CloudCipher 状态监听
        if (typeof CloudCipher !== 'undefined' && typeof CloudCipher.onStatus === 'function') {
            CloudCipher.onStatus(function (payload) {
                if (activeCipherOperation) {
                    handleStatus(activeCipherOperation, payload);
                }
            });
        }

        // ====================== 自动销毁定时器 ======================
        const destroyTimers = {
            encrypt: { interval: null, timeout: null },
            decrypt: { interval: null, timeout: null }
        };

        function stopDestroyCountdown(type) {
            const t = destroyTimers[type];
            if (t.interval) { clearInterval(t.interval); t.interval = null; }
            if (t.timeout) { clearTimeout(t.timeout); t.timeout = null; }
            const bar = document.getElementById(`cipher-${type}-destroy-bar`);
            if (bar) bar.style.display = 'none';
        }

        function startDestroyCountdown(type, totalSeconds) {
            stopDestroyCountdown(type);
            const isEncrypt = type === 'encrypt';
            const inputEl = isEncrypt ? encryptInput : decryptInput;
            const countEl = document.getElementById(`cipher-${type}-destroy-count`);
            const fillEl = document.getElementById(`cipher-${type}-destroy-fill`);
            const bar = document.getElementById(`cipher-${type}-destroy-bar`);
            if (!countEl || !fillEl || !bar) return;

            let remain = totalSeconds;
            countEl.textContent = remain;
            fillEl.style.width = '100%';
            bar.style.display = 'flex';

            destroyTimers[type].interval = setInterval(() => {
                remain--;
                if (remain < 0) remain = 0;
                countEl.textContent = remain;
                fillEl.style.width = (remain / totalSeconds * 100) + '%';
                if (remain <= 0) {
                    clearInterval(destroyTimers[type].interval);
                    destroyTimers[type].interval = null;
                }
            }, 1000);

            destroyTimers[type].timeout = setTimeout(() => {
                if (inputEl) inputEl.value = '';
                if (type === 'decrypt') {
                    if (decryptOutput) decryptOutput.textContent = '';
                    if (decryptResultArea) decryptResultArea.style.display = 'none';
                }
                bar.style.display = 'none';
                if (isEncrypt) updateEncryptBtn();
                else updateDecryptBtn();
                stopDestroyCountdown(type);
                showToast(isEncrypt ? '🔒 明文已自动清除' : '🔒 密文与明文已自动清除');
            }, totalSeconds * 1000);
        }

        // ====================== Tab 切换 ======================
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.cipherTab;
                currentTab = tab;
                panels.encrypt.style.display = tab === 'encrypt' ? 'flex' : 'none';
                panels.decrypt.style.display = tab === 'decrypt' ? 'flex' : 'none';
                renderMeta(tab);
            });
        });

        function updateEncryptBtn() { encryptBtn.disabled = !encryptInput.value.trim(); }
        function updateDecryptBtn() { decryptBtn.disabled = !decryptInput.value.trim(); }

        // 密钥窗口显示
        function updateTimeWindow() {
            const d = new Date();
            const h = String(d.getHours()).padStart(2, '0');
            const block = Math.floor(d.getMinutes() / 10) * 10;
            const m = String(block).padStart(2, '0');
            const nextBlock = (block + 10) % 60;
            const nextH = block + 10 >= 60 ? String((d.getHours() + 1) % 24).padStart(2, '0') : h;
            const nextM = String(nextBlock).padStart(2, '0');
            const el = document.getElementById('cipher-key-window');
            if (el) el.textContent = `${h}:${m}→${nextH}:${nextM}`;
            const remaining = ((10 - (d.getMinutes() % 10)) * 60) - d.getSeconds();
            setTimeout(updateTimeWindow, (remaining + 1) * 1000);
        }
        updateTimeWindow();

        // 输入监听
        encryptInput.addEventListener('input', () => {
            updateEncryptBtn();
            if (destroyTimers.encrypt.timeout) stopDestroyCountdown('encrypt');
        });
        decryptInput.addEventListener('input', () => {
            updateDecryptBtn();
            if (destroyTimers.decrypt.timeout) stopDestroyCountdown('decrypt');
        });

        // ====================== 加密 ======================
        encryptBtn.addEventListener('click', async () => {
            if (encryptBtn.disabled) return;
            const plaintext = encryptInput.value.trim();
            if (!plaintext) return;

            encryptBtn.disabled = true;
            encryptBtn.innerHTML = '<span class="btn-content"><i class="fas fa-spinner fa-pulse"></i> 加密中…</span>';
            encryptResultArea.style.display = 'none';

            resetChips('encrypt');
            activeCipherOperation = 'encrypt';
            setChipState('encrypt', 'request', 'done');
            setChipState('encrypt', 'negotiate', 'active');

            let ciphertext = '';
            try {
                ciphertext = await CloudCipher.encrypt(plaintext);
                encryptOutput.textContent = ciphertext;
                encryptResultArea.style.display = 'block';
                startDestroyCountdown('encrypt', 10);

                // ★ 主动推进 meta 栏：会话复用场景下 cipher.js 不 emit，
                //   这里根据"是否发生过协商"补全中间步骤
                markStepsDoneBefore('encrypt', 'generate');
                if (!seenNegotiate['encrypt']) {
                    setChipState('encrypt', 'negotiate', 'done');
                    setChipState('encrypt', 'verify', 'done');
                    setChipState('encrypt', 'session', 'done');
                }
                setChipState('encrypt', 'generate', 'done');
                setChipState('encrypt', 'copy', 'active');
            } catch (e) {
                console.error('加密失败', e);
                // ★ 把当前 active 的步骤标红
                const st = chipStates['encrypt'];
                const activeKey = CHIP_STEPS.map(s => s.key).find(k => st[k] === 'active');
                if (activeKey) setChipState('encrypt', activeKey, 'fail');
                else setChipState('encrypt', 'request', 'fail');
                showToast('❌ 加密失败：' + e.message);
                return;
            } finally {
                activeCipherOperation = null;
                encryptBtn.disabled = false;
                encryptBtn.innerHTML = '<span class="btn-content"><i class="fas fa-lock"></i> 加密并复制</span>';
                updateEncryptBtn();
            }

            try {
                await navigator.clipboard.writeText(ciphertext);
                setChipState('encrypt', 'copy', 'done');   // ★
                showToast('✅ 密文已生成并复制到剪贴板');
            } catch (clipError) {
                console.warn('复制失败:', clipError);
                setChipState('encrypt', 'copy', 'warn');   // ★
                showToast('✅ 密文已生成，但自动复制失败，请手动复制');
            }
        });

        // ====================== 解密 ======================
        async function performDecrypt() {
            if (decryptBtn.disabled) return;
            const rawStr = decryptInput.value.trim();
            if (!rawStr) { showToast('请输入密文'); return; }

            decryptBtn.disabled = true;
            decryptBtn.innerHTML = '<span class="btn-content"><i class="fas fa-spinner fa-pulse"></i> 解密中…</span>';
            decryptResultArea.style.display = 'none';

            resetChips('decrypt');
            activeCipherOperation = 'decrypt';
            setChipState('decrypt', 'request', 'done');
            setChipState('decrypt', 'negotiate', 'active');

            try {
                const plaintext = await CloudCipher.decrypt(rawStr);
                decryptOutput.textContent = plaintext;
                decryptResultArea.style.display = 'block';
                showToast('✅ 解密成功（云解密）');

                // ★ 主动推进 meta 栏
                markStepsDoneBefore('decrypt', 'generate');
                if (!seenNegotiate['decrypt']) {
                    setChipState('decrypt', 'negotiate', 'done');
                    setChipState('decrypt', 'verify', 'done');
                    setChipState('decrypt', 'session', 'done');
                }
                setChipState('decrypt', 'generate', 'done');
                setChipState('decrypt', 'copy', 'done');  // 解密没有"复制"步骤，直接结束

                startDestroyCountdown('decrypt', 60);
            } catch (e) {
                console.error('解密失败', e);
                const st = chipStates['decrypt'];
                const activeKey = CHIP_STEPS.map(s => s.key).find(k => st[k] === 'active');
                if (activeKey) setChipState('decrypt', activeKey, 'fail');
                else setChipState('decrypt', 'request', 'fail');
                showToast('❌ 解密失败：' + e.message);
            } finally {
                activeCipherOperation = null;
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
        renderMeta('encrypt');
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
    },
    // ================== 业绩奖金测算器 ==================
    initBonusModule() {
        const LEVELS = [
            { dp: 2000, rate: 0.0065, name: "Level1" },
            { dp: 3000, rate: 0.0075, name: "Level2" },
            { dp: 4000, rate: 0.0085, name: "Level3" },
            { dp: 6000, rate: 0.0090, name: "Level4" },
            { dp: 7000, rate: 0.0095, name: "Level5" },
            { dp: 8000, rate: 0.0100, name: "Level6" },
            { dp: 9000, rate: 0.0110, name: "Level7" },
            { dp: 10000, rate: 0.0120, name: "Level8" },
            { dp: 15000, rate: 0.0130, name: "Level9" },
            { dp: 20000, rate: 0.0135, name: "Level10" },
            { dp: 25000, rate: 0.01375, name: "Level11" },
            { dp: 30000, rate: 0.0140, name: "Level12" },
        ];

        const COEFF_KEY = 'wow_bonus_coefficient';
        const DEFAULT_COEFF = 1.10;

        const dpInput = document.getElementById('bonus-dp');
        const monthDaysInput = document.getElementById('bonus-month-days');
        const rateInput = document.getElementById('bonus-rate');
        const coeffInput = document.getElementById('bonus-coefficient');
        const statusEl = document.getElementById('bonus-rate-status');
        const resultEl = document.getElementById('bonus-result');
        const placeholderEl = document.getElementById('bonus-result-placeholder');
        const tbody = document.getElementById('bonus-level-body');
        if (!dpInput || !tbody) return;

        // ---- 渲染档位表（全部行一次性渲染，靠 display 控制显隐）----
        tbody.innerHTML = '';
        LEVELS.forEach(l => {
            const tr = document.createElement('tr');
            const bonus = l.dp * l.rate * 30;
            tr.innerHTML = `<td>${l.name}</td>` +
                `<td>${l.dp.toLocaleString()}</td>` +
                `<td>${(l.rate * 1000).toFixed(2)}‰</td>` +
                `<td>${bonus.toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`;
            tr.dataset.dp = l.dp;
            tbody.appendChild(tr);
        });

        // 展开/收起状态
        let isExpanded = false;
        const expandBtn = document.getElementById('bonus-expand-btn');

        // 固定显示 5 行，以命中档位为中心，靠边时贴边
        function applyRowVisibility(target) {
            const rows = tbody.querySelectorAll('tr');

            // 展开态：全部显示
            if (isExpanded) {
                rows.forEach(tr => tr.style.display = '');
                return;
            }

            const total = LEVELS.length;
            const WINDOW = 5;

            // 总共不足 5 行就直接全显示
            if (total <= WINDOW) {
                rows.forEach(tr => tr.style.display = '');
                return;
            }

            const targetIdx = LEVELS.findIndex(l => l.dp === target.dp);
            const half = Math.floor(WINDOW / 2);   // 2

            let start = targetIdx - half;
            let end = targetIdx + half;

            // 上边界越界 → 往下贴
            if (start < 0) {
                start = 0;
                end = WINDOW - 1;
            }
            // 下边界越界 → 往上贴
            if (end > total - 1) {
                end = total - 1;
                start = total - WINDOW;
            }

            rows.forEach((tr, idx) => {
                tr.style.display = (idx >= start && idx <= end) ? '' : 'none';
            });
        }

        // 展开/收起
        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                isExpanded = !isExpanded;
                expandBtn.textContent = isExpanded ? '收起' : '展开全部';
                expandBtn.classList.toggle('is-expanded', isExpanded);
                // 用当前输入的 dp 重新套用可见性
                const dp = Number(dpInput.value);
                let target = LEVELS[0];
                if (dp > 0) {
                    for (let i = LEVELS.length - 1; i >= 0; i--) {
                        if (dp >= LEVELS[i].dp) { target = LEVELS[i]; break; }
                    }
                }
                applyRowVisibility(target);
            });
        }

        // ---- 当月天数 ----
        const now = new Date();
        monthDaysInput.value = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        // ---- 职级系数：读取 + 自动保存 ----
        function loadCoeff() {
            const raw = localStorage.getItem(COEFF_KEY);
            const v = parseFloat(raw);
            return (!isNaN(v) && v > 0) ? v : DEFAULT_COEFF;
        }
        function saveCoeff(v) {
            localStorage.setItem(COEFF_KEY, String(v));
        }
        coeffInput.value = loadCoeff().toFixed(2);

        // ---- 汇率 ----
        let exchangeRate = 0.87;
        let rateReady = false;

        const RATE_SOURCES = [
            {
                url: "https://api.frankfurter.dev/v1/latest?base=HKD&symbols=CNY",
                parse: d => d && d.rates && d.rates.CNY
            },
            {
                url: "https://open.er-api.com/v6/latest/HKD",
                parse: d => d && d.rates && d.rates.CNY
            },
        ];

        function setRateStatus(text, isFallback) {
            if (!statusEl) return;
            if (isFallback) {
                statusEl.className = 'bonus-rate-status fallback';
                statusEl.innerHTML = '<span class="bonus-pulse blink"></span><span>' + text + '</span>';
            } else {
                statusEl.className = 'bonus-rate-status';
                statusEl.innerHTML = '<span class="bonus-pulse"></span><span>' + text + '</span>';
            }
        }

        // ====================== 核心：实时计算 ======================
        function runCalc() {
            const dp = Number(dpInput.value);

            // 空输入 → 回到占位，档位表默认显示前 5 个
            if (!dp || dp <= 0) {
                resultEl.style.display = 'none';
                placeholderEl.style.display = 'block';
                applyRowVisibility(LEVELS[0]);
                return;
            }

            const days = Number(monthDaysInput.value);

            // 命中最高档
            let target = LEVELS[0];
            for (let i = LEVELS.length - 1; i >= 0; i--) {
                if (dp >= LEVELS[i].dp) { target = LEVELS[i]; break; }
            }

            // 系数
            let coeff = parseFloat(coeffInput.value);
            if (isNaN(coeff) || coeff <= 0) coeff = loadCoeff();

            const totalDP = dp * days;
            const baseHKD = totalDP * target.rate;
            const finalHKD = baseHKD * coeff;
            const finalCNY = finalHKD * exchangeRate;

            document.getElementById('bonus-level-info').textContent =
                `${target.name} · ${(target.rate * 1000).toFixed(2)}‰`;
            document.getElementById('bonus-total-dp').textContent =
                totalDP.toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('bonus-base-hkd').textContent =
                'HKD ' + baseHKD.toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('bonus-final-hkd').textContent =
                'HKD ' + finalHKD.toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('bonus-final-cny').textContent =
                '¥ ' + finalCNY.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            tbody.querySelectorAll('tr').forEach(tr =>
                tr.classList.toggle('current', Number(tr.dataset.dp) === target.dp)
            );
            applyRowVisibility(target);

            placeholderEl.style.display = 'none';
            resultEl.style.display = 'block';
        }

        // ====================== 汇率拉取 ======================
        async function fetchRate() {
            for (const src of RATE_SOURCES) {
                try {
                    const res = await fetch(src.url, {
                        signal: AbortSignal.timeout(6000),
                        cache: 'no-store'
                    });
                    if (!res.ok) continue;
                    const data = await res.json();
                    const v = src.parse(data);
                    if (v && typeof v === 'number' && v > 0) {
                        exchangeRate = v;
                        rateReady = true;
                        rateInput.value = exchangeRate.toFixed(4);
                        setRateStatus('实时汇率已更新', false);
                        runCalc();          // ★ 汇率到位后重算
                        return;
                    }
                } catch (e) { /* 下一个源 */ }
            }
            rateReady = false;
            rateInput.value = exchangeRate.toFixed(4);
            setRateStatus('获取失败，已使用备用值 0.87', true);
            runCalc();                      // ★ 兜底后也重算一次
        }

        // ====================== 事件绑定 ======================
        // 日均利润：输入即算
        dpInput.addEventListener('input', runCalc);

        // 系数：输入即算 + 自动保存
        coeffInput.addEventListener('input', () => {
            const v = parseFloat(coeffInput.value);
            if (!isNaN(v) && v > 0) saveCoeff(v);
            runCalc();
        });
        // 失焦格式化
        coeffInput.addEventListener('blur', () => {
            const v = parseFloat(coeffInput.value);
            if (!isNaN(v) && v > 0) {
                coeffInput.value = v.toFixed(2);
                saveCoeff(v);
            } else {
                coeffInput.value = loadCoeff().toFixed(2);
            }
            runCalc();
        });

        // 初始化
        fetchRate();
        runCalc();
    },
};

// ================== 设置模块：左侧模块显隐 ==================
const Settings = {
    STORAGE_KEY: 'wow_tools_hidden_modules',
    DEFAULT_HIDDEN: ['panel7'],

    init() {
        const btn = document.getElementById('settingsBtn');
        const overlay = document.getElementById('settingsOverlay');
        const closeBtn = document.getElementById('closeSettingsModal');
        const resetBtn = document.getElementById('settingsReset');
        const saveBtn = document.getElementById('settingsSave');

        if (!btn || !overlay) return;

        btn.addEventListener('click', () => this.open());
        closeBtn.addEventListener('click', () => this.close());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close();
        });

        resetBtn.addEventListener('click', () => {
            localStorage.removeItem(this.STORAGE_KEY);
            this.apply();
            this.close();
            if (typeof showToast === 'function') showToast('已恢复默认显示');
        });

        saveBtn.addEventListener('click', () => this.saveFromUI());

        // 首次应用
        this.apply();
    },

    /* 读取"被隐藏的模块 target 列表"。从未保存过设置时使用默认隐藏列表 */
    getHidden() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            // 用户从未保存过设置 → 使用默认隐藏列表
            if (raw === null) {
                return Settings.DEFAULT_HIDDEN.slice();
            }
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch { return Settings.DEFAULT_HIDDEN.slice(); }
    },

    /* 从 DOM 抓取所有左侧模块（含 mind-panel 等动态注入的） */
    getModules() {
        const cards = document.querySelectorAll('.tool-card');
        const list = [];
        const seen = new Set();
        cards.forEach(card => {
            const target = card.dataset.target;
            if (!target || seen.has(target)) return;
            seen.add(target);

            // 记录原始 display —— 只记录一次
            if (!card.dataset.origDisplay) {
                card.dataset.origDisplay = card.style.display === 'none' ? 'none' : 'visible';
            }
            // 硬编码 display:none 的卡片（比如 yunyin.html 里隐藏的 panel4）不入设置列表
            if (card.dataset.origDisplay === 'none') return;

            const titleEl = card.querySelector('.card-title');
            const descEl = card.querySelector('.card-desc');
            let title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : target;
            title = title.replace(/⚡极速版/g, '').trim();
            const desc = descEl ? descEl.textContent.trim() : '';
            list.push({ target, title, desc });
        });
        return list;
    },

    /* 应用设置：按 hidden 列表显示/隐藏卡片；如果当前面板被隐藏了就收起 */
    apply() {
        document.documentElement.classList.remove('hide-panel7-init');
        const hidden = this.getHidden();
        document.querySelectorAll('.tool-card').forEach(card => {
            const target = card.dataset.target;
            if (!target) return;

            if (!card.dataset.origDisplay) {
                card.dataset.origDisplay = card.style.display === 'none' ? 'none' : 'visible';
            }
            if (card.dataset.origDisplay === 'none') return;

            card.style.display = hidden.includes(target) ? 'none' : '';

            if (hidden.includes(target)) {
                const panel = document.getElementById(target);
                if (panel && panel.classList.contains('active')) {
                    card.classList.remove('active');
                    panel.classList.remove('active');
                    const anyActive = document.querySelector('.function-panel.active');
                    const emptyTip = document.getElementById('emptyTip');
                    const resultArea = document.getElementById('resultArea');
                    if (!anyActive) {
                        if (emptyTip) emptyTip.style.display = 'flex';
                        if (resultArea) resultArea.classList.remove('show');
                    }
                }
            }
        });
    },

    open() {
        this.renderList();
        document.getElementById('settingsOverlay').style.display = 'flex';
    },

    close() {
        document.getElementById('settingsOverlay').style.display = 'none';
    },

    /* 渲染列表：卡片式布局 + 右侧开关 */
    renderList() {
        const container = document.getElementById('settingsList');
        const modules = this.getModules();
        const hidden = this.getHidden();
        container.innerHTML = modules.map(m => `
            <label class="settings-item">
                <div class="settings-item-info">
                    <div class="settings-item-title">${this.escape(m.title)}</div>
                    <div class="settings-item-desc">${this.escape(m.desc)}</div>
                </div>
                <span class="settings-switch">
                    <input type="checkbox" data-target="${m.target}" ${hidden.includes(m.target) ? '' : 'checked'}>
                    <span class="settings-switch-track">
                        <span class="settings-switch-thumb"></span>
                    </span>
                </span>
            </label>
        `).join('');
    },

    escape(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    },

    saveFromUI() {
        const checkboxes = document.querySelectorAll('#settingsList input[type="checkbox"]');
        const hidden = [];
        let visibleCount = 0;
        checkboxes.forEach(cb => {
            if (cb.checked) visibleCount++;
            else hidden.push(cb.dataset.target);
        });

        if (visibleCount === 0) {
            if (typeof showToast === 'function') showToast('⚠️ 请至少保留一个模块');
            return;
        }
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(hidden));
        this.apply();
        this.close();
        if (typeof showToast === 'function') showToast('✅ 设置已保存');
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
    Settings.init();
});