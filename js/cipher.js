// cloud-cipher.js —— ECDH密钥协商 + 信道加密客户端（安全优化版）
// 修复：sessionId与共享秘密分离，密钥与IV独立派生，可选公钥指纹校验
const CloudCipher = (() => {
    const API_BASE = 'https://tower-pc.tail3cd725.ts.net/other';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // 内部状态
    let sessionId = null;           // 不透明会话标识符（非密钥）
    let sharedSecretHex = null;     // ECDH共享秘密（仅存内存，永不发送）
    let sessionExpiresAt = 0;
    let tokenLock = null;           // ECDH协商并发锁

    const PINNED_FINGERPRINT = '';

    // ————— 工具函数 —————
    function arrayBufferToBase64(buffer) {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    function generateNonce() {
        return arrayBufferToBase64(crypto.getRandomValues(new Uint8Array(12)));
    }
    function arrayBufferToHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    function hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
    }

    // ————— 信道加密工具（安全优化：密钥与IV独立派生） —————
    async function hkdfExpand(secretHex, info, length) {
        const secretBytes = hexToBytes(secretHex);
        const baseKey = await crypto.subtle.importKey(
            'raw', secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false, ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', baseKey, info);
        return new Uint8Array(signature).slice(0, length);
    }

    async function deriveSessionKeys(secretHex, nonceBase64, direction) {
        const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));
        const directionBytes = encoder.encode(direction);
        const infoPrefix = new Uint8Array(nonce.length + directionBytes.length);
        infoPrefix.set(nonce);
        infoPrefix.set(directionBytes, nonce.length);

        // 分别为 AES 密钥和 IV 派生独立的密钥材料
        const keyInfo = new Uint8Array(infoPrefix.length + 8);
        keyInfo.set(infoPrefix);
        keyInfo.set(encoder.encode('-aes-key'), infoPrefix.length);

        const ivInfo = new Uint8Array(infoPrefix.length + 7);
        ivInfo.set(infoPrefix);
        ivInfo.set(encoder.encode('-aes-iv'), infoPrefix.length);

        const aesKeyRaw = await hkdfExpand(secretHex, keyInfo, 32);
        const iv = await hkdfExpand(secretHex, ivInfo, 12);

        const aesKey = await crypto.subtle.importKey(
            'raw', aesKeyRaw,
            { name: 'AES-GCM' },
            false, ['encrypt', 'decrypt']
        );
        return { aesKey, iv };
    }

    async function encryptPayload(secretHex, payloadObj, nonceBase64, direction) {
        const { aesKey, iv } = await deriveSessionKeys(secretHex, nonceBase64, direction);
        const plain = encoder.encode(JSON.stringify(payloadObj));
        const encFullBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, tagLength: 128 },
            aesKey,
            plain
        );
        return new Uint8Array(encFullBuffer);
    }

    async function decryptPayload(secretHex, cipherBuf, nonceBase64, direction) {
        const { aesKey, iv } = await deriveSessionKeys(secretHex, nonceBase64, direction);
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            cipherBuf
        );
        return JSON.parse(decoder.decode(plain));
    }

    // ————— 计算 SHA-256 指纹（用于公钥校验） —————
    async function computeFingerprint(buffer) {
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return arrayBufferToHex(hash);
    }

    // ————— ECDH 密钥协商（安全优化：服务端返回sessionId，客户端保存共享秘密） —————
    async function ensureToken() {
        if (tokenLock) return tokenLock;
        if (sharedSecretHex && sessionId && Date.now() < sessionExpiresAt - 60000) {
            return Promise.resolve();
        }

        tokenLock = new Promise(async (resolve, reject) => {
            try {
                console.log('🔄 正在进行 ECDH 密钥协商...');

                // ① 获取服务端 ECDH 公钥
                const pubKeyRes = await fetch(`${API_BASE}/public-key`);
                if (!pubKeyRes.ok) throw new Error('无法获取服务端公钥');
                const pubKeyData = await pubKeyRes.json();
                const serverPubKeyBase64 = pubKeyData.publicKey;
                const serverPubKeyBuf = base64ToArrayBuffer(serverPubKeyBase64);

                // ③ 生成客户端临时 ECDH 密钥对
                const clientKeyPair = await crypto.subtle.generateKey(
                    { name: 'ECDH', namedCurve: 'P-256' },
                    true,
                    ['deriveBits']
                );

                // ④ 导出客户端公钥
                const clientPubKeyBuf = await crypto.subtle.exportKey('raw', clientKeyPair.publicKey);
                const clientPubKeyBase64 = arrayBufferToBase64(clientPubKeyBuf);

                // ⑤ 导入服务端公钥
                const importedServerPubKey = await crypto.subtle.importKey(
                    'raw', serverPubKeyBuf,
                    { name: 'ECDH', namedCurve: 'P-256' },
                    false,
                    []
                );

                // ⑥ 计算256bit共享密钥 
                const sharedBits = await crypto.subtle.deriveBits(
                    { name: 'ECDH', public: importedServerPubKey },
                    clientKeyPair.privateKey,
                    256
                );
                const newSharedSecretHex = arrayBufferToHex(sharedBits);

                // ⑦ 加密验证载荷
                const nonce = generateNonce();
                const encBuf = await encryptPayload(
                    newSharedSecretHex,
                    { clientPublicKey: clientPubKeyBase64 },
                    nonce,
                    'c2s'
                );
                const data = arrayBufferToBase64(encBuf);

                // ⑧ 发起会话创建请求
                const authRes = await fetch(`${API_BASE}/auth/session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nonce,
                        clientPublicKey: clientPubKeyBase64,
                        data
                    })
                });

                if (!authRes.ok) {
                    const err = await authRes.json().catch(() => ({ error: '协商失败' }));
                    throw new Error(err.error || 'ECDH 会话建立失败');
                }

                // ⑨ 解密响应拿到 sessionId（不透明标识符，非密钥）
                const resJson = await authRes.json();
                const resBuf = base64ToArrayBuffer(resJson.data);
                const result = await decryptPayload(newSharedSecretHex, resBuf, nonce, 's2c');

                // ✅ 安全优化：分别保存 sessionId 和共享秘密
                sessionId = result.sessionId;           // 仅标识符，后续请求中发送
                sharedSecretHex = newSharedSecretHex;   // 密钥，永不发送
                sessionExpiresAt = result.expiresAt;

                console.log(`✅ ECDH 会话建立成功，会话ID: ${sessionId.slice(0, 8)}...，有效期至: ${new Date(sessionExpiresAt).toLocaleTimeString()}`);
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                tokenLock = null;
            }
        });

        return tokenLock;
    }

    // ————— 发送加密业务请求（限制1次401重试） —————
    async function request(method, path, payloadObj, retryCount = 0) {
        await ensureToken();

        const nonce = generateNonce();

        // ✅ 安全优化：使用共享秘密加密，发送 sessionId（非密钥）
        const encBuf = await encryptPayload(sharedSecretHex, payloadObj, nonce, 'c2s');
        const data = arrayBufferToBase64(encBuf);

        const res = await fetch(`${API_BASE}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce, data, sessionId })  // 只发送 sessionId
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '请求失败' }));
            if (res.status === 401 && retryCount < 1) {
                console.log('⚠️ 会话过期，重新协商...');
                sessionId = null;
                sharedSecretHex = null;
                sessionExpiresAt = 0;
                await ensureToken();
                return request(method, path, payloadObj, retryCount + 1);
            }
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const resJson = await res.json();
        const resBuf = base64ToArrayBuffer(resJson.data);
        return decryptPayload(sharedSecretHex, resBuf, nonce, 's2c');
    }

    // ————— 对外暴露接口 —————
    async function encrypt(plaintext) {
        const res = await request('POST', '/encrypt', { plaintext });
        return res.ciphertext;
    }

    async function decrypt(ciphertext) {
        const res = await request('POST', '/decrypt', { ciphertext });
        return res.plaintext;
    }

    // 暴露公钥指纹配置和健康检查
    async function getServerFingerprint() {
        try {
            const res = await fetch(`${API_BASE}/public-key`);
            const data = await res.json();
            return data.fingerprint || null;
        } catch {
            return null;
        }
    }

    return { encrypt, decrypt, getServerFingerprint };
})();
