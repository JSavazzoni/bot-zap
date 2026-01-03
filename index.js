const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express'); // O módulo do site falso

// CONFIGURAÇÃO DO SITE FALSO (Para enganar o servidor e manter ligado)
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('O Bot está vivo! 🤖');
});

app.listen(port, () => {
  console.log(`Servidor web rodando na porta ${port}`);
});

// CONFIGURAÇÃO DO BOT
// ID do seu grupo (COLOCAR O SEU AQUI)
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Obrigatório para Linux/Servidores
    }
});

client.on('qr', (qr) => {
    // Imprime o QR no terminal (logs do site)
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('✅ Bot Online na Nuvem!'));

client.on('message_create', async (msg) => {
    if (msg.fromMe && msg.to === GRUPO_PERMITIDO && msg.hasMedia && msg.type === 'image') {
        try {
            const media = await msg.downloadMedia();
            if(media) {
                await msg.reply(media, null, {
                    sendMediaAsSticker: true,
                    stickerName: "Bot do Grupo",
                    stickerAuthor: "Júlio"
                });
            }
        } catch (error) {
            console.error('Erro:', error);
        }
    }
});

client.initialize();