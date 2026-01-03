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
// 💾 SISTEMA DE BANCO DE DADOS (SIMPLIFICADO E ROBUSTO)
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
    const removeData = async (id) => {
        try { await Session.findByIdAndDelete(id); } catch(err) {}
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
    <style>body{background:#111;color:#fff;font-family:sans-serif;text-align:center;display:flex;justify-content:center;align-items:center;height:100vh}
    .box{background:#222;padding:20px;border-radius:10px;border:1px solid #444}
    #qrcode{background:#fff;padding:10px;margin:15px auto;width:fit-content;display:none}</style></head><body>
    <div class="box"><h1>🤖 Bot Sticker</h1><div id="qrcode"></div>
    <h3>Status: <span style="color:${isConnected?'#0f0':'#f1c40f'}">${isConnected?'ONLINE ✅':statusBot}</span></h3></div>
    <script>
    const raw="${qrRaw||''}",conn=${isConnected};
    if(!conn && raw.length>10){const d=document.getElementById('qrcode');d.style.display='block';d.innerHTML="";new QRCode(d,{text:raw,width:200,height:200})}
    </script></body></html>`;
    res.send(html);
});
app.listen(port, () => console.log(`🌍 Site na porta ${port}`));

// ===========================================================
// 🧠 LÓGICA DO ROBÔ (ANTI-CRASH)
// ===========================================================
const msgRetryCounterCache = new NodeCache();

const startBot = async () => {
    console.log('🍃 Conectando Mongo...');
    try { await mongoose.connect(MONGO_URI); console.log('🍃 Mongo OK.'); } 
    catch (err) { console.error('❌ Erro Mongo:', err); return; }

    const { state, saveCreds } = await useMongoDBAuthState();

    const sock = makeWASocket({
        // 1. FIXA A VERSÃO (Evita timeout buscando versão)
        version: [2, 3000, 1015901307], 
        auth: {
            creds: state.creds,
            // 2. Cache de chaves para não ler disco toda hora
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }), // Log mínimo
        
        // --- O SEGREDO DO SUCESSO ---
        browser: ["Bot Sticker", "Chrome", "1.0.0"],
        syncFullHistory: false, // <--- ISSO IMPEDE O CRASH DE MEMÓRIA!
        generateHighQualityLinkPreview: false, // Economiza dados
        
        connectTimeoutMs: 60000, 
        keepAliveIntervalMs: 10000,
        msgRetryCounterCache, 
        getMessage: async () => { return { conversation: 'Oie' }; }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⚡ QR Code NOVO (Vá para o site!)');
            qrRaw = qr;
            statusBot = 'Escaneie o QR Code!';
            isConnected = false;
        }

        if (connection === 'close') {
            const reason = (lastDisconnect?.error)?.output?.statusCode;
            // Se o erro for undefined, consideramos que é problema de rede e tentamos de novo
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            
            console.log(`❌ Caiu. Razão: ${reason || 'Indefinida (Rede)'}. Reconectar? ${shouldReconnect}`);

            // Se for logout ou problema de criptografia (428, 515), limpamos a sessão
            if (reason === 401 || reason === 403 || reason === 428) {
                console.log('🚫 Sessão corrompida. Resetando...');
                await mongoose.connection.db.dropCollection('baileyssessions').catch(()=>{});
                sock.logout();
            }

            qrRaw = null;
            isConnected = false;
            statusBot = 'Reconectando...';
            
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ CONECTADO! Histórico ignorado para economizar RAM.');
            qrRaw = null;
            isConnected = true;
            statusBot = 'Online';
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
                const sticker = new Sticker(buffer, { pack: '.', author: '.', type: StickerTypes.FULL, quality: 50 });

                await sock.sendMessage(remoteJid, await sticker.toMessage(), { quoted: msg });
                await sock.sendMessage(remoteJid, { react: { text: "✅", key: msg.key } });
            } catch (e) {
                console.error('Erro:', e.message);
            }
        }
    });
};

startBot();