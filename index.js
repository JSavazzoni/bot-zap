const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const mongoose = require('mongoose');
const express = require('express');
const pino = require('pino');
const QRCode = require('qrcode');

// ===========================================================
// ⚙️ CONFIGURAÇÕES
// ===========================================================

// ⚠️ CONFIRA SE SUA URL ESTÁ CERTA (SEM ESPAÇOS)
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// ===========================================================
// 💾 SISTEMA DE SALVAMENTO NO MONGODB (CORRIGIDO)
// ===========================================================
const SessionSchema = new mongoose.Schema({ _id: String, data: Object });
const Session = mongoose.model('BaileysSession', SessionSchema);

const useMongoDBAuthState = async () => {
    const writeData = async (data, id) => {
        try {
            await Session.findByIdAndUpdate(id, { _id: id, data }, { upsert: true });
        } catch(err) { console.error('Erro ao salvar sessão:', err); }
    };
    const readData = async (id) => {
        try {
            const res = await Session.findById(id);
            return res ? res.data : null;
        } catch(err) { return null; }
    };
    const removeData = async (id) => {
        try { await Session.findByIdAndDelete(id); } catch(err) {}
    };

    // Gera credenciais iniciais vazias se não existirem no banco
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
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="refresh" content="3">
        <title>Bot Baileys</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <style>
            body { background: #0f172a; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .box { background: #1e293b; padding: 2rem; border-radius: 10px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
            h1 { color: #38bdf8; }
            #qrcode { background: white; padding: 10px; margin: 20px auto; width: fit-content; border-radius: 5px; display: none; }
        </style>
    </head>
    <body>
        <div class="box">
            <h1>🤖 Bot Sticker</h1>
            <div id="qrcode"></div>
            <h3>Status: <span style="color:${isConnected ? '#4ade80' : '#fbbf24'}">${isConnected ? 'ONLINE 🚀' : statusBot}</span></h3>
            ${isConnected ? '<p>Sistema rodando liso.</p>' : '<p>Aguarde o QR Code...</p>'}
        </div>
        <script>
            const raw = "${qrRaw || ''}";
            const connected = ${isConnected};
            if (!connected && raw.length > 10) {
                const qrDiv = document.getElementById('qrcode');
                qrDiv.style.display = 'block';
                qrDiv.innerHTML = "";
                new QRCode(qrDiv, { text: raw, width: 200, height: 200 });
            }
        </script>
    </body>
    </html>`;
    res.send(html);
});

app.listen(port, () => console.log(`🌍 Site na porta ${port}`));

// ===========================================================
// 🧠 LÓGICA DO ROBÔ
// ===========================================================

const startBot = async () => {
    console.log('🍃 Conectando ao Banco de Dados...');
    try {
        await mongoose.connect(MONGO_URI);
        console.log('🍃 MongoDB Conectado.');
    } catch (err) {
        console.error('❌ Erro Fatal no Mongo:', err);
        return;
    }

    // Busca a versão mais recente do WhatsApp para evitar conflitos
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📡 Usando WhatsApp versão v${version.join('.')}, é a mais recente? ${isLatest}`);

    const { state, saveCreds } = await useMongoDBAuthState();

    const sock = makeWASocket({
        version, // Usa a versão correta
        auth: state,
        printQRInTerminal: false, // REMOVIDO O AVISO CHATO
        logger: pino({ level: 'silent' }),
        browser: ["Bot Sticker", "Chrome", "10.0"], // Browser fixo
        connectTimeoutMs: 60000, // Aumenta tempo de tolerância
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        retryRequestDelayMs: 250
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⚡ QR Code NOVO gerado (Abra o site)');
            qrRaw = qr;
            statusBot = 'Escaneie o QR Code!';
            isConnected = false;
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ Conexão caiu. Reconectando? ${shouldReconnect}`);
            
            // Se foi desconectado (logoff), limpa as credenciais do banco
            if (!shouldReconnect) {
                console.log('🚫 Sessão encerrada. Limpando banco para novo login...');
                mongoose.connection.db.dropCollection('baileyssessions').catch(() => {});
            }

            qrRaw = null;
            isConnected = false;
            statusBot = 'Reconectando...';
            
            if (shouldReconnect) {
                setTimeout(startBot, 3000); // Espera 3 seg e tenta de novo
            }
        } else if (connection === 'open') {
            console.log('✅ CONECTADO! Bot pronto para uso.');
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

        // Suporte a Imagem (imageMessage) e Imagem como Documento (viewOnce)
        const isImage = msg.message.imageMessage || 
                        msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
                        msg.message.viewOnceMessageV2?.message?.imageMessage;
        
        if (isImage) {
            await sock.sendMessage(remoteJid, { react: { text: "⏳", key: msg.key } });
            try {
                // Pega o objeto correto da imagem
                const imageKey = msg.message.imageMessage ? msg : 
                               (msg.message.viewOnceMessageV2 ? msg.message.viewOnceMessageV2 : msg);

                const buffer = await downloadMediaMessage(imageKey, 'buffer', {});

                const sticker = new Sticker(buffer, {
                    pack: '.',
                    author: '.',
                    type: StickerTypes.FULL,
                    quality: 60
                });

                await sock.sendMessage(remoteJid, await sticker.toMessage(), { quoted: msg });
                await sock.sendMessage(remoteJid, { react: { text: "✅", key: msg.key } });
                console.log('📸 Figurinha criada!');
            } catch (e) {
                console.error('Erro ao criar:', e);
                await sock.sendMessage(remoteJid, { react: { text: "❌", key: msg.key } });
            }
        }
    });
};

startBot();