/**
 * 链接原创/二创归属标记模块 (attribution.js)
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
    document.addEventListener('DOMContentLoaded', () => {
        // 兼容性 DOM 获取 (优先匹配当前ID，容错备选ID)
        const processBtn = document.getElementById('attr-process-btn') || document.getElementById('attr-mark-btn');
        const linksInput = document.getElementById('attr-input-links') || document.getElementById('attr-mark-input');
        const designerGroup = document.getElementById('attr-designer-group');
        const typeGroup = document.getElementById('attr-type-group');
        const resultContainer = document.getElementById('attr-result-container');
        const resultTbody = document.getElementById('attr-result-tbody');
        const copyAllBtn = document.getElementById('attr-copy-all-btn');
        // 弹窗相关 DOM
        const modalOverlay = document.getElementById('designerModalOverlay');
        const openModalBtn = document.getElementById('open-designer-modal-btn');
        const closeModalBtn = document.getElementById('closeDesignerModal');
        const addBtn = document.getElementById('attr-add-designer-btn');
        const newNameInput = document.getElementById('attr-new-name');
        const newIdInput = document.getElementById('attr-new-id');
        const modalDesignerList = document.getElementById('attr-designer-modal-list');
        // 1. 获取设计师列表
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
        // 2. 保存设计师
        function saveDesigners(designers) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(designers));
            renderDesigners();
        }
        // 3. 渲染设计师选项卡与弹窗列表
        function renderDesigners() {
            const designers = getDesigners();
            if (!designers.some(d => d.id === selectedDesignerId)) {
                selectedDesignerId = designers[0] ? designers[0].id : '';
            }
            // 渲染主面板上的选择卡
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
                // 绑定设计师选择卡点击事件
                designerGroup.querySelectorAll('.attr-chip-card').forEach(card => {
                    card.addEventListener('click', (e) => {
                        designerGroup.querySelectorAll('.attr-chip-card').forEach(c => c.classList.remove('active'));
                        const target = e.currentTarget;
                        target.classList.add('active');
                        selectedDesignerId = target.getAttribute('data-value');
                    });
                });
            }
            // 渲染弹窗内可删除的标签（增加 null 检查）
            if (modalDesignerList) {
                modalDesignerList.innerHTML = designers.map((d, index) => `
                    <div class="attr-modal-chip">
                        <span>${d.name} <strong>(${d.id})</strong></span>
                        <i class="fas fa-xmark attr-modal-del" onclick="window.deleteDesigner(${index})"></i>
                    </div>
                `).join('');
            }
        }
        // 4. 素材类型卡片切换绑定 (同时兼容 .attr-option-card 和 .attr-type-card)
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
        // 5. 弹窗打开/关闭
        if (openModalBtn && modalOverlay) openModalBtn.addEventListener('click', () => modalOverlay.style.display = 'flex');
        if (closeModalBtn && modalOverlay) closeModalBtn.addEventListener('click', () => modalOverlay.style.display = 'none');
        // 6. 添加设计师
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
        // 7. 删除设计师
        window.deleteDesigner = function (index) {
            const designers = getDesigners();
            if (designers.length <= 1) {
                alert('请至少保留一名设计师！');
                return;
            }
            designers.splice(index, 1);
            saveDesigners(designers);
        };
        // 8. 复制并弹提示
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
        // 9. 批量处理逻辑
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
                }
                const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
                const results = [];
                let tbodyHtml = '';

                // 正则：匹配本工具追加在链接末尾的标记后缀
                const markTailReg = /\?_D[0-9A-Z]+_[#$]$/;

                lines.forEach(originLink => {
                    let cleanLink = originLink;
                    // 如果存在旧标记后缀，则剥离旧后缀，还原基础链接
                    if (markTailReg.test(cleanLink)) {
                        cleanLink = cleanLink.replace(markTailReg, '');
                    }
                    // 使用当前选中设计师+类型生成全新标记链接
                    const markedLink = `${cleanLink}?_${selectedDesignerId}${suffixSymbol}`;

                    results.push(markedLink);
                    tbodyHtml += `
                        <tr>
                            <td class="attr-table-link-cell" style="word-break: break-all;">${originLink}</td>
                            <td class="attr-table-res-cell" style="word-break: break-all;"><code>${markedLink}</code></td>
                        </tr>
                    `;
                });

                // 渲染结果表格
                if (resultTbody) resultTbody.innerHTML = tbodyHtml;
                if (resultContainer) resultContainer.style.display = 'block';
                // 自动将结果复制进剪贴板
                const allCopyText = results.join('\n');
                copyToClipboardText(allCopyText);
                // 复制按钮点击事件
                if (copyAllBtn) {
                    copyAllBtn.onclick = () => copyToClipboardText(allCopyText);
                }
            });
        }
        // 初始化渲染
        renderDesigners();
    });
})();
