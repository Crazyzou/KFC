// ================== 密语编码器 - 本地加解密核心（完全离线可用） ==================
// 特点：
//   - 无需服务器即可派生本地密钥，保证离线可用 
//   - 本地加密使用 AES-CBC + 百家姓汉字 
//   - 时间前缀统一使用千字文编码（便于云端识别窗口）
//   - 前端**不包含**千字文加解密逻辑，确保无法解密云端密文 

// 千字文汉字集（仅用于时间前缀编码）
const CLOUD_HANZI = [
    '天', '地', '玄', '黄', '宇', '宙', '洪', '荒', '日', '月', '盈', '昃', '辰', '宿', '列', '张',
    '寒', '来', '暑', '往', '秋', '收', '冬', '藏', '闰', '余', '成', '岁', '律', '吕', '调', '阳',
    '云', '腾', '致', '雨', '露', '结', '为', '霜', '金', '生', '丽', '水', '玉', '出', '昆', '冈',
    '剑', '号', '巨', '阙', '珠', '称', '夜', '光', '果', '珍', '李', '柰', '菜', '重', '芥', '姜',
    '海', '咸', '河', '淡', '鳞', '潜', '羽', '翔', '龙', '师', '火', '帝', '鸟', '官', '人', '皇',
    '始', '制', '文', '字', '乃', '服', '衣', '裳', '推', '位', '让', '国', '有', '虞', '陶', '唐',
    '吊', '民', '伐', '罪', '周', '发', '殷', '汤', '坐', '朝', '问', '道', '垂', '拱', '平', '章',
    '爱', '育', '黎', '首', '臣', '伏', '戎', '羌', '遐', '迩', '一', '体', '率', '宾', '归', '王',
    '鸣', '凤', '在', '树', '白', '驹', '食', '场', '化', '被', '草', '木', '赖', '及', '万', '方',
    '盖', '此', '身', '髮', '四', '大', '五', '常', '恭', '惟', '鞠', '养', '岂', '敢', '毁', '伤',
    '女', '慕', '贞', '洁', '男', '效', '才', '良', '知', '过', '必', '改', '得', '能', '莫', '忘',
    '罔', '谈', '彼', '短', '靡', '恃', '己', '长', '信', '使', '可', '覆', '器', '欲', '难', '量',
    '墨', '悲', '丝', '染', '诗', '赞', '羔', '羊', '景', '行', '维', '贤', '克', '念', '作', '圣',
    '德', '建', '名', '立', '形', '端', '表', '正', '空', '谷', '传', '声', '虚', '堂', '习', '听',
    '祸', '因', '恶', '积', '福', '缘', '善', '庆', '尺', '璧', '非', '宝', '寸', '阴', '是', '竞',
    '资', '父', '事', '君', '曰', '严', '与', '敬', '孝', '当', '竭', '力', '忠', '则', '尽', '命'
];
const CLOUD_TO_BYTE = {};
CLOUD_HANZI.forEach((h, i) => { CLOUD_TO_BYTE[h] = i; });

// 本地汉字集（百家姓，与千字文完全不相交）
const LOCAL_HANZI = [
    '赵', '钱', '孙', '吴', '郑', '冯', '陈', '褚', '卫', '蒋',
    '沈', '韩', '杨', '朱', '秦', '尤', '许', '何', '施', '曹',
    '华', '魏', '戚', '谢', '邹', '喻', '柏', '窦', '苏', '潘',
    '葛', '奚', '范', '彭', '郎', '鲁', '韦', '昌', '苗', '花',
    '俞', '任', '袁', '柳', '鲍', '费', '廉', '岑', '薛', '雷',
    '贺', '滕', '罗', '毕', '郝', '邬', '安', '乐', '于', '傅',
    '皮', '卞', '齐', '康', '伍', '卜', '顾', '孟', '和', '穆',
    '萧', '尹', '姚', '邵', '湛', '汪', '祁', '狄', '米', '贝',
    '明', '臧', '计', '戴', '宋', '茅', '庞', '熊', '纪', '舒',
    '屈', '项', '祝', '董', '梁', '杜', '阮', '闵', '季', '麻',
    '强', '贾', '路', '危', '江', '童', '颜', '郭', '梅', '盛',
    '林', '刁', '钟', '徐', '邱', '骆', '高', '夏', '蔡', '田',
    '樊', '胡', '凌', '霍', '支', '柯', '管', '卢', '经', '房',
    '裘', '缪', '解', '应', '宗', '丁', '宣', '贲', '邓', '单',
    '杭', '包', '诸', '左', '石', '崔', '吉', '钮', '龚', '程',
    '邢', '滑', '裴', '陆', '荣', '翁', '荀', '惠', '甄', '家',
    '封', '芮', '羿', '储', '靳', '汲', '邴', '糜', '松', '井',
    '段', '富', '巫', '乌', '焦', '巴', '弓', '牧', '隗', '山',
    '车', '侯', '宓', '蓬', '全', '郗', '班', '仰', '仲', '伊',
    '宫', '宁', '仇', '栾', '暴', '甘', '钭', '祖', '武', '符',
    '刘', '詹', '束', '叶', '幸', '司', '韶', '郜', '薄', '印',
    '怀', '蒲', '台', '鄂', '索', '卓', '蔺', '屠', '蒙', '池',
    '乔', '胥', '苍', '双', '莘', '党', '翟', '谭', '贡', '劳',
    '逄', '姬', '申', '扶', '堵', '冉', '郦', '雍', '桑', '桂',
    '濮', '牛', '寿', '通', '边', '扈', '燕', '冀', '郏', '浦',
    '尚', '农', '温', '别', '庄', '晏', '柴', '瞿', '阎', '充'
];
const LOCAL_TO_BYTE = {};
LOCAL_HANZI.forEach((h, i) => { LOCAL_TO_BYTE[h] = i; });

// ====================== 时间窗口工具 ======================
const WINDOW_MS = 10 * 60 * 1000; // 10分钟 

function getWindowId(timestamp) {
    return Math.floor(timestamp / WINDOW_MS);
}

// ====================== 本地密钥派生（与云端 deriveLocalKey 完全一致） ======================
const LOCAL_PASSWORD_SUFFIX = 'LocalFallback2025!#$';
const LOCAL_SALT_STR = 'LocalSalt_Xyz_2025';

async function deriveLocalKey(windowId) {
    const enc = new TextEncoder();
    const password = enc.encode(String(windowId) + LOCAL_PASSWORD_SUFFIX);
    const salt = enc.encode(LOCAL_SALT_STR);
    const km = await crypto.subtle.importKey('raw', password, { name: 'PBKDF2' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
        km,
        { name: 'AES-CBC', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// ====================== 本地加密（百家姓 + AES-CBC） ======================
async function localEncrypt(plaintext) {
    const windowId = getWindowId(Date.now());
    const key = await deriveLocalKey(windowId);

    const enc = new TextEncoder();
    const plainBytes = enc.encode(plaintext);
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plainBytes);
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.length);

    // 时间前缀：windowId → 4 个千字文汉字 
    const timeBytes = new Uint8Array(4);
    new DataView(timeBytes.buffer).setUint32(0, windowId, false);
    let timePrefix = '';
    for (let i = 0; i < 4; i++) timePrefix += CLOUD_HANZI[timeBytes[i]];

    // 密文体 → 百家姓汉字 
    let body = '';
    for (let i = 0; i < combined.length; i++) body += LOCAL_HANZI[combined[i]];

    return timePrefix + body;
}

// ====================== 本地解密（仅限百家姓密文） ======================
async function localDecrypt(ciphertext) {
    if (ciphertext.length < 4) throw new Error('密文太短');

    // 提取时间前缀 
    const timeChars = ciphertext.slice(0, 4);
    const timeBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
        const b = CLOUD_TO_BYTE[timeChars[i]];
        if (b === undefined) throw new Error('时间前缀无效');
        timeBytes[i] = b;
    }
    const windowId = new DataView(timeBytes.buffer).getUint32(0, false);

    // 检查时间窗口（允许前后 2 个窗口）
    const nowId = getWindowId(Date.now());
    const allowedIds = [nowId - 1, nowId, nowId + 1];
    if (!allowedIds.includes(windowId)) throw new Error('密文已过期');

    // 解码百家姓密文体 
    const bodyChars = ciphertext.slice(4);
    const bytes = [];
    for (const ch of bodyChars) {
        const b = LOCAL_TO_BYTE[ch];
        if (b !== undefined) bytes.push(b);
    }
    if (bytes.length < 16) throw new Error('密文数据不完整');
    const combined = new Uint8Array(bytes);
    const iv = combined.slice(0, 16);
    const encrypted = combined.slice(16);

    // 派生密钥（与加密时的窗口ID一致）
    const key = await deriveLocalKey(windowId);
    const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, encrypted);
    return new TextDecoder().decode(pt);
}

// ====================== 密文类型检测 ======================
function detectCipherType(cipherText) {
    const body = cipherText.slice(4);
    let allLocal = true, allCloud = true;
    for (const ch of body) {
        if (LOCAL_TO_BYTE[ch] === undefined) allLocal = false;
        if (CLOUD_TO_BYTE[ch] === undefined) allCloud = false;
    }
    if (allLocal && !allCloud) return 'local';
    if (allCloud && !allLocal) return 'cloud';
    return 'unknown';
}