const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const userState = new Map();
let groupId = null; // المجموعة الرئيسية
let PDF_ARCHIVE_GROUP = '120363419732549362@g.us'; // استبدل بمعرف أرشيف PDF
let IMAGES_ARCHIVE_GROUP = ' 120363400468776166@g.us'; // استبدل بمعرف أرشيف الصور
let requestCount = 0;

const metadataPath = path.join(__dirname, 'metadata.json');
const signature = "\n\n👨‍💻 *تطوير: IRIZI 😊*";
const allowedUser = '212621957775@c.us';

// إنشاء metadata.json إذا غير موجود
if (!fs.existsSync(metadataPath)) {
    fs.writeFileSync(metadataPath, JSON.stringify({}));
}

// تحميل البيانات الوصفية
function loadMetadata() {
    return JSON.parse(fs.readFileSync(metadataPath));
}

// حفظ البيانات الوصفية
function saveMetadata(data) {
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
}

// إنشاء رقم تسلسلي
function generateSerialNumber(metadata) {
    return String(Object.keys(metadata).length + 1).padStart(3, '0');
}

// حساب رقم المحاضرة تلقائيًا
function getLectureNumber(metadata, subject, group) {
    const count = Object.values(metadata).filter(l => l.subject === subject && l.group === group).length;
    return count + 1;
}

// دالة لإرسال إشعار للمشرف
async function notifyAdmins(userId, text) {
    try {
        await client.sendMessage(allowedUser, text);
    } catch (error) {
        console.error('❌ خطأ أثناء إرسال إشعار للمشرف:', error);
    }
}

// التحقق من صلاحيات المشرف
async function isAdmin(userId, groupId) {
    try {
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) return false;
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return admins.some(admin => admin.id._serialized === userId);
    } catch (error) {
        console.error('❌ خطأ أثناء التحقق من حالة المشرف:', error);
        return false;
    }
}

// التحقق من صلاحيات البوت
async function isBotAdmin(groupId) {
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return admins.some(admin => admin.id._serialized === botId);
    } catch (error) {
        console.error('❌ خطأ أثناء التحقق من حالة البوت:', error);
        return false;
    }
}

// التحقق من وجود المجموعة
async function verifyGroup(groupId, groupName) {
    try {
        await client.getChatById(groupId);
        return true;
    } catch (error) {
        console.error(`❌ خطأ: مجموعة ${groupName} غير موجودة:`, error);
        return false;
    }
}

client.on('qr', qr => {
    console.log('📸 امسح رمز QR لتسجيل الدخول:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ العميل جاهز ومتصل!');
    try {
        const chats = await client.getChats();
        console.log('📋 قائمة المجموعات:');
        chats.forEach(chat => {
            if (chat.isGroup) {
                console.log(`- اسم المجموعة: ${chat.name}, المعرف: ${chat.id._serialized}`);
            }
        });
    } catch (error) {
        console.error('❌ خطأ أثناء جلب المجموعات:', error);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup);
        if (group) {
            groupId = group.id._serialized;
            console.log(`[ℹ️] تم تحديد المجموعة الرئيسية: ${groupId}`);
        }
        if (!(await verifyGroup(PDF_ARCHIVE_GROUP, 'أرشيف PDF'))) {
            console.log('[⚠️] معرف أرشيف PDF غير صحيح!');
        }
        if (!(await verifyGroup(IMAGES_ARCHIVE_GROUP, 'أرشيف الصور'))) {
            console.log('[⚠️] معرف أرشيف الصور غير صحيح!');
        }
    } catch (error) {
        console.error('❌ خطأ أثناء جلب المجموعات:', error);
    }
});

client.on('group_join', (notification) => {
    groupId = notification.chatId;
    console.log(`[📢] انضم البوت إلى المجموعة: ${groupId}`);
});

// إغلاق وفتح المجموعة تلقائيًا
cron.schedule('0 22 * * *', async () => {
    if (!groupId) return console.log('[⚠️] لا يوجد groupId لإغلاق المجموعة.');
    try {
        const chat = await client.getChatById(groupId);
        if (await isBotAdmin(groupId)) {
            await chat.setMessagesAdminsOnly(true);
            await client.sendMessage(groupId, '🌙 *الساعة 10:00 مساءً!* المجموعة مغلقة الآن. فقط المشرفين يمكنهم الإرسال.' + signature);
            console.log('[✅] تم إغلاق المجموعة عبر cron.');
        }
    } catch (error) {
        console.error('[❌] خطأ أثناء إغلاق المجموعة:', error);
    }
});

cron.schedule('0 8 * * *', async () => {
    if (!groupId) return console.log('[⚠️] لا يوجد groupId لفتح المجموعة.');
    try {
        const chat = await client.getChatById(groupId);
        if (await isBotAdmin(groupId)) {
            await chat.setMessagesAdminsOnly(false);
            await client.sendMessage(groupId, '☀️ *الساعة 8:00 صباحًا!* المجموعة مفتوحة الآن للجميع.' + signature);
            console.log('[✅] تم فتح المجموعة عبر cron.');
        }
    } catch (error) {
        console.error('[❌] خطأ أثناء فتح المجموعة:', error);
    }
});

client.on('message_create', async message => {
    try {
        const userId = message.from.includes('@g.us') ? message.author : message.from;
        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || "مستخدم";
        const content = message.body.trim().toLowerCase();
        const isGroupMessage = message.from.includes('@g.us');
        const currentGroupId = isGroupMessage ? message.from : groupId;

        console.log(`[📩] رسالة من ${senderName} (${userId}): ${content}`);

        const metadata = loadMetadata();

        // إدارة الحالة
        if (userState.has(userId)) {
            const state = userState.get(userId);

            // التراجع
            if (content === 'تراجع') {
                await message.reply(`✅ تم إلغاء العملية، يا *${senderName}*! جرب أمر جديد من قائمة *الأوامر*.` + signature);
                userState.delete(userId);
                return;
            }

            // إضافة PDF
            if (state.step === 'add_pdf_subject') {
                state.subject = message.body.trim();
                userState.set(userId, { ...state, step: 'add_pdf_group' });
                await message.reply(`📚 *المادة*: ${state.subject}\n📌 أدخل الفوج (مثل: أ)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_pdf_group') {
                state.group = message.body.trim();
                userState.set(userId, { ...state, step: 'add_pdf_lecture_name' });
                await message.reply(`📚 *المادة*: ${state.subject}\n👥 *الفوج*: ${state.group}\n📌 أدخل اسم المحاضرة (اختياري، اضغط إرسال إذا لا يوجد)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_pdf_lecture_name') {
                state.lectureName = message.body.trim() || 'محاضرة';
                userState.set(userId, { ...state, step: 'add_pdf_number' });
                await message.reply(`📚 *المادة*: ${state.subject}\n👥 *الفوج*: ${state.group}\n📝 *الاسم*: ${state.lectureName}\n📌 أدخل رقم المحاضرة (اختياري، اضغط إرسال إذا لا يوجد)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_pdf_number') {
                state.number = message.body.trim();
                userState.set(userId, { ...state, step: 'add_pdf_professor' });
                await message.reply(`📚 *المادة*: ${state.subject}\n👥 *الفوج*: ${state.group}\n📝 *الاسم*: ${state.lectureName}\n🔢 *الرقم*: ${state.number || 'سيُحسب تلقائيًا'}\n📌 أدخل اسم الأستاذ (اختياري، اضغط إرسال إذا لا يوجد)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_pdf_professor') {
                state.professor = message.body.trim() || 'غير محدد';
                userState.set(userId, { ...state, step: 'add_pdf_file' });
                await message.reply(`✅ *تفاصيل المحاضرة*:\n📚 المادة: ${state.subject}\n👥 الفوج: ${state.group}\n📝 الاسم: ${state.lectureName}\n🔢 الرقم: ${state.number || 'سيُحسب'}\n👨‍🏫 الأستاذ: ${state.professor}\n📎 أرسل ملف PDF الآن (رد على هذه الرسالة).\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_pdf_file') {
                if (!message.hasMedia || message.type !== 'document' || !message.mimetype.includes('application/pdf')) {
                    await message.reply(`❌ من فضلك أرسل ملف PDF صالح، يا *${senderName}*!\n📎 رد على الرسالة السابقة بملف PDF.\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                    return;
                }

                // التحقق من المجموعة الأرشيفية
                if (!(await verifyGroup(PDF_ARCHIVE_GROUP, 'أرشيف PDF'))) {
                    await message.reply(`❌ خطأ: أرشيف PDF غير متاح. تواصل مع المشرف، يا *${senderName}*.` + signature);
                    await notifyAdmins(userId, `⚠️ معرف أرشيف PDF غير صحيح أو غير متاح.`);
                    userState.delete(userId);
                    return;
                }

                // التحقق من صلاحيات البوت
                if (!(await isBotAdmin(PDF_ARCHIVE_GROUP))) {
                    await message.reply(`❌ خطأ: البوت ليس مشرفًا في أرشيف PDF. تواصل مع المشرف، يا *${senderName}*.` + signature);
                    await notifyAdmins(userId, `⚠️ البوت ليس مشرفًا في أرشيف PDF.`);
                    userState.delete(userId);
                    return;
                }

                let media;
                try {
                    media = await message.downloadMedia();
                    if (!media) throw new Error('فشل تحميل الملف');
                } catch (error) {
                    console.error('❌ خطأ أثناء تحميل PDF:', error);
                    await message.reply(`❌ فشل تحميل ملف PDF، يا *${senderName}*. حاول مرة أخرى.` + signature);
                    userState.delete(userId);
                    return;
                }

                const serial = generateSerialNumber(metadata);
                const lectureNumber = state.number || getLectureNumber(metadata, state.subject, state.group);
                const lectureName = `${serial} - ${state.lectureName} - ${lectureNumber} - ${state.professor}`;

                let sentMsg;
                try {
                    const archiveChat = await client.getChatById(PDF_ARCHIVE_GROUP);
                    sentMsg = await archiveChat.sendMessage(media, { caption: lectureName });
                } catch (error) {
                    console.error('❌ خطأ أثناء إرسال PDF إلى أرشيف PDF:', error);
                    await message.reply(`❌ فشل إرسال المحاضرة إلى أرشيف PDF، يا *${senderName}*. حاول مرة أخرى.` + signature);
                    await notifyAdmins(userId, `⚠️ فشل إرسال محاضرة PDF: ${lectureName}`);
                    userState.delete(userId);
                    return;
                }

                // تسجيل البيانات بعد الإرسال الناجح
                metadata[sentMsg.id._serialized] = {
                    name: lectureName,
                    subject: state.subject,
                    group: state.group,
                    number: lectureNumber,
                    professor: state.professor,
                    type: 'PDF',
                    messageId: sentMsg.id._serialized,
                    date: new Date().toISOString()
                };
                saveMetadata(metadata);

                await message.reply(`🎉 *تمت إضافة المحاضرة بنجاح، يا ${senderName}!*\n📚 *${lectureName}*\n📎 مخزنة في أرشيف PDF.` + signature);
                await notifyAdmins(userId, `📢 *محاضرة جديدة*: ${lectureName} (PDF) بواسطة ${senderName}`);
                userState.delete(userId);
                return;
            }

            // إضافة صور
            if (state.step === 'add_images_subject') {
                state.subject = message.body.trim();
                userState.set(userId, { ...state, step: 'add_images_group' });
                await message.reply(`📚 *المادة*: ${state.subject}\n📌 أدخل الفوج (مثل: أ)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_images_group') {
                state.group = message.body.trim();
                userState.set(userId, { ...state, step: 'add_images_lecture_name' });
                await message.reply(`📚 *المادة*: ${state.subject}\n👥 *الفوج*: ${state.group}\n📌 أدخل اسم المحاضرة (اختياري، اضغط إرسال إذا لا يوجد)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_images_lecture_name') {
                state.lectureName = message.body.trim() || 'محاضرة';
                userState.set(userId, { ...state, step: 'add_images_number' });
                await message.reply(`📚 *المادة*: ${state.subject}\n👥 *الفوج*: ${state.group}\n📝 *الاسم*: ${state.lectureName}\n📌 أدخل رقم المحاضرة (اختياري، اضغط إرسال إذا لا يوجد)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_images_number') {
                state.number = message.body.trim();
                userState.set(userId, { ...state, step: 'add_images_professor' });
                await message.reply(`📚 *المادة*: ${state.subject}\n👥 *الفوج*: ${state.group}\n📝 *الاسم*: ${state.lectureName}\n🔢 *الرقم*: ${state.number || 'سيُحسب تلقائيًا'}\n📌 أدخل اسم الأستاذ (اختياري، اضغط إرسال إذا لا يوجد)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_images_professor') {
                state.professor = message.body.trim() || 'غير محدد';
                state.images = [];
                state.startTime = Date.now();
                userState.set(userId, { ...state, step: 'add_images_collect' });
                await message.reply(`✅ *تفاصيل المحاضرة*:\n📚 المادة: ${state.subject}\n👥 الفوج: ${state.group}\n📝 الاسم: ${state.lectureName}\n🔢 الرقم: ${state.number || 'سيُحسب'}\n👨‍🏫 الأستاذ: ${state.professor}\n📸 أرسل الصور (كألبوم أو منفصلة، بحد أقصى 10) خلال 60 ثانية. اكتب 'إنهاء' عند الانتهاء.\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }
            if (state.step === 'add_images_collect') {
                if (content === 'إنهاء' || (Date.now() - state.startTime) > 60000) {
                    if (state.images.length === 0) {
                        await message.reply(`❌ لم ترسل أي صور، يا *${senderName}*! تم إلغاء العملية.` + signature);
                        userState.delete(userId);
                        return;
                    }
                    if (state.images.length > 10) {
                        await message.reply(`❌ الحد الأقصى 10 صور، يا *${senderName}*! تم إلغاء العملية.` + signature);
                        userState.delete(userId);
                        return;
                    }

                    // التحقق من المجموعة الأرشيفية
                    if (!(await verifyGroup(IMAGES_ARCHIVE_GROUP, 'أرشيف الصور'))) {
                        await message.reply(`❌ خطأ: أرشيف الصور غير متاح. تواصل مع المشرف، يا *${senderName}*.` + signature);
                        await notifyAdmins(userId, `⚠️ معرف أرشيف الصور غير صحيح أو غير متاح.`);
                        userState.delete(userId);
                        return;
                    }

                    // التحقق من صلاحيات البوت
                    if (!(await isBotAdmin(IMAGES_ARCHIVE_GROUP))) {
                        await message.reply(`❌ خطأ: البوت ليس مشرفًا في أرشيف الصور. تواصل مع المشرف، يا *${senderName}*.` + signature);
                        await notifyAdmins(userId, `⚠️ البوت ليس مشرفًا في أرشيف الصور.`);
                        userState.delete(userId);
                        return;
                    }

                    const serial = generateSerialNumber(metadata);
                    const lectureNumber = state.number || getLectureNumber(metadata, state.subject, state.group);
                    const lectureName = `${serial} - ${state.lectureName} - ${lectureNumber} - ${state.professor}`;

                    let sentMsg;
                    try {
                        const archiveChat = await client.getChatById(IMAGES_ARCHIVE_GROUP);
                        const mediaArray = state.images.map(data => {
                            if (!data.mimetype || !data.data) throw new Error('بيانات الصورة غير صالحة');
                            return new MessageMedia(data.mimetype, data.data.toString('base64'));
                        });
                        sentMsg = await archiveChat.sendMessage(mediaArray, { caption: lectureName });
                    } catch (error) {
                        console.error('❌ خطأ أثناء إرسال الصور إلى أرشيف الصور:', error);
                        await message.reply(`❌ فشل إرسال المحاضرة إلى أرشيف الصور، يا *${senderName}*. حاول مرة أخرى.` + signature);
                        await notifyAdmins(userId, `⚠️ فشل إرسال محاضرة صور: ${lectureName}`);
                        userState.delete(userId);
                        return;
                    }

                    // تسجيل البيانات بعد الإرسال الناجح
                    metadata[sentMsg.id._serialized] = {
                        name: lectureName,
                        subject: state.subject,
                        group: state.group,
                        number: lectureNumber,
                        professor: state.professor,
                        type: 'صور',
                        messageId: sentMsg.id._serialized,
                        date: new Date().toISOString()
                    };
                    saveMetadata(metadata);

                    await message.reply(`🎉 *تمت إضافة المحاضرة بنجاح، يا ${senderName}!*\n📸 *${lectureName}*\n📎 مخزنة في أرشيف الصور كألبوم.` + signature);
                    await notifyAdmins(userId, `📢 *محاضرة جديدة*: ${lectureName} (صور) بواسطة ${senderName}`);
                    userState.delete(userId);
                    return;
                }
                if (message.hasMedia && message.type === 'image') {
                    let media;
                    try {
                        media = await message.downloadMedia();
                        if (!media) throw new Error('فشل تحميل الصورة');
                    } catch (error) {
                        console.error('❌ خطأ أثناء تحميل الصورة:', error);
                        await message.reply(`❌ فشل تحميل الصورة، يا *${senderName}*. حاول مرة أخرى.` + signature);
                        return;
                    }
                    state.images.push(media);
                    await message.reply(`📸 *صورة ${state.images.length}/10* وصلت، يا *${senderName}*! أرسل المزيد أو اكتب 'إنهاء'.` + signature);
                    userState.set(userId, state);
                    return;
                }
                return;
            }

            // اختيار محاضرة
            if (state.step === 'select_lecture') {
                const lectureIndex = parseInt(message.body) - 1;
                if (lectureIndex >= 0 && lectureIndex < state.lectures.length) {
                    const lectureKey = state.lectures[lectureIndex];
                    const lecture = metadata[lectureKey];
                    const archiveGroup = lecture.type === 'PDF' ? PDF_ARCHIVE_GROUP : IMAGES_ARCHIVE_GROUP;

                    if (!(await verifyGroup(archiveGroup, lecture.type === 'PDF' ? 'أرشيف PDF' : 'أرشيف الصور'))) {
                        await message.reply(`❌ خطأ: الأرشيف غير متاح، يا *${senderName}*. تواصل مع المشرف.` + signature);
                        await notifyAdmins(userId, `⚠️ معرف أرشيف ${lecture.type} غير صحيح أو غير متاح.`);
                        userState.delete(userId);
                        return;
                    }

                    try {
                        const archiveChat = await client.getChatById(archiveGroup);
                        const archivedMsg = await archiveChat.fetchMessages({ limit: 1000 }).find(m => m.id._serialized === lecture.messageId);
                        if (archivedMsg) {
                            await archivedMsg.forward(userId);
                            await client.sendMessage(userId, `📚 *المحاضرة*: ${lecture.name}\n📖 *المادة*: ${lecture.subject}\n👥 *الفوج*: ${lecture.group}\n🔢 *الرقم*: ${lecture.number}\n👨‍🏫 *الأستاذ*: ${lecture.professor}\n\nتفضل، يا *${senderName}*!` + signature);
                            requestCount++;
                        } else {
                            await message.reply(`❌ المحاضرة غير متاحة، يا *${senderName}*. تواصل مع المشرف.` + signature);
                            await notifyAdmins(userId, `⚠️ المحاضرة غير متاحة: ${lecture.name}`);
                        }
                    } catch (error) {
                        console.error('❌ خطأ أثناء استرجاع المحاضرة:', error);
                        await message.reply(`❌ حدث خطأ، يا *${senderName}*. حاول لاحقًا.` + signature);
                        await notifyAdmins(userId, `⚠️ خطأ في استرجاع: ${lecture.name}`);
                    }
                    userState.delete(userId);
                    return;
                }
                await message.reply(`⚠️ رقم غير صحيح، يا *${senderName}*! حاول مرة أخرى.` + signature);
                return;
            }

            // البحث عن محاضرة
            if (state.step === 'search_lecture') {
                const query = message.body.toLowerCase();
                const lectures = Object.keys(metadata).filter(key =>
                    metadata[key].name.toLowerCase().includes(query) ||
                    metadata[key].subject.toLowerCase().includes(query) ||
                    metadata[key].professor.toLowerCase().includes(query)
                );

                if (lectures.length === 0) {
                    await message.reply(`🔍 لم يتم العثور على محاضرات لـ *${query}*، يا *${senderName}*. حاول كلمة أخرى.` + signature);
                    userState.delete(userId);
                    return;
                }

                let lectureList = `📚 *نتائج البحث عن "${query}":*\n`;
                lectures.forEach((key, index) => {
                    const lecture = metadata[key];
                    lectureList += `${index + 1}. ${lecture.name} (${lecture.type})\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة، يا *${senderName}*!`;

                userState.set(userId, { step: 'select_lecture', lectures });
                await message.reply(lectureList + signature);
                return;
            }
        }

        // التحكم في المجموعة من الخاص
        if (!isGroupMessage && userId === allowedUser) {
            if (content === 'إغلاق المجموعة') {
                if (!currentGroupId) {
                    await message.reply(`⚠️ لم يتم تحديد المجموعة، يا *${senderName}*!` + signature);
                    return;
                }
                if (await isBotAdmin(currentGroupId)) {
                    const chat = await client.getChatById(currentGroupId);
                    if (chat.isReadOnly) {
                        await message.reply(`🌙 المجموعة مغلقة بالفعل، يا *${senderName}*.` + signature);
                    } else {
                        await chat.setMessagesAdminsOnly(true);
                        await message.reply(`🚫 تم إغلاق المجموعة، يا *${senderName}*!` + signature);
                    }
                } else {
                    await message.reply(`⚠️ البوت ليس مشرفًا، يا *${senderName}*!` + signature);
                }
                return;
            }
            if (content === 'فتح المجموعة') {
                if (!currentGroupId) {
                    await message.reply(`⚠️ لم يتم تحديد المجموعة، يا *${senderName}*!` + signature);
                    return;
                }
                if (await isBotAdmin(currentGroupId)) {
                    const chat = await client.getChatById(currentGroupId);
                    if (!chat.isReadOnly) {
                        await message.reply(`☀️ المجموعة مفتوحة بالفعل، يا *${senderName}*.` + signature);
                    } else {
                        await chat.setMessagesAdminsOnly(false);
                        await message.reply(`✅ تم فتح المجموعة، يا *${senderName}*!` + signature);
                    }
                } else {
                    await message.reply(`⚠️ البوت ليس مشرفًا، يا *${senderName}*!` + signature);
                }
                return;
            }
            if (content === 'عرض المحاضرات' || content === 'pdf') {
                const lectures = Object.keys(metadata);
                if (lectures.length === 0) {
                    await message.reply(`📂 لا توجد محاضرات حاليًا، يا *${senderName}*.` + signature);
                    return;
                }
                let lectureList = `📚 *قائمة المحاضرات المتاحة:*\n`;
                lectures.forEach((key, index) => {
                    const lecture = metadata[key];
                    lectureList += `${index + 1}. ${lecture.name} (${lecture.type})\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة، يا *${senderName}*!`;

                userState.set(userId, { step: 'select_lecture', lectures });
                await message.reply(lectureList + signature);
                return;
            }
        }

        // أوامر المجموعة
        if (isGroupMessage && currentGroupId) {
            const chat = await client.getChatById(currentGroupId);
            const isGroupClosed = chat.isReadOnly;
            if (isGroupClosed && !(await isAdmin(userId, currentGroupId))) {
                console.log(`[🚫] تجاهل رسالة من ${senderName} لأن المجموعة مغلقة.`);
                return;
            }

            if (content === 'id' || content === 'معرف') {
                await message.reply(`🆔 معرف المجموعة: ${currentGroupId}` + signature);
                return;
            }

            if (content === 'الأوامر' || content === '!help') {
                const commandsList = `
🌟 *مرحبًا بك في بوت المحاضرات!* 🌟
إليك الأوامر السحرية لإدارة المحاضرات بسهولة:

🆔 *id* أو *معرف*: اعرف معرف المجموعة الحالية (مفيد للمشرفين).
📚 *عرض المحاضرات*: اعرض قائمة كل المحاضرات (PDF وصور) واختر واحدة ليتم إرسالها لك في الخاص.
📎 *إضافة PDF*: أضف ملف PDF جديد للأرشيف مع تفاصيل (مادة، فوج، إلخ). مثال: اكتب "إضافة PDF" واتبع التعليمات!
📸 *إضافة صور*: أضف صور محاضرة (كألبوم أو منفصلة) لتُخزن كألبوم مرتب. مثال: اكتب "إضافة صور".
🔍 *البحث عن محاضرة*: ابحث عن محاضرة بكلمة (مثل "رياضيات") واختر من النتائج.
📊 *الإحصائيات*: اعرف عدد المحاضرات وحالة المجموعة والطلبات.

💡 *نصيحة*: استخدم "تراجع" لإلغاء أي عملية. إذا كنت مشرفًا، جرب "إغلاق المجموعة" أو "فتح المجموعة"!
${signature}`;
                await message.reply(commandsList);
                return;
            }

            if (content === 'عرض المحاضرات' || content === 'pdf') {
                const lectures = Object.keys(metadata);
                if (lectures.length === 0) {
                    await message.reply(`📂 لا توجد محاضرات حاليًا، يا *${senderName}*.` + signature);
                    return;
                }
                let lectureList = `📚 *قائمة المحاضرات المتاحة:*\n`;
                lectures.forEach((key, index) => {
                    const lecture = metadata[key];
                    lectureList += `${index + 1}. ${lecture.name} (${lecture.type})\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة، يا *${senderName}*!`;

                userState.set(userId, { step: 'select_lecture', lectures });
                await message.reply(lectureList + signature);
                return;
            }

            if (content === 'إضافة pdf') {
                userState.set(userId, { step: 'add_pdf_subject' });
                await message.reply(`📎 *إضافة ملف PDF جديد!*\n📌 أدخل اسم المادة (مثل: رياضيات)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }

            if (content === 'إضافة صور') {
                userState.set(userId, { step: 'add_images_subject', images: [] });
                await message.reply(`📸 *إضافة صور محاضرة!*\n📌 أدخل اسم المادة (مثل: رياضيات)\n💡 اكتب 'تراجع' للإلغاء.` + signature);
                return;
            }

            if (content === 'البحث عن محاضرة') {
                userState.set(userId, { step: 'search_lecture' });
                await message.reply(`🔍 أدخل كلمة للبحث (مثل: رياضيات)، يا *${senderName}*!` + signature);
                return;
            }

            if (content === 'الإحصائيات') {
                const lectures = Object.keys(metadata);
                const statsMessage = `
📊 *إحصائيات البوت:*
- 🗂️ *عدد المحاضرات*: ${lectures.length}
- 📥 *عدد الطلبات*: ${requestCount}
- 🚪 *حالة المجموعة*: ${chat.isReadOnly ? 'مغلقة 🚫' : 'مفتوحة ✅'}
${signature}`;
                await message.reply(statsMessage);
                return;
            }
        }

    } catch (error) {
        console.error(`❌ خطأ في معالجة الرسالة من ${message.from}:`, error);
        await message.reply(`⚠️ حدث خطأ، يا *${senderName}*! حاول لاحقًا.` + signature);
    }
});

client.initialize()
    .then(() => console.log('🚀 تم تشغيل البوت بنجاح!'))
    .catch(err => console.error('❌ خطأ أثناء التشغيل:', err));