const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
// 💾 SISTEMA DE BANCO DE DADOS (COM CORRETOR BSON PROFUNDO)
// ===========================================================
const SessionSchema = new mongoose.Schema({ _id: String, data: Object });
const Session = mongoose.model('BaileysSession', SessionSchema);

// Conexão única e persistente
mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 MongoDB Conectado.'))
    .catch(err => console.error('❌ Erro Fatal Mongo:', err));

const useMongoDBAuthState = async () => {
    // --- A CORREÇÃO MÁGICA ---
    // Essa função varre o objeto inteiro procurando "Binary" do Mongo e transformando em "Buffer"
    const fixBsonData = (data) => {
        if (!data) return data;
        
        // Se for Binário do Mongo, converte para Buffer
        if (data._bsontype === 'Binary') return data.read();
        
        // Se for Buffer antigo (JSON), reconverte
        if (data.type === 'Buffer' && Array.isArray(data.data)) return Buffer.from(data.data);

        // Se for objeto ou array, entra nele (Recursividade)
        if (typeof data === 'object') {
            if (Array.isArray(data)) {
                return data.map(fixBsonData);
            }
            const newData = {};
            for (const key in data) {
                newData[key] = fixBsonData(data[key]);
            }
            return newData;
        }
        
        return data;
    };

    const writeData = async (data, id) => {
        try { await Session.findByIdAndUpdate(id, { _id: id, data }, { upsert: true }); } catch(err) {}
    };

    const readData = async (id) => {
        try { 
            const res = await Session.findById(id); 
            // Aplica a correção em TUDO que sai do banco
            return res && res.data ? fixBsonData(res.data) : null; 
        } catch(err) { return null; }
    };
    
    // Inicia sessão limpa se necessário
    const { state: startState } = await useMultiFileAuthState('./temp_auth_void'); 
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
    <div class="box"><h2>🤖 Bot Final</h2><div id="qrcode"></div>
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
// 🧠 LÓGICA DO ROBÔ (ESTÁVEL)
// ===========================================================
const msgRetryCounterCache = new NodeCache();

const startBot = async () => {
    const { state, saveCreds } = await useMongoDBAuthState();
    
    // Tenta pegar versão, se falhar usa fallback
    let version = [2, 3000, 1015901307];
    try {
        const v = await fetchLatestBaileysVersion();
        version = v.version;
    } catch(e) {}

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        
        syncFullHistory: false, // OBRIGATÓRIO
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        
        connectTimeoutMs: 60000, 
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 2000,
        
        msgRetryCounterCache, 
        getMessage: async () => { return { conversation: 'Oie' }; }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⚡ QR Code NOVO. Reset efetuado.');
            qrRaw = qr;
            statusBot = 'Escaneie o QR Code!';
            isConnected = false;
        }

        if (connection === 'close') {
            const reason = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            
            console.log(`❌ Caiu. Código: ${reason || 'Desconhecido'}`);
            
            // SE FOR LOGOUT (401) ou BAN (403)
            if (reason === 401 || reason === 403) {
                console.log('☢️ Sessão inválida. Limpando banco...');
                await mongoose.connection.db.dropCollection('baileyssessions').catch(()=>{});
                // NÃO FAZEMOS sock.logout() AQUI PARA EVITAR CRASH
            }

            qrRaw = null;
            isConnected = false;
            statusBot = `Reconectando...`;
            
            if (shouldReconnect) {
                // Backoff de 5 segundos para não estressar o Render
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ CONECTADO E ESTÁVEL!');
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