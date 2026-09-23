// cloud‑cipher‑fixed.js
// 安全加固：RFC5869 HKDF、Ed25519长期签名根防MITM、AAD、时间戳防重放、客户端会话指纹、buffer销毁、协议版本、密钥确认
const CloudCipher = (() => {
    const API_BASE = 'https://tower-pc.tail3cd725.ts.net/other';
    const PROTOCOL_VERSION = "v6-secure-ed25519";

    // ======================【重要】粘贴gen‑ed25519‑key.js输出的完整公钥，只配置一次！======================
    const LONG_TERM_ED25519_PUB_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA5ynm758di7/9e1Yy6XNWTF+zL+lix2caKr/TPs6xmLU=
-----END PUBLIC KEY-----`;

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let sessionId = null;
    let sharedSecretHex = null;
    let sessionExpiresAt = 0;
    let tokenLock = null;
    let clientFingerprint = null;
    let importedLongTermPubKey = null;

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
    function destroyBuffer(buf) {
        if (buf instanceof Uint8Array) buf.fill(0);
    }

    // 加载长期Ed25519验证公钥
    async function getLongTermVerifyKey() {
        if (importedLongTermPubKey) return importedLongTermPubKey;
        const pemClean = LONG_TERM_ED25519_PUB_PEM
            .replace(/-----BEGIN PUBLIC KEY-----/g, '')
            .replace(/-----END PUBLIC KEY-----/g, '')
            .replace(/\n/g, '')
            .trim();
        const pemBin = Uint8Array.from(atob(pemClean), c => c.charCodeAt(0));
        importedLongTermPubKey = await crypto.subtle.importKey(
            'spki',
            pemBin,
            { name: "Ed25519" },
            false,
            ["verify"]
        );
        return importedLongTermPubKey;
    }

    // ========= RFC5869 HKDF Extract + Expand =========
    async function hkdfExtract(ikm, salt, hash = "SHA-256") {
        if (!salt) salt = new Uint8Array(32);
        const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash }, false, ["sign"]);
        const prkRaw = await crypto.subtle.sign("HMAC", key, ikm);
        return new Uint8Array(prkRaw);
    }
    async function hkdfExpand(prk, info, length, hash = "SHA-256") {
        const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash }, false, ["sign"]);
        let t = new Uint8Array();
        let okm = new Uint8Array();
        let counter = 1;
        while (okm.length < length) {
            const input = new Uint8Array([...t, ...info, counter]);
            t = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
            okm = new Uint8Array([...okm, ...t]);
            counter++;
        }
        return okm.slice(0, length);
    }
    async function hkdf(ikm, salt, info, len) {
        const prk = await hkdfExtract(ikm, salt);
        return hkdfExpand(prk, info, len);
    }

    async function deriveSessionKeys(secretHex, nonceBase64, direction) {
        const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));
        const directionBytes = encoder.encode(direction);
        const verBytes = encoder.encode(PROTOCOL_VERSION);
        const infoPrefix = new Uint8Array([...verBytes, ...nonce, ...directionBytes]);

        const keyInfo = new Uint8Array([...infoPrefix, ...encoder.encode("-aes-key")]);
        const ivInfo = new Uint8Array([...infoPrefix, ...encoder.encode("-aes-iv")]);

        const secretBytes = hexToBytes(secretHex);
        const aesKeyRaw = await hkdf(secretBytes, null, keyInfo, 32);
        const iv = await hkdf(secretBytes, null, ivInfo, 12);

        const aesKey = await crypto.subtle.importKey(
            'raw', aesKeyRaw,
            { name: 'AES-GCM' },
            false, ['encrypt', 'decrypt']
        );
        destroyBuffer(secretBytes);
        return { aesKey, iv };
    }

    async function encryptPayload(secretHex, payloadObj, nonceBase64, direction, sessionIdAad) {
        const { aesKey, iv } = await deriveSessionKeys(secretHex, nonceBase64, direction);
        const plain = encoder.encode(JSON.stringify(payloadObj));
        const aadRaw = encoder.encode(JSON.stringify({ v: PROTOCOL_VERSION, sid: sessionIdAad ?? "", n: nonceBase64 }));
        const encFullBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, tagLength: 128, additionalData: aadRaw },
            aesKey,
            plain
        );
        return new Uint8Array(encFullBuffer);
    }

    async function decryptPayload(secretHex, cipherBuf, nonceBase64, direction, sessionIdAad) {
        const { aesKey, iv } = await deriveSessionKeys(secretHex, nonceBase64, direction);
        const aadRaw = encoder.encode(JSON.stringify({ v: PROTOCOL_VERSION, sid: sessionIdAad ?? "", n: nonceBase64 }));
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData: aadRaw },
            aesKey,
            cipherBuf
        );
        return JSON.parse(decoder.decode(plain));
    }

    async function ensureToken() {
        if (tokenLock) return tokenLock;
        if (sharedSecretHex && sessionId && Date.now() < sessionExpiresAt - 60000) {
            return Promise.resolve();
        }
        tokenLock = new Promise(async (resolve, reject) => {
            try {
                console.log('🔄 正在进行 ECDH 密钥协商...');
                if (!clientFingerprint) {
                    clientFingerprint = arrayBufferToBase64(crypto.getRandomValues(new Uint8Array(16)));
                }
                const pubKeyRes = await fetch(`${API_BASE}/public-key`);
                if (!pubKeyRes.ok) throw new Error('无法获取服务端公钥');
                const pubKeyData = await pubKeyRes.json();
                const serverPubKeyBuf = base64ToArrayBuffer(pubKeyData.publicKey);
                const sigBuf = base64ToArrayBuffer(pubKeyData.ecdheSignatureBase64);

                // Ed25519签名校验，替代旧指纹pinning，防御MITM
                const verifyKey = await getLongTermVerifyKey();
                const verifyOk = await crypto.subtle.verify(
                    "Ed25519",
                    verifyKey,
                    sigBuf,
                    serverPubKeyBuf
                );
                if (!verifyOk) {
                    throw new Error("Ed25519签名校验失败，疑似中间人攻击！");
                }
                console.log("✅ Ed25519签名校验通过");

                const clientKeyPair = await crypto.subtle.generateKey(
                    { name: 'ECDH', namedCurve: 'P-256' },
                    true,
                    ['deriveBits']
                );
                const clientPubKeyBuf = await crypto.subtle.exportKey('raw', clientKeyPair.publicKey);
                const clientPubKeyBase64 = arrayBufferToBase64(clientPubKeyBuf);

                const importedServerPubKey = await crypto.subtle.importKey(
                    'raw', serverPubKeyBuf,
                    { name: 'ECDH', namedCurve: 'P-256' },
                    false, []
                );
                const sharedBits = await crypto.subtle.deriveBits(
                    { name: 'ECDH', public: importedServerPubKey },
                    clientKeyPair.privateKey,
                    256
                );
                const newSharedSecretHex = arrayBufferToHex(sharedBits);

                const nonce = generateNonce();
                const timestamp = Date.now();
                const encBuf = await encryptPayload(
                    newSharedSecretHex,
                    {
                        clientPublicKey: clientPubKeyBase64,
                        clientFingerprint,
                        timestamp,
                        version: PROTOCOL_VERSION
                    },
                    nonce,
                    'c2s',
                    null
                );
                const data = arrayBufferToBase64(encBuf);

                const authRes = await fetch(`${API_BASE}/auth/session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nonce, clientPublicKey: clientPubKeyBase64, data })
                });
                if (!authRes.ok) {
                    const err = await authRes.json().catch(() => ({ error: '协商失败' }));
                    throw new Error(err.error || 'ECDH 会话建立失败');
                }
                const resJson = await authRes.json();
                const resBuf = base64ToArrayBuffer(resJson.data);
                const result = await decryptPayload(newSharedSecretHex, resBuf, nonce, 's2c', null);

                if (!result.keyConfirm || result.version !== PROTOCOL_VERSION) {
                    throw new Error("密钥确认失败或协议版本不匹配");
                }

                sessionId = result.sessionId;
                sharedSecretHex = newSharedSecretHex;
                sessionExpiresAt = result.expiresAt;
                console.log(`✅ ECDH 会话建立成功，会话ID: ${sessionId.slice(0, 8)}...`);
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                tokenLock = null;
            }
        });
        return tokenLock;
    }

    async function request(method, path, payloadObj, retryCount = 0) {
        await ensureToken();
        const nonce = generateNonce();
        const timestamp = Date.now();
        const wrappedPayload = { ...payloadObj, timestamp, version: PROTOCOL_VERSION, clientFingerprint };
        const encBuf = await encryptPayload(sharedSecretHex, wrappedPayload, nonce, 'c2s', sessionId);
        const data = arrayBufferToBase64(encBuf);
        const res = await fetch(`${API_BASE}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce, data, sessionId })
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
        return decryptPayload(sharedSecretHex, resBuf, nonce, 's2c', sessionId);
    }

    async function encrypt(plaintext) {
        const res = await request('POST', '/encrypt', { plaintext });
        return res.ciphertext;
    }
    async function decrypt(ciphertext) {
        const res = await request('POST', '/decrypt', { ciphertext });
        return res.plaintext;
    }
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
