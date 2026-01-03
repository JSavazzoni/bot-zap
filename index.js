const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, BufferJSON, downloadMediaMessage } = require('@whiskeysockets/baileys');
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
// SE ESTIVER TESTANDO NO PRIVADO, COMENTE A LINHA DO GRUPO ABAIXO PARA TESTAR
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// ===========================================================
// 💾 SISTEMA DE BANCO (BufferJSON)
// ===========================================================
const SessionSchema = new mongoose.Schema({ _id: String, data: String });
const Session = mongoose.model('BaileysSession', SessionSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 MongoDB Conectado.'))
    .catch(err => console.error('❌ Erro Fatal Mongo:', err));

const useMongoDBAuthState = async () => {
    const writeData = async (data, id) => {
        try {
            const json = JSON.stringify(data, BufferJSON.replacer);
            await Session.findByIdAndUpdate(id, { _id: id, data: json }, { upsert: true });
        } catch(err) { console.error('Erro salvar:', err); }
    };
    const readData = async (id) => {
        try {
            const res = await Session.findById(id);
            if (res && res.data) return JSON.parse(res.data, BufferJSON.reviver);
            return null;
        } catch(err) { return null; }
    };
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
    <div class="box"><h2>🤖 Bot Diagnóstico</h2><div id="qrcode"></div>
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
// 🧠 LÓGICA DO ROBÔ (COM LOGS DE DIAGNÓSTICO)
// ===========================================================
const msgRetryCounterCache = new NodeCache();

const startBot = async () => {
    const { state, saveCreds } = await useMongoDBAuthState();
    let version = [2, 3000, 1015901307];
    try { const v = await fetchLatestBaileysVersion(); version = v.version; } catch(e) {}

    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })) },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false, 
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000, 
        retryRequestDelayMs: 5000,
        msgRetryCounterCache, 
        getMessage: async () => { return { conversation: 'Oie' }; }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            if (qr !== qrRaw) { console.log('⚡ QR Code NOVO.'); qrRaw = qr; statusBot = 'Escaneie o QR Code!'; isConnected = false; }
        }
        if (connection === 'close') {
            const reason = (lastDisconnect?.error)?.output?.statusCode;
            console.log(`❌ Conexão caiu (${reason}). Reconectando...`);
            if (reason === 401 || reason === 403) { await mongoose.connection.db.dropCollection('baileyssessions').catch(()=>{}); }
            qrRaw = null; isConnected = false; statusBot = `Reconectando...`;
            setTimeout(startBot, 5000);
        } else if (connection === 'open') {
            console.log('✅ CONECTADO COM SUCESSO! AGUARDANDO MENSAGENS...');
            qrRaw = null; isConnected = true; statusBot = 'Sistema Online';
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- AQUI ESTÁ A LÓGICA DE MENSAGEM ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return; // Se não tem mensagem, ignora

        // DIAGNÓSTICO: Mostra no log quem mandou mensagem
        const remoteJid = msg.key.remoteJid;
        const quemMandou = msg.pushName || "Desconhecido";
        console.log(`📩 Nova mensagem de: ${quemMandou} (${remoteJid})`);

        // 1. FILTRO DE GRUPO (Agora avisa se estiver errado)
        if (remoteJid !== GRUPO_PERMITIDO) {
            console.log(`⚠️ Ignorado: ID do Grupo diferente. Esperado: ${GRUPO_PERMITIDO} | Recebido: ${remoteJid}`);
            return;
        }

        // 2. DETECTOR DE IMAGEM
        const isImage = msg.message.imageMessage || 
                        msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
                        msg.message.viewOnceMessageV2?.message?.imageMessage;
        
        if (isImage) {
            console.log('🖼️ Imagem detectada! Criando figurinha...');
            
            // Reação
            try { await sock.sendMessage(remoteJid, { react: { text: "⏳", key: msg.key } }); } catch(e){}

            try {
                // Baixa a imagem
                const imageKey = msg.message.imageMessage ? msg : (msg.message.viewOnceMessageV2 ? msg.message.viewOnceMessageV2 : msg);
                const buffer = await downloadMediaMessage(imageKey, 'buffer', {});
                
                // Cria figurinha
                const sticker = new Sticker(buffer, { pack: '.', author: '.', type: StickerTypes.FULL, quality: 40 });

                // Envia
                await sock.sendMessage(remoteJid, await sticker.toMessage(), { quoted: msg });
                await sock.sendMessage(remoteJid, { react: { text: "✅", key: msg.key } });
                console.log('✅ Figurinha enviada!');
            } catch (e) {
                console.error('❌ Erro ao criar figurinha:', e);
                try { await sock.sendMessage(remoteJid, { react: { text: "❌", key: msg.key } }); } catch(e){}
            }
        } else {
            console.log('ℹ️ Mensagem recebida, mas não é imagem.');
        }
    });
};

startBot();