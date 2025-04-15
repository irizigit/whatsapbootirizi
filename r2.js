const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// إنشاء العميل
const client = new Client({
    authStrategy: new LocalAuth()
});

// عند ظهور رمز QR
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

// عند تسجيل الدخول
client.on('ready', () => {
    console.log('✅ البوت جاهز للعمل!');
});

// قاعدة بيانات مؤقتة
const المحاضرات = [];

// معالجة الرسائل
client.on('message', async (message) => {
    if (message.hasMedia && message.type === 'document') {
        const caption = message.body || "بدون عنوان";

        المحاضرات.push({
            index: المحاضرات.length + 1,
            messageId: message.id._serialized,
            from: message.from,
            title: caption
        });

        console.log("📚 تم حفظ محاضرة:", caption);
        message.reply(`✅ تم حفظ المحاضرة برقم: ${المحاضرات.length}`);
    }

    // عرض المحاضرات
    else if (message.body.toLowerCase() === "عرض المحاضرات") {
        if (محاضرات.length === 0) {
            return message.reply("📭 لا توجد محاضرات حتى الآن.");
        }

        let القائمة = "📚 قائمة المحاضرات:\n";
        for (const p of المحاضرات) {
            القائمة += `${p.index}. ${p.title}\n`;
        }

        message.reply(القائمة);
    }

    // المستخدم يرسل رقم
    else if (/^\d+$/.test(message.body.trim())) {
        const رقم = parseInt(message.body.trim());
        const المحاضرة = المحاضرات.find(p => p.index === رقم);

        if (المحاضرة) {
            await client.forwardMessage(message.from, المحاضرة.messageId);
        } else {
            message.reply("❌ رقم غير صحيح. اكتب 'عرض المحاضرات' لرؤية القائمة.");
        }
    }
});

// تشغيل العميل
client.initialize();
