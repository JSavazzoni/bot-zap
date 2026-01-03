const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const mongoose = require('mongoose');
const express = require('express');
const pino = require('pino');
const NodeCache = require('node-cache'); // O segredo da estabilidade

// ===========================================================
// ⚙️ SUAS CONFIGURAÇÕES
// ===========================================================

// 1. COLOQUE AQUI O LINK DO SEU MONGODB (Cuidado com espaços)
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';

// 2. ID DO SEU GRUPO
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// ===========================================================
// 💾 SISTEMA DE BANCO DE DADOS (SESSÃO)
// ===========================================================
const SessionSchema = new mongoose.Schema({ _id: String, data: Object });
const Session = mongoose.model('BaileysSession', SessionSchema);

const useMongoDBAuthState = async () => {
    const writeData = async (data, id) => {
        try { await Session.findByIdAndUpdate(id, { _id: id, data }, { upsert: true }); } 
        catch(err) { /* Ignora erro de escrita pra não parar */ }
    };
    const readData = async (id) => {
        try { const res = await Session.findById(id); return res ? res.data : null; } 
        catch(err) { return null; }
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
// 🌐 SITE VISUAL (QR CODE NO NAVEGADOR)
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;

let qrRaw = null;
let statusBot = 'Iniciando Sistema...';
let isConnected = false;

app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const html = `
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="refresh" content="3">
        <title>Bot Sticker Baileys</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <style>
            body { background: #0f172a; color: #f8fafc; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2rem; border-radius: 12px; text-align: center; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
            h1 { color: #38bdf8; margin-bottom: 5px; }
            p { color: #94a3b8; font-size: 0.9rem; }
            #qrcode { background: white; padding: 10px; margin: 20px auto; border-radius: 8px; display: none; }
            .status { font-weight: bold; padding: 5px 10px; border-radius: 4px; display: inline-block; margin-top: 10px; }
            .on { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
            .off { color: #fbbf24; background: rgba(251, 191, 36, 0.1); }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🚀 Bot Sticker Ultra</h1>
            <p>Sistema Otimizado para Baixa Memória</p>
            
            <div id="qrcode"></div>
            
            <div style="margin-top: 20px;">
                Status: <span class="status ${isConnected ? 'on' : 'off'}">${isConnected ? 'ONLINE ✅' : statusBot}</span>
            </div>
        </div>
        <script>
            const raw = "${qrRaw || ''}";
            const connected = ${isConnected};
            if (!connected && raw.length > 10) {
                const d = document.getElementById('qrcode');
                d.style.display = 'block';
                d.innerHTML = "";
                new QRCode(d, { text: raw, width: 200, height: 200 });
            }
        </script>
    </body>
    </html>`;
    res.send(html);
});

app.listen(port, () => console.log(`🌍 Site rodando na porta ${port}`));

// ===========================================================
// 🧠 LÓGICA DO ROBÔ (BLINDADA)
// ===========================================================

// Cache para evitar erros de repetição de mensagem
const msgRetryCounterCache = new NodeCache();

const startBot = async () => {
    console.log('🍃 Conectando ao Banco...');
    try { await mongoose.connect(MONGO_URI); console.log('🍃 MongoDB ON.'); } 
    catch (err) { console.error('❌ Erro Mongo:', err); return; }

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMongoDBAuthState();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // Desligado para não dar erro
        logger: pino({ level: 'fatal' }), // Só mostra erro grave (economiza RAM)
        
        // --- CONFIGURAÇÕES ANTI-QUEDA ---
        connectTimeoutMs: 60000, 
        defaultQueryTimeoutMs: 1000000, // Tempo infinito para sincronizar histórico sem cair
        keepAliveIntervalMs: 10000,
        msgRetryCounterCache, // Evita crash de mensagem não lida
        shouldIgnoreJid: jid => jid.includes('broadcast'), // IGNORA STORIES (Economiza muita internet/RAM)
        
        // Fix para desencriptação
        getMessage: async (key) => { return { conversation: 'Oie' }; }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⚡ QR Code NOVO. Abra o site!');
            qrRaw = qr;
            statusBot = 'Escaneie o QR Code';
            isConnected = false;
        }

        if (connection === 'close') {
            const reason = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            console.log(`❌ Conexão caiu (${reason}). Reconectando? ${shouldReconnect}`);

            // Se o WhatsApp desconectou (401) ou foi banido (403), limpa tudo
            if (reason === 401 || reason === 403) {
                console.log('🚫 Sessão inválida. Limpando banco...');
                mongoose.connection.db.dropCollection('baileyssessions').catch(() => {});
            }

            qrRaw = null;
            isConnected = false;
            statusBot = 'Reconectando...';
            
            if (shouldReconnect) {
                setTimeout(startBot, 5000); // Tenta de novo em 5s
            }
        } else if (connection === 'open') {
            console.log('✅ BOT ONLINE E OPERANTE!');
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

        // Detecta Imagem (Normal ou ViewOnce)
        const isImage = msg.message.imageMessage || 
                        msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
                        msg.message.viewOnceMessageV2?.message?.imageMessage;
        
        if (isImage) {
            // Reage com relógio (ignore erro se falhar)
            try { await sock.sendMessage(remoteJid, { react: { text: "⏳", key: msg.key } }); } catch(e){}

            try {
                const imageKey = msg.message.imageMessage ? msg : (msg.message.viewOnceMessageV2 ? msg.message.viewOnceMessageV2 : msg);
                const buffer = await downloadMediaMessage(imageKey, 'buffer', {});

                const sticker = new Sticker(buffer, {
                    pack: '.',
                    author: '.',
                    type: StickerTypes.FULL,
                    quality: 50 // 50% de qualidade = Criação Instantânea
                });

                await sock.sendMessage(remoteJid, await sticker.toMessage(), { quoted: msg });
                await sock.sendMessage(remoteJid, { react: { text: "✅", key: msg.key } });
                console.log('📸 Sticker enviado!');
            } catch (e) {
                console.error('Erro leve:', e.message);
                try { await sock.sendMessage(remoteJid, { react: { text: "❌", key: msg.key } }); } catch(e){}
            }
        }
    });
};

startBot();