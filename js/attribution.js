/**
 * 链接原创/二创归属标记模块 (attribution.js)
 * 支持在 YouTube 链接后保留自定义备注，并自动覆盖旧标记
 */
(function () {
    // 默认设计师列表
    const DEFAULT_DESIGNERS = [
        { name: '邹丰俊', id: 'D33A' },
        { name: '王译雪', id: 'D339' },
        { name: '李梦玲', id: 'D338' }
    ];
    const STORAGE_KEY = 'wow_tools_designers';
    let selectedDesignerId = '';
    let selectedType = 'recreate';

    // 正则：匹配 YouTube 链接（支持 watch?v= / shorts/ / youtu.be）
    // 匹配到第一个空格或行尾，但不包括链接后的备注
    const youtubeUrlReg = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[^\s]+/i;
    // 正则：匹配我们追加的旧标记（包括 `?_Dxxx` 和 `?_Dxxx_#` / `?_Dxxx_$`）
    const markTailReg = /\?_D[0-9A-Z]+(_[#$])?$/;

    document.addEventListener('DOMContentLoaded', () => {
        const processBtn = document.getElementById('attr-process-btn') || document.getElementById('attr-mark-btn');
        const linksInput = document.getElementById('attr-input-links') || document.getElementById('attr-mark-input');
        const designerGroup = document.getElementById('attr-designer-group');
        const typeGroup = document.getElementById('attr-type-group');
        const resultContainer = document.getElementById('attr-result-container');
        const resultTbody = document.getElementById('attr-result-tbody');
        const copyAllBtn = document.getElementById('attr-copy-all-btn');

        const modalOverlay = document.getElementById('designerModalOverlay');
        const openModalBtn = document.getElementById('open-designer-modal-btn');
        const closeModalBtn = document.getElementById('closeDesignerModal');
        const addBtn = document.getElementById('attr-add-designer-btn');
        const newNameInput = document.getElementById('attr-new-name');
        const newIdInput = document.getElementById('attr-new-id');
        const modalDesignerList = document.getElementById('attr-designer-modal-list');

        // ---- 设计师管理 ----
        function getDesigners() {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                try {
                    return JSON.parse(stored);
                } catch (e) {
                    console.error('解析本地设计师缓存失败', e);
                }
            }
            return DEFAULT_DESIGNERS;
        }

        function saveDesigners(designers) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(designers));
            renderDesigners();
        }

        function renderDesigners() {
            const designers = getDesigners();
            if (!designers.some(d => d.id === selectedDesignerId)) {
                selectedDesignerId = designers[0] ? designers[0].id : '';
            }
            if (designerGroup) {
                designerGroup.innerHTML = designers.map(d => `
                    <div class="attr-chip-card ${d.id === selectedDesignerId ? 'active' : ''}" data-value="${d.id}">
                        <div class="attr-chip-avatar">${d.name.charAt(0)}</div>
                        <div class="attr-chip-info">
                            <span class="attr-chip-name">${d.name}</span>
                            <span class="attr-chip-id">${d.id}</span>
                        </div>
                        <i class="fas fa-check attr-chip-check"></i>
                    </div>
                `).join('');
                designerGroup.querySelectorAll('.attr-chip-card').forEach(card => {
                    card.addEventListener('click', (e) => {
                        designerGroup.querySelectorAll('.attr-chip-card').forEach(c => c.classList.remove('active'));
                        const target = e.currentTarget;
                        target.classList.add('active');
                        selectedDesignerId = target.getAttribute('data-value');
                    });
                });
            }
            if (modalDesignerList) {
                modalDesignerList.innerHTML = designers.map((d, index) => `
                    <div class="attr-modal-chip">
                        <span>${d.name} <strong>(${d.id})</strong></span>
                        <i class="fas fa-xmark attr-modal-del" onclick="window.deleteDesigner(${index})"></i>
                    </div>
                `).join('');
            }
        }

        window.deleteDesigner = function (index) {
            const designers = getDesigners();
            if (designers.length <= 1) {
                alert('请至少保留一名设计师！');
                return;
            }
            designers.splice(index, 1);
            saveDesigners(designers);
        };

        // ---- 类型切换 ----
        if (typeGroup) {
            const typeCards = typeGroup.querySelectorAll('.attr-option-card, .attr-type-card');
            typeCards.forEach(card => {
                card.addEventListener('click', (e) => {
                    typeCards.forEach(c => c.classList.remove('active'));
                    const target = e.currentTarget;
                    target.classList.add('active');
                    selectedType = target.getAttribute('data-value') || target.getAttribute('data-type') || 'recreate';
                });
            });
        }

        // ---- 弹窗 ----
        if (openModalBtn && modalOverlay) openModalBtn.addEventListener('click', () => modalOverlay.style.display = 'flex');
        if (closeModalBtn && modalOverlay) closeModalBtn.addEventListener('click', () => modalOverlay.style.display = 'none');

        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const name = newNameInput ? newNameInput.value.trim() : '';
                const id = newIdInput ? newIdInput.value.trim().toUpperCase() : '';
                if (!name || !id) {
                    alert('请填写完整的设计师姓名和ID！');
                    return;
                }
                const designers = getDesigners();
                if (designers.some(d => d.id === id)) {
                    alert('该设计师 ID 已存在！');
                    return;
                }
                designers.push({ name, id });
                saveDesigners(designers);
                if (newNameInput) newNameInput.value = '';
                if (newIdInput) newIdInput.value = '';
            });
        }

        // ---- 复制工具 ----
        function copyToClipboardText(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            if (typeof showToast === 'function') {
                showToast('已生成标记并自动复制到剪贴板！');
            } else {
                const toast = document.getElementById('toast');
                const toastMsg = document.getElementById('toastMessage');
                if (toast) {
                    if (toastMsg) toastMsg.innerText = '已生成标记并自动复制到剪贴板！';
                    toast.classList.add('show');
                    setTimeout(() => toast.classList.remove('show'), 2000);
                } else {
                    alert('已生成标记并自动复制到剪贴板！');
                }
            }
        }

        // ---- 核心处理逻辑（修正版） ----
        if (processBtn) {
            processBtn.addEventListener('click', () => {
                if (!linksInput) {
                    alert('未找到输入框节点，请检查 HTML ID 配置');
                    return;
                }
                const rawText = linksInput.value.trim();
                if (!rawText) {
                    alert('请输入链接文本！');
                    return;
                }

                let suffixSymbol = '';
                if (selectedType === 'recreate') {
                    suffixSymbol = '_#';
                } else if (selectedType === 'original') {
                    suffixSymbol = '_$';
                } else if (selectedType === 'mark') {
                    suffixSymbol = ''; // 仅追加ID，不加后缀符号
                }

                const lines = rawText.split('\n').map(l => l.trim());
                const results = [];
                let tbodyHtml = '';

                lines.forEach(originLine => {
                    if (originLine === '') {
                        results.push('');
                        tbodyHtml += `
                        <tr>
                            <td class="attr-table-link-cell" style="word-break: break-all;">&nbsp;</td>
                            <td class="attr-table-res-cell" style="word-break: break-all;">&nbsp;</td>
                        </tr>
                        `;
                        return;
                    }

                    // 提取行中的 YouTube 链接（匹配到第一个空格或行尾）
                    const match = originLine.match(youtubeUrlReg);
                    if (match) {
                        const fullLink = match[0]; // 完整链接（可能包含旧标记）
                        // 获取链接后面的备注（去除链接后剩余的文本）
                        let remark = originLine.replace(fullLink, '').trim();

                        // 清理旧标记（如果有）
                        let cleanLink = fullLink.replace(markTailReg, '');

                        // 构建新标记
                        let markSuffix = `?_${selectedDesignerId}`;
                        if (suffixSymbol) {
                            markSuffix += suffixSymbol;
                        }

                        // 最终链接 = 清理后的链接 + 新标记
                        let markedLink = cleanLink + markSuffix;
                        // 如果有备注，加在链接后面（空格分隔）
                        if (remark) {
                            markedLink += ' ' + remark;
                        }

                        results.push(markedLink);
                        tbodyHtml += `
                        <tr>
                            <td class="attr-table-link-cell" style="word-break: break-all;">${originLine}</td>
                            <td class="attr-table-res-cell" style="word-break: break-all;"><code>${markedLink}</code></td>
                        </tr>
                        `;
                    } else {
                        // 非链接行，原样保留
                        results.push(originLine);
                        tbodyHtml += `
                        <tr>
                            <td class="attr-table-link-cell" style="word-break: break-all;">${originLine}</td>
                            <td class="attr-table-res-cell" style="word-break: break-all;">${originLine}</td>
                        </tr>
                        `;
                    }
                });

                if (resultTbody) resultTbody.innerHTML = tbodyHtml;
                if (resultContainer) resultContainer.style.display = 'block';

                const allCopyText = results.join('\n');
                copyToClipboardText(allCopyText);

                if (copyAllBtn) {
                    copyAllBtn.onclick = () => copyToClipboardText(allCopyText);
                }
            });
        }

        renderDesigners();
    });
})();