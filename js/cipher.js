// cloud-cipher.js —— ECDH密钥协商 + 信道加密客户端（无长期密钥，移除公钥指纹校验）
const CloudCipher = (() => {
    const API_BASE = 'https://tower-pc.tail3cd725.ts.net';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // 内部状态
    let sessionToken = null;
    let sessionExpiresAt = 0;
    let tokenLock = null; // ECDH协商并发锁

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

    // ————— 信道加密工具（与后端完全对齐） —————
    async function deriveSessionKeys(secretHex, nonceBase64, direction) {
        const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));
        // hex字符串转字节数组
        const secretBytes = new Uint8Array(secretHex.length / 2);
        for (let i = 0; i < secretHex.length; i += 2) {
            secretBytes[i / 2] = parseInt(secretHex.substring(i, i + 2), 16);
        }
        const baseKey = await crypto.subtle.importKey(
            'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const info = encoder.encode(direction);
        const combined = new Uint8Array(nonce.length + info.length);
        combined.set(nonce);
        combined.set(info, nonce.length);
        const hmacRaw = await crypto.subtle.sign('HMAC', baseKey, combined);
        const raw = new Uint8Array(hmacRaw);

        const aesKey = await crypto.subtle.importKey(
            'raw', raw.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
        );
        return { aesKey, iv: raw.slice(0, 12) };
    }

    async function encryptPayload(secretHex, payloadObj, nonceBase64, direction) {
        const { aesKey, iv } = await deriveSessionKeys(secretHex, nonceBase64, direction);
        const plain = encoder.encode(JSON.stringify(payloadObj));
        const encFullBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, tagLength: 128 },  // ✅ 128 位 = 16 字节
            aesKey,
            plain
        );
        return new Uint8Array(encFullBuffer);
    }

    async function decryptPayload(secretHex, cipherBuf, nonceBase64, direction) {
        const { aesKey, iv } = await deriveSessionKeys(secretHex, nonceBase64, direction);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBuf);
        return JSON.parse(decoder.decode(plain));
    }

    // ————— ECDH 密钥协商（获取会话令牌，自动加锁防并发，移除指纹校验） —————
    async function ensureToken() {
        // 已有协商进行中，等待锁
        if (tokenLock) return tokenLock;
        // 令牌有效，无需重协商
        if (sessionToken && Date.now() < sessionExpiresAt - 60000) {
            return Promise.resolve();
        }

        tokenLock = new Promise(async (resolve, reject) => {
            try {
                console.log('🔄 正在进行 ECDH 密钥协商...');

                // ① 获取服务端 ECDH 公钥
                const pubKeyRes = await fetch(`${API_BASE}/public-key`);
                if (!pubKeyRes.ok) throw new Error('无法获取服务端公钥');
                const { publicKey: serverPubKeyBase64 } = await pubKeyRes.json();
                const serverPubKeyBuf = base64ToArrayBuffer(serverPubKeyBase64);

                // 已删除公钥指纹校验代码，不再需要配置指纹

                // ② 生成客户端临时 ECDH 密钥对
                const clientKeyPair = await crypto.subtle.generateKey(
                    { name: 'ECDH', namedCurve: 'P-256' },
                    true,
                    ['deriveBits']
                );

                // ③ 导出客户端公钥 raw 65字节
                const clientPubKeyBuf = await crypto.subtle.exportKey('raw', clientKeyPair.publicKey);
                const clientPubKeyBase64 = arrayBufferToBase64(clientPubKeyBuf);

                // ④ 导入服务端公钥
                const importedServerPubKey = await crypto.subtle.importKey(
                    'raw', serverPubKeyBuf,
                    { name: 'ECDH', namedCurve: 'P-256' },
                    false,
                    []
                );

                // ⑤ 计算256bit共享密钥
                const sharedBits = await crypto.subtle.deriveBits(
                    { name: 'ECDH', public: importedServerPubKey },
                    clientKeyPair.privateKey,
                    256
                );
                const sharedSecretHex = arrayBufferToHex(sharedBits);

                // ⑥ 加密验证载荷
                const nonce = generateNonce();
                const encBuf = await encryptPayload(
                    sharedSecretHex,
                    { clientPublicKey: clientPubKeyBase64 },
                    nonce,
                    'c2s'
                );
                const data = arrayBufferToBase64(encBuf);

                // ⑦ 发起会话创建请求
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

                // ⑧ 解密响应拿到sessionToken
                const resJson = await authRes.json();
                const resBuf = base64ToArrayBuffer(resJson.data);
                const result = await decryptPayload(sharedSecretHex, resBuf, nonce, 's2c');

                sessionToken = result.sessionToken;
                sessionExpiresAt = result.expiresAt;

                console.log(`✅ ECDH 会话建立成功，令牌有效期至: ${new Date(sessionExpiresAt).toLocaleTimeString()}`);
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                tokenLock = null;
            }
        });

        return tokenLock;
    }

    // ————— 发送加密业务请求（限制1次401重试，防止死递归） —————
    async function request(method, path, payloadObj, retryCount = 0) {
        await ensureToken();

        const nonce = generateNonce();
        const encBuf = await encryptPayload(sessionToken, payloadObj, nonce, 'c2s');
        const data = arrayBufferToBase64(encBuf);

        const res = await fetch(`${API_BASE}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce, data, sessionToken })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '请求失败' }));
            // 仅允许重试1次
            if (res.status === 401 && retryCount < 1) {
                console.log('⚠️ 令牌过期，重新协商...');
                sessionToken = null;
                sessionExpiresAt = 0;
                await ensureToken();
                return request(method, path, payloadObj, retryCount + 1);
            }
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const resJson = await res.json();
        const resBuf = base64ToArrayBuffer(resJson.data);
        return decryptPayload(sessionToken, resBuf, nonce, 's2c');
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

    return { encrypt, decrypt };
})();