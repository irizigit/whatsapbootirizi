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
let groupId = null;
let requestCount = 0;

const lecturesDir = 'C:\\Users\\IRIZI\\Desktop\\wha';
const metadataPath = path.join(lecturesDir, 'metadata.json');
const signature = "\n\n👨‍💻 *dev by: IRIZI 😊*";
const allowedUser = '212621957775@c.us';

// إذا ما كان موجود، أنشئ ملف metadata
if (!fs.existsSync(metadataPath)) fs.writeFileSync(metadataPath, JSON.stringify({}));

// تحميل البيانات الوصفية
function loadMetadata() {
    return JSON.parse(fs.readFileSync(metadataPath));
}

// حفظ البيانات الوصفية
function saveMetadata(data) {
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
}

// دالة لإرسال إشعار للمشرفين
async function notifyAdmins(groupId, text) {
    try {
        const chat = await client.getChatById(groupId);
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        for (const admin of admins) {
            await client.sendMessage(admin.id._serialized, text);
        }
    } catch (error) {
        console.error('❌ خطأ أثناء إرسال إشعار للمشرفين:', error);
    }
}

// دالة للحصول على اسم ملف فريد
function getUniqueFilename(basePath, filename) {
    let newFilename = filename;
    let counter = 1;
    const ext = path.extname(filename).toLowerCase() || '.pdf';
    const nameWithoutExt = path.basename(filename, ext);

    while (fs.existsSync(path.join(basePath, newFilename))) {
        newFilename = `${nameWithoutExt}_${counter}${ext}`;
        counter++;
    }
    return newFilename;
}

client.on('qr', qr => {
    console.log('📸 امسح رمز QR لتسجيل الدخول:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ العميل جاهز ومتصل!');
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup);
        if (group) {
            groupId = group.id._serialized;
            console.log(`[ℹ️] تم تحديد المجموعة الافتراضية: ${groupId}`);
        } else {
            console.log('[⚠️] لم يتم العثور على أي مجموعة بعد.');
        }
    } catch (error) {
        console.error('❌ خطأ أثناء جلب المجموعات في حدث ready:', error);
    }
});

client.on('group_join', (notification) => {
    groupId = notification.chatId;
    console.log(`[📢] انضم البوت إلى المجموعة: ${groupId}`);
});

async function isAdmin(userId, groupId) {
    try {
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) return false;

        if (!chat.participants) {
            await chat.fetchParticipants();
        }

        const admins = chat.participants?.filter(p => p.isAdmin || p.isSuperAdmin) || [];
        return admins.some(admin => admin.id._serialized === userId);
    } catch (error) {
        console.error('❌ خطأ أثناء التحقق من حالة المشرف:', error);
        return false;
    }
}

async function isBotAdmin(groupId) {
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const admins = chat.participants?.filter(p => p.isAdmin || p.isSuperAdmin) || [];
        return admins.some(admin => admin.id._serialized === botId);
    } catch (error) {
        console.error('❌ خطأ أثناء التحقق من حالة البوت كمشرف:', error);
        return false;
    }
}

function getLecturesList() {
    return fs.readdirSync(lecturesDir).filter(file => file.toLowerCase().endsWith('.pdf'));
}

cron.schedule('0 22 * * *', async () => {
    if (!groupId) {
        console.log('[⚠️] لا يوجد groupId متاح لإغلاق المجموعة.');
        return;
    }
    try {
        const chat = await client.getChatById(groupId);
        if (await isBotAdmin(groupId)) {
            await chat.setMessagesAdminsOnly(true);
            await client.sendMessage(groupId, '🚫 تم إغلاق المجموعة تلقائيًا الساعة 10:00 مساءً.' + signature);
            console.log('[✅] تم إغلاق المجموعة بنجاح عبر cron.');
        } else {
            console.log('[⚠️] البوت ليس مشرفًا، لا يمكنه إغلاق المجموعة تلقائيًا.');
        }
    } catch (error) {
        console.error('[❌] خطأ أثناء إغلاق المجموعة عبر cron:', error);
    }
});

cron.schedule('0 8 * * *', async () => {
    if (!groupId) {
        console.log('[⚠️] لا يوجد groupId متاح لفتح المجموعة.');
        return;
    }
    try {
        const chat = await client.getChatById(groupId);
        if (await isBotAdmin(groupId)) {
            await chat.setMessagesAdminsOnly(false);
            await client.sendMessage(groupId, '✅ تم فتح المجموعة تلقائيًا الساعة 8:00 صباحًا.' + signature);
            console.log('[✅] تم فتح المجموعة بنجاح عبر cron.');
        } else {
            console.log('[⚠️] البوت ليس مشرفًا، لا يمكنه فتح المجموعة تلقائيًا.');
        }
    } catch (error) {
        console.error('[❌] خطأ أثناء فتح المجموعة عبر cron:', error);
    }
});

client.on('message_create', async message => {
    try {
        const userId = message.from.includes('@g.us') ? message.author : message.from;
        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || "مستخدم";
        const content = message.body.trim();
        const isGroupMessage = message.from.includes('@g.us');
        const currentGroupId = isGroupMessage ? message.from : groupId;

        console.log(`[📩] رسالة من ${senderName} (${userId}): ${content}, حالة المجموعة في WhatsApp: ${currentGroupId ? ((await client.getChatById(currentGroupId)).isReadOnly ? 'مغلقة' : 'مفتوحة') : 'غير محددة'}`);

        const metadata = loadMetadata();
// ... (الأجزاء الأخرى من الكود تبقى كما هي)

// إضافة المحاضرة خطوة بخطوة
if (userState.has(userId) && userState.get(userId).step.startsWith('add_lecture_')) {
    const state = userState.get(userId);

    // التحقق من أمر التراجع في كل خطوة
    if (content.toLowerCase() === 'تراجع') {
        await message.reply(`✅ تم إلغاء عملية الإضافة، يا ${senderName}! يمكنك البدء من جديد بكتابة 'إضافة محاضرة'.` + signature);
        userState.delete(userId);
        return;
    }
    
    if (state.step === 'add_lecture_subject') {
        state.subject = content;
        userState.set(userId, { ...state, step: 'add_lecture_group' });
        await message.reply(`✅ تم حفظ اسم المادة: *${content}*\n📌 الرجاء إدخال رقم الفوج أو الأفواج (مثال: 1 أو 1,2,3)\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
        return;
    }
    
    if (state.step === 'add_lecture_group') {
        state.group = content;
        userState.set(userId, { ...state, step: 'add_lecture_number' });
        await message.reply(`✅ تم حفظ اسم المادة: *${state.subject}*\n✅ تم حفظ رقم الفوج: *${content}*\n📌 الرجاء إدخال رقم المحاضرة (مثال: 1)\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
        return;
    }
    
    if (state.step === 'add_lecture_number') {
        state.number = content;
        userState.set(userId, { ...state, step: 'add_lecture_professor' });
        await message.reply(`✅ تم حفظ اسم المادة: *${state.subject}*\n✅ تم حفظ رقم الفوج: *${state.group}*\n✅ تم حفظ رقم المحاضرة: *${content}*\n📌 الرجاء إدخال اسم الأستاذ\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
        return;
    }
    
    if (state.step === 'add_lecture_professor') {
        state.professor = content;
        userState.set(userId, { ...state, step: 'add_lecture_file' });
        await message.reply(`✅ تم حفظ اسم المادة: *${state.subject}*\n✅ تم حفظ رقم الفوج: *${state.group}*\n✅ تم حفظ رقم المحاضرة: *${state.number}*\n✅ تم حفظ اسم الأستاذ: *${content}*\n📎 أرفق ملف PDF واكتب تعليقًا ينتهي بـ .pdf (مثال: 'book.pdf')\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
        return;
    }
    
    if (state.step === 'add_lecture_file') {
        if (!message.hasMedia) {
            await message.reply(`✅ تم حفظ اسم المادة: *${state.subject}*\n✅ تم حفظ رقم الفوج: *${state.group}*\n✅ تم حفظ رقم المحاضرة: *${state.number}*\n✅ تم حفظ اسم الأستاذ: *${state.professor}*\n❌ لم ترسل ملفًا، يا ${senderName}! أرفق ملف PDF واكتب تعليقًا ينتهي بـ .pdf (مثال: 'book.pdf')\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
            return;
        }

        if (message.type !== 'document') {
            await message.reply(`✅ تم حفظ اسم المادة: *${state.subject}*\n✅ تم حفظ رقم الفوج: *${state.group}*\n✅ تم حفظ رقم المحاضرة: *${state.number}*\n✅ تم حفظ اسم الأستاذ: *${state.professor}*\n❌ لم ترسل مستندًا، يا ${senderName}! أرفق ملف PDF صالح\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
            return;
        }

        // تحسين التحقق من صيغة PDF
        const isPdf = message.mimetype ? message.mimetype.includes('application/pdf') : content.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            await message.reply(`✅ تم حفظ اسم المادة: *${state.subject}*\n✅ تم حفظ رقم الفوج: *${state.group}*\n✅ تم حفظ رقم المحاضرة: *${state.number}*\n✅ تم حفظ اسم الأستاذ: *${state.professor}*\n❌ الملف ليس بصيغة PDF، يا ${senderName}! أرفق ملف PDF صالح\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
            return;
        }

        if (!content.toLowerCase().endsWith('.pdf')) {
            await message.reply(`✅ تم حفظ اسم المادة: *${state.subject}*\n✅ تم حفظ رقم الفوج: *${state.group}*\n✅ تم حفظ رقم المحاضرة: *${state.number}*\n✅ تم حفظ اسم الأستاذ: *${state.professor}*\n❌ التعليق يجب أن ينتهي بـ .pdf، يا ${senderName}! اكتب تعليقًا مثل 'book.pdf' مع الملف\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
            return;
        }

        const filename = content;
        const uniqueFilename = getUniqueFilename(lecturesDir, filename);
        const filePath = path.join(lecturesDir, uniqueFilename);

        const media = await message.downloadMedia();
        fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

        metadata[uniqueFilename] = {
            name: uniqueFilename,
            subject: state.subject,
            group: state.group,
            number: state.number,
            professor: state.professor,
            category: state.subject
        };
        saveMetadata(metadata);

        const summary = `
✅ *تمت إضافة المحاضرة بنجاح!*
📚 *تفاصيل المحاضرة:*
- المادة: ${state.subject}
- الفوج: ${state.group}
- رقم المحاضرة: ${state.number}
- الأستاذ: ${state.professor}
- اسم الملف: ${uniqueFilename}
🙏 شكراً لمساهمتك القيمة، يا ${senderName}! ${signature}`;

        await message.reply(summary);
        await notifyAdmins(currentGroupId, `📢 تمت إضافة محاضرة جديدة: *${uniqueFilename}* بواسطة ${senderName}`);
        userState.delete(userId);
        return;
    }
}

// ... (باقي الكود يبقى بدون تغيير)

        // التحكم في المجموعة من المحادثة الخاصة للمستخدم المسموح له
        if (!isGroupMessage && userId === allowedUser) {
            if (content.toLowerCase() === 'إغلاق المجموعة') {
                if (!currentGroupId) {
                    await message.reply(`⚠️ لم يتم تحديد المجموعة بعد، يا ${senderName}!` + signature);
                    return;
                }
                if (await isBotAdmin(currentGroupId)) {
                    const chat = await client.getChatById(currentGroupId);
                    if (chat.isReadOnly) {
                        await message.reply(`⚠️ المجموعة مغلقة بالفعل، يا ${senderName}.` + signature);
                    } else {
                        await chat.setMessagesAdminsOnly(true);
                        await message.reply(`🚫 تم إغلاق المجموعة بواسطة ${senderName}!` + signature);
                    }
                } else {
                    await message.reply(`⚠️ أنا لست مشرفًا في المجموعة، يا ${senderName}!` + signature);
                }
                return;
            }

            if (content.toLowerCase() === 'فتح المجموعة') {
                if (!currentGroupId) {
                    await message.reply(`⚠️ لم يتم تحديد المجموعة بعد، يا ${senderName}!` + signature);
                    return;
                }
                if (await isBotAdmin(currentGroupId)) {
                    const chat = await client.getChatById(currentGroupId);
                    if (!chat.isReadOnly) {
                        await message.reply(`⚠️ المجموعة مفتوحة بالفعل، يا ${senderName}.` + signature);
                    } else {
                        await chat.setMessagesAdminsOnly(false);
                        await message.reply(`✅ تم فتح المجموعة بواسطة ${senderName}!` + signature);
                    }
                } else {
                    await message.reply(`⚠️ أنا لست مشرفًا في المجموعة، يا ${senderName}!` + signature);
                }
                return;
            }

            if (content.toLowerCase() === 'pdf') {
                const lectures = getLecturesList();
                if (lectures.length === 0) {
                    await message.reply(`📂 لا توجد محاضرات حالياً، يا ${senderName}.` + signature);
                    return;
                }

                let lectureList = '📚 قائمة المحاضرات:\n';
                lectures.forEach((lecture, index) => {
                    const title = metadata[lecture]?.name || lecture;
                    lectureList += `${index + 1}. ${title} (${metadata[lecture]?.subject || 'عام'})\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة اللي تبيها يا ${senderName} (مثال: 1)`;

                userState.set(userId, { step: 'select_lecture', lectures });
                await message.reply(lectureList + signature);
                return;
            }
        }

        // باقي الوظائف (تعمل داخل المجموعة فقط)
        if (isGroupMessage && currentGroupId) {
            const chat = await client.getChatById(currentGroupId);
            const isGroupClosed = chat.isReadOnly;
            if (isGroupClosed) {
                const isUserAdmin = await isAdmin(userId, currentGroupId);
                const allowedCommands = ['إغلاق المجموعة', 'فتح المجموعة'];

                if (!allowedCommands.includes(content.toLowerCase()) || !isUserAdmin) {
                    console.log(`[🚫] تجاهل رسالة من ${senderName} لأن المجموعة مغلقة وليس لديه صلاحية.`);
                    return;
                }
            }

            if (content.toLowerCase() === 'الأوامر' || content.toLowerCase() === '!help') {
                const commandsList = `
📋 *قائمة الأوامر:*
- اكتب 'عرض المحاضرات' لعرض قائمة المحاضرات المتوفرة.
- اكتب 'إضافة محاضرة' لإضافة محاضرة جديدة.
- اكتب 'البحث عن محاضرة' للبحث عن محاضرة معينة.
- اكتب 'الإحصائيات' لعرض إحصائيات البوت.
${signature}`;
                await message.reply(commandsList);
                return;
            }

            if (content.toLowerCase() === 'عرض المحاضرات' || content.toLowerCase() === 'pdf') {
                const lectures = getLecturesList();
                if (lectures.length === 0) {
                    await message.reply(`📂 لا توجد محاضرات حالياً، يا ${senderName}.` + signature);
                    return;
                }

                let lectureList = '📚 قائمة المحاضرات:\n';
                lectures.forEach((lecture, index) => {
                    const title = metadata[lecture]?.name || lecture;
                    lectureList += `${index + 1}. ${title} (${metadata[lecture]?.subject || 'عام'})\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة اللي تبيها يا ${senderName} (مثال: 1)`;

                userState.set(userId, { step: 'select_lecture', lectures });
                await message.reply(lectureList + signature);
                return;
            }

            if (content.toLowerCase() === 'إضافة محاضرة') {
                userState.set(userId, { step: 'add_lecture_subject' });
                await message.reply(`📌 الرجاء إرسال اسم المادة التي تريد إضافتها (مثال: رياضيات)\n💡 اكتب 'تراجع' لإلغاء العملية.` + signature);
                return;
            }

            if (content.toLowerCase() === 'البحث عن محاضرة') {
                userState.set(userId, { step: 'search_lecture' });
                await message.reply(`🔍 أرسل كلمة للبحث عن محاضرة (مثال: رياضيات)` + signature);
                return;
            }

            if (content.toLowerCase() === 'الإحصائيات') {
                const lectures = getLecturesList();
                const chat = await client.getChatById(currentGroupId);
                const statsMessage = `
📊 *إحصائيات البوت:*
- عدد المحاضرات: ${lectures.length}
- عدد الطلبات: ${requestCount}
- حالة المجموعة: ${chat.isReadOnly ? 'مغلقة 🚫' : 'مفتوحة ✅'}
${signature}`;
                await message.reply(statsMessage);
                return;
            }

            if (userState.has(userId)) {
                const state = userState.get(userId);
                if (state.step === 'select_lecture') {
                    const lectureIndex = parseInt(content) - 1;
                    if (lectureIndex >= 0 && lectureIndex < state.lectures.length) {
                        const selectedLecture = state.lectures[lectureIndex];
                        const pdfPath = path.join(lecturesDir, selectedLecture);

                        if (!fs.existsSync(pdfPath)) {
                            await message.reply(`❌ الملف غير موجود، يا ${senderName}.` + signature);
                            userState.delete(userId);
                            return;
                        }

                        try {
                            const media = MessageMedia.fromFilePath(pdfPath);
                            if (!media) throw new Error('فشل في تحميل الملف كوسائط');
                            requestCount++;
                            const lectureInfo = metadata[selectedLecture] || {};
                            await client.sendMessage(userId, media, {
                                caption: `📎 المحاضرة: ${lectureInfo.name || selectedLecture}
📚 المادة: ${lectureInfo.subject || 'عام'}
👥 الفوج: ${lectureInfo.group || '-'}
🔢 رقم المحاضرة: ${lectureInfo.number || '-'}
👨‍🏫 الأستاذ: ${lectureInfo.professor || '-'}${signature}`
                            });
                            userState.delete(userId);
                        } catch (error) {
                            console.error(`❌ خطأ أثناء إرسال الملف ${selectedLecture} لـ ${senderName} (${userId}):`, error);
                            await message.reply(`❌ الملف غير متاح حاليًا، يا ${senderName}! حاول لاحقًا.` + signature);
                            userState.delete(userId);
                        }
                    } else {
                        await message.reply(`⚠️ رقم غير صحيح يا ${senderName}! حاول مرة ثانية.` + signature);
                    }
                    return;
                }

                if (state.step === 'search_lecture') {
                    const query = content.toLowerCase();
                    const lectures = getLecturesList();
                    const filteredLectures = lectures.filter(lecture =>
                        metadata[lecture]?.name.toLowerCase().includes(query) ||
                        metadata[lecture]?.subject.toLowerCase().includes(query) ||
                        metadata[lecture]?.professor.toLowerCase().includes(query)
                    );

                    if (filteredLectures.length === 0) {
                        await message.reply(`📂 لم يتم العثور على محاضرات مطابقة لـ *${query}*، يا ${senderName}.` + signature);
                        userState.delete(userId);
                        return;
                    }

                    let lectureList = `📚 نتائج البحث عن *${query}*:\n`;
                    filteredLectures.forEach((lecture, index) => {
                        const title = metadata[lecture]?.name || lecture;
                        lectureList += `${index + 1}. ${title} (${metadata[lecture]?.subject || 'عام'})\n`;
                    });
                    lectureList += `\n✉️ أرسل رقم المحاضرة اللي تبيها يا ${senderName} (مثال: 1)`;

                    userState.set(userId, { step: 'select_lecture', lectures: filteredLectures });
                    await message.reply(lectureList + signature);
                    return;
                }
            }
        }

    } catch (error) {
        console.error(`❌ خطأ في معالجة الرسالة من ${message.from}:`, error);
        const userId = message.from.includes('@g.us') ? message.author : message.from;
        await message.reply(`⚠️ حدث خطأ، حاول مرة أخرى لاحقًا! ${signature}`);
    }
});

client.initialize()
    .then(() => console.log('🚀 تم تشغيل البوت بنجاح!'))
    .catch(err => console.error('❌ خطأ أثناء التشغيل:', err));