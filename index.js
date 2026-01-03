const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const mongoose = require('mongoose');
const express = require('express');
const pino = require('pino');
const NodeCache = require('node-cache');
const QRCode = require('qrcode');

// ===========================================================
// ⚙️ CONFIGURAÇÕES
// ===========================================================
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// ===========================================================
// 💾 SISTEMA DE BANCO DE DADOS (CACHEADO & OTIMIZADO)
// ===========================================================
const SessionSchema = new mongoose.Schema({ _id: String, data: Object });
const Session = mongoose.model('BaileysSession', SessionSchema);

const useMongoDBAuthState = async () => {
    const writeData = async (data, id) => {
        try { await Session.findByIdAndUpdate(id, { _id: id, data }, { upsert: true }); } catch(err) {}
    };
    const readData = async (id) => {
        try { const res = await Session.findById(id); return res ? res.data : null; } catch(err) { return null; }
    };
    
    const { state: startState } = await useMultiFileAuthState('./temp_auth_init'); 
    const creds = await readData('creds') || startState.creds;

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if(type === 'app-state-sync-key' && value) { value = value.proto; }
                        if(value) data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for(const category in data) {
                        for(const id in data[category]) {
                            const value = data[category][id];
                            tasks.push(writeData(value, `${category}-${id}`));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};

// ===========================================================
// 🌐 SITE VISUAL
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;
let qrRaw = null;
let statusBot = 'Iniciando...';
let isConnected = false;

app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="3"><title>Bot Sticker</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>body{background:#0d1117;color:#c9d1d9;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}
    .box{background:#161b22;padding:2rem;border-radius:12px;border:1px solid #30363d;text-align:center;width:300px}
    #qrcode{background:#fff;padding:10px;margin:20px auto;border-radius:8px;width:fit-content;display:none}
    .st{font-weight:bold;padding:4px 8px;border-radius:4px}</style></head><body>
    <div class="box"><h2>🤖 Bot Sticker</h2><div id="qrcode"></div>
    <p>Status: <span class="st" style="background:${isConnected?'#238636':'#9e6a03'}">${isConnected?'ONLINE':'Aguardando...'}</span></p>
    <p style="font-size:12px;color:#8b949e">${statusBot}</p></div>
    <script>
    const r="${qrRaw||''}",c=${isConnected};
    if(!c && r.length>10){const q=document.getElementById('qrcode');q.style.display='block';q.innerHTML="";new QRCode(q,{text:r,width:180,height:180})}
    </script></body></html>`;
    res.send(html);
});
app.listen(port, () => console.log(`🌍 Site na porta ${port}`));

// ===========================================================
// 🧠 LÓGICA DO ROBÔ (ANTI-515)
// ===========================================================
const msgRetryCounterCache = new NodeCache();

const startBot = async () => {
    console.log('🍃 Conectando Mongo...');
    try { await mongoose.connect(MONGO_URI); console.log('🍃 Mongo OK.'); } 
    catch (err) { console.error('❌ Erro Mongo:', err); return; }

    const { state, saveCreds } = await useMongoDBAuthState();

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        
        // Configurações de Navegador Padrão (Mais aceito pelo Zap)
        browser: ["Bot Sticker", "Chrome", "3.0"], 
        
        // CRUCIAL PARA RENDER FREE:
        syncFullHistory: false, 
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        
        // Configurações de Rede
        connectTimeoutMs: 60000, 
        defaultQueryTimeoutMs: 1000000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 2000, 
        
        msgRetryCounterCache, 
        getMessage: async () => { return { conversation: 'Oie' }; }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⚡ QR Code NOVO (Vá para o site!)');
            qrRaw = qr;
            statusBot = 'Escaneie o QR agora';
            isConnected = false;
        }

        if (connection === 'close') {
            const reason = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            
            console.log(`❌ Caiu (Razão: ${reason}). Reconectar? ${shouldReconnect}`);

            // === A CORREÇÃO DE OURO AQUI ===
            // Só apagamos o banco se for 401 (Logout) ou 403 (Ban)
            // Erros 515, 500, undefined ou rede -> NUNCA APAGUE O BANCO
            if (reason === 401 || reason === 403) {
                console.log('🚫 Sessão inválida (Logout). Limpando banco...');
                await mongoose.connection.db.dropCollection('baileyssessions').catch(()=>{});
                sock.logout();
            }

            qrRaw = null;
            isConnected = false;
            
            if (shouldReconnect) {
                statusBot = `Reconectando (Erro ${reason})...`;
                // Se for erro 515, tenta mais rápido. Se for outro, espera um pouco.
                const delay = reason === 515 ? 2000 : 5000;
                setTimeout(startBot, delay);
            }
        } else if (connection === 'open') {
            console.log('✅ CONECTADO! Estável.');
            qrRaw = null;
            isConnected = true;
            statusBot = 'Sistema Online';
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        if (remoteJid !== GRUPO_PERMITIDO) return;

        const isImage = msg.message.imageMessage || 
                        msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
                        msg.message.viewOnceMessageV2?.message?.imageMessage;
        
        if (isImage) {
            try { await sock.sendMessage(remoteJid, { react: { text: "⏳", key: msg.key } }); } catch(e){}

            try {
                const imageKey = msg.message.imageMessage ? msg : (msg.message.viewOnceMessageV2 ? msg.message.viewOnceMessageV2 : msg);
                const buffer = await downloadMediaMessage(imageKey, 'buffer', {});
                // Qualidade ajustada para 40 (equilíbrio ideal)
                const sticker = new Sticker(buffer, { pack: '.', author: '.', type: StickerTypes.FULL, quality: 40 });

                await sock.sendMessage(remoteJid, await sticker.toMessage(), { quoted: msg });
                await sock.sendMessage(remoteJid, { react: { text: "✅", key: msg.key } });
            } catch (e) {
                console.error('Erro:', e.message);
                try { await sock.sendMessage(remoteJid, { react: { text: "❌", key: msg.key } }); } catch(e){}
            }
        }
    });
};

startBot();