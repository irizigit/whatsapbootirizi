const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const client = new Client({ 
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Bot state and data
const userState = new Map();
const groupsMetadata = new Map();
const blacklist = new Set();
const admins = new Set(['212715104027@c.us']);
const lectureStats = new Map();
const joinStats = new Map();
const leaveStats = new Map();
const messageStats = new Map();

let groupId = null;
let requestCount = 0;
const PDF_ARCHIVE_GROUP = '120363398139579320@g.us';
const IMAGES_ARCHIVE_GROUP = '120363400468776166@g.us';
const OWNER_ID = '212715104027@c.us';
const PROTECTION_PASSWORD = 'your_secure_password'; // Replace with actual password

let lecturesMetadata = [];
const lecturesFile = './lectures.json';
const lecturesDir = './lectures/';
const statsFile = './stats.json';
const blacklistFile = './blacklist.json';

if (!fs.existsSync(lecturesDir)) {
    fs.mkdirSync(lecturesDir);
}

// Load data from files
function loadLectures() {
    try {
        if (fs.existsSync(lecturesFile)) {
            const data = fs.readFileSync(lecturesFile, 'utf8');
            lecturesMetadata = data ? JSON.parse(data) : [];
            console.log(`[📂] Loaded ${lecturesMetadata.length} lectures`);
        } else {
            lecturesMetadata = [];
            fs.writeFileSync(lecturesFile, JSON.stringify([]));
        }
    } catch (error) {
        console.error('[❌] Error loading lectures:', error);
        lecturesMetadata = [];
        fs.writeFileSync(lecturesFile, JSON.stringify([]));
    }
}

function loadStats() {
    try {
        if (fs.existsSync(statsFile)) {
            const data = fs.readFileSync(statsFile, 'utf8');
            const stats = data ? JSON.parse(data) : {};
            joinStats.clear();
            leaveStats.clear();
            messageStats.clear();
            lectureStats.clear();
            for (const [groupId, joins] of Object.entries(stats.joins || {})) {
                joinStats.set(groupId, joins);
            }
            for (const [groupId, leaves] of Object.entries(stats.leaves || {})) {
                leaveStats.set(groupId, leaves);
            }
            for (const [groupId, messages] of Object.entries(stats.messages || {})) {
                messageStats.set(groupId, messages);
            }
            for (const [userId, lectures] of Object.entries(stats.lectures || {})) {
                lectureStats.set(userId, lectures);
            }
            console.log(`[📊] Loaded stats`);
        }
    } catch (error) {
        console.error('[❌] Error loading stats:', error);
    }
}

function loadBlacklist() {
    try {
        if (fs.existsSync(blacklistFile)) {
            const data = fs.readFileSync(blacklistFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            blacklist.clear();
            list.forEach(num => blacklist.add(num));
            console.log(`[📛] Loaded ${blacklist.size} blacklisted numbers`);
        }
    } catch (error) {
        console.error('[❌] Error loading blacklist:', error);
    }
}

function saveLectures() {
    try {
        fs.writeFileSync(lecturesFile, JSON.stringify(lecturesMetadata, null, 2));
        console.log('[💾] Saved lectures');
    } catch (error) {
        console.error('[❌] Error saving lectures:', error);
    }
}

function saveStats() {
    try {
        const stats = {
            joins: Object.fromEntries(joinStats),
            leaves: Object.fromEntries(leaveStats),
            messages: Object.fromEntries(messageStats),
            lectures: Object.fromEntries(lectureStats)
        };
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        console.log('[💾] Saved stats');
    } catch (error) {
        console.error('[❌] Error saving stats:', error);
    }
}

function saveBlacklist() {
    try {
        fs.writeFileSync(blacklistFile, JSON.stringify([...blacklist]));
        console.log('[💾] Saved blacklist');
    } catch (error) {
        console.error('[❌] Error saving blacklist:', error);
    }
}

loadLectures();
loadStats();
loadBlacklist();

const signature = "\n👨‍💻 *dev by: IRIZI 😊*";

// Utility functions
async function notifyAllGroups(messageText) {
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        for (const group of groups) {
            if (await isBotAdmin(group.id._serialized)) {
                await client.sendMessage(group.id._serialized, messageText + signature);
                console.log(`[📢] Sent to group: ${group.id._serialized}`);
            }
        }
    } catch (error) {
        console.error('[❌] Error notifying groups:', error);
    }
}

async function notifyAdmins(groupId, text) {
    try {
        const chat = await client.getChatById(groupId);
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        for (const admin of admins) {
            await client.sendMessage(admin.id._serialized, `📢 *Admin Notification*\n${text}${signature}`);
        }
    } catch (error) {
        console.error('[❌] Error notifying admins:', error);
    }
}

async function isAdmin(userId, groupId) {
    try {
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) return false;
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return admins.some(admin => admin.id._serialized === userId);
    } catch (error) {
        console.error('[❌] Error checking admin status:', error);
        return false;
    }
}

async function isBotAdmin(groupId) {
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return admins.some(admin => admin.id._serialized === botId);
    } catch (error) {
        console.error('[❌] Error checking bot admin status:', error);
        return false;
    }
}

async function verifyGroup(groupId, groupName) {
    try {
        await client.getChatById(groupId);
        return true;
    } catch (error) {
        console.error(`[❌] Error: Group ${groupName} not found:`, error);
        return false;
    }
}

function formatPhoneNumber(number) {
    number = number.replace(/\D/g, '');
    if (!number.startsWith('+')) number = '+' + number;
    return number;
}

// Client events
client.on('qr', qr => {
    console.log('[📸] Scan QR code:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('[✅] Client ready!');
    try {
        const chats = await client.getChats();
        for (const chat of chats) {
            if (chat.isGroup) {
                groupsMetadata.set(chat.id._serialized, chat.name);
            }
        }
        console.log(`[ℹ️] Loaded ${groupsMetadata.size} groups`);
    } catch (error) {
        console.error('[❌] Error in ready event:', error);
    }
});

client.on('group_join', async (notification) => {
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    console.log(`[📢] User ${userId} joined ${groupId}`);
    if (blacklist.has(userId)) {
        if (await isBotAdmin(groupId)) {
            await client.removeParticipant(groupId, userId);
            console.log(`[📛] Removed blacklisted user ${userId}`);
        }
        return;
    }
    joinStats.set(groupId, joinStats.get(groupId) || []);
    joinStats.get(groupId).push({ userId, timestamp: Date.now() });
    saveStats();
});

client.on('group_leave', async (notification) => {
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    console.log(`[📢] User ${userId} left ${groupId}`);
    blacklist.add(userId);
    saveBlacklist();
    leaveStats.set(groupId, leaveStats.get(groupId) || []);
    leaveStats.get(groupId).push({ userId, timestamp: Date.now(), reason: 'left' });
    saveStats();
});

client.on('group_admin_changed', async (notification) => {
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    if (notification.type === 'remove' && userId === OWNER_ID) {
        if (await isBotAdmin(groupId)) {
            await client.addParticipant(groupId, OWNER_ID);
            await client.sendMessage(OWNER_ID, `⚠️ You were removed from ${groupId}!\n✅ Re-added you.${signature}`);
        }
    }
});

// Message handler
client.on('message_create', async message => {
    try {
        if (!message || !message.from) {
            console.log('[⚠️] Invalid message, ignoring.');
            return;
        }

        const userId = message.from.includes('@g.us') ? message.author : message.from;
        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || "User";
        const content = message.body && typeof message.body === 'string' ? message.body.trim() : '';
        const isGroupMessage = message.from.includes('@g.us');
        const currentGroupId = isGroupMessage ? message.from : groupId;
        const replyTo = isGroupMessage ? currentGroupId : userId;

        console.log(`[📩] Message from ${senderName} (${userId}): ${content || '[non-text]'}`);

        // Pin message command
        if (isGroupMessage && content === '!تثبيت' && message.hasQuotedMsg) {
            if (await isAdmin(userId, currentGroupId)) {
                if (await isBotAdmin(currentGroupId)) {
                    const quotedMsg = await message.getQuotedMessage();
                    await quotedMsg.pin();
                    await client.sendMessage(OWNER_ID, `✅ Pinned message in ${currentGroupId}${signature}`);
                } else {
                    await client.sendMessage(OWNER_ID, `⚠️ I'm not an admin in ${currentGroupId}!${signature}`);
                }
            }
            return;
        }

        // Admin panel
        if (!isGroupMessage && userId === OWNER_ID && content === '!إدارة') {
            await message.react('👨‍💻');
            await client.sendMessage(userId, `
👨‍💻 *لوحة الإدارة*
اختر العملية:
1. إضافة عضو/أعضاء
2. حذف عضو
3. ترقية عضو لمشرف
4. خفض مشرف
5. إضافة مبرمج
6. حذف مبرمج
7. تنظيف المجموعة
8. تثبيت رسالة
9. إحصائيات المجموعات
10. تحفيز المستخدمين
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
            userState.set(userId, { step: 'admin_menu' });
            return;
        }

        // Handle admin panel steps
        if (userState.has(userId) && userId === OWNER_ID) {
            const state = userState.get(userId);

            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                userState.delete(userId);
                return;
            }

            if (state.step === 'admin_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 10) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح! جرب تاني.${signature}`);
                    return;
                }

                if (option === 8) {
                    await message.react('📌');
                    await client.sendMessage(userId, `
📌 *تثبيت رسالة*
في المجموعة، اعمل ريبلي للرسالة اللي عايز تثبتها واكتب:
!تثبيت
💡 أرسل *إلغاء* لو غيرت رأيك${signature}`);
                    userState.delete(userId);
                    return;
                }

                if (option === 10) {
                    await message.react('🎉');
                    await client.sendMessage(userId, `✅ تم تفعيل التحفيز التلقائي!${signature}`);
                    userState.delete(userId);
                    return;
                }

                if (option === 9) {
                    await message.react('📊');
                    await client.sendMessage(userId, `
📊 *إحصائيات المجموعات*
اختر نوع الإحصائيات:
1. الأعضاء المنضمين
2. الأعضاء اللي غادروا/حُذفوا
3. نشاط الرسايل
4. المحاضرات المضافة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'stats_menu' });
                    return;
                }

                await message.react('📋');
                let groupList = `📋 *اختر المجموعة*\n`;
                let index = 1;
                for (const [id, name] of groupsMetadata) {
                    groupList += `${index}. ${name} (${id})\n`;
                    index++;
                }
                groupList += `💡 أرسل رقم المجموعة أو *إلغاء*${signature}`;
                await client.sendMessage(userId, groupList);
                userState.set(userId, { step: `admin_option_${option}_select_group` });
                return;
            }

            if (state.step.startsWith('admin_option_')) {
                const groups = Array.from(groupsMetadata.keys());
                const groupIndex = parseInt(content) - 1;
                if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groups.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم مجموعة غير صحيح!${signature}`);
                    return;
                }
                const selectedGroupId = groups[groupIndex];

                if (state.step === 'admin_option_1_select_group') {
                    await message.react('📥');
                    await client.sendMessage(userId, `
📥 *إضافة عضو/أعضاء إلى ${groupsMetadata.get(selectedGroupId)}*
أرسل أرقام الجوال (مثل: +1234567890,+0987654321)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'add_members', groupId: selectedGroupId });
                    return;
                }

                if (state.step === 'admin_option_2_select_group') {
                    await message.react('🗑️');
                    await client.sendMessage(userId, `
🗑️ *حذف عضو من ${groupsMetadata.get(selectedGroupId)}*
أرسل رقم الجوال (مثل: +9876543210)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'remove_member', groupId: selectedGroupId });
                    return;
                }

                if (state.step === 'admin_option_3_select_group') {
                    await message.react('➕');
                    await client.sendMessage(userId, `
➕ *ترقية عضو في ${groupsMetadata.get(selectedGroupId)}*
أرسل رقم الجوال (مثل: +1112223333)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'promote_admin', groupId: selectedGroupId });
                    return;
                }

                if (state.step === 'admin_option_4_select_group') {
                    await message.react('➖');
                    await client.sendMessage(userId, `
➖ *خفض مشرف في ${groupsMetadata.get(selectedGroupId)}*
أرسل رقم الجوال (مثل: +9876543210)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'demote_admin', groupId: selectedGroupId });
                    return;
                }

                if (state.step === 'admin_option_7_select_group') {
                    await message.react('🧹');
                    await client.sendMessage(userId, `
🧹 *تنظيف ${groupsMetadata.get(selectedGroupId)}*
إزالة الأعضاء غير النشطين منذ متى؟
1. 12 ساعة
2. 24 ساعة
3. 3 أيام
4. 7 أيام
5. مخصص (أدخل عدد الساعات)
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'clean_group_duration', groupId: selectedGroupId });
                    return;
                }
            }

            if (state.step === 'add_members') {
                const numbers = content.split(',').map(num => formatPhoneNumber(num.trim()));
                if (numbers.some(num => !/^\+\d+$/.test(num))) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ أرقام غير صحيحة!${signature}`);
                    return;
                }
                if (!(await isBotAdmin(state.groupId))) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ أنا مش مشرف في المجموعة!${signature}`);
                    userState.delete(userId);
                    return;
                }
                let added = [];
                let failed = [];
                for (const number of numbers) {
                    const formatted = number + '@c.us';
                    if (blacklist.has(formatted)) {
                        failed.push(`${number} (في القايمة السوداء)`);
                        continue;
                    }
                    try {
                        await client.addParticipant(state.groupId, formatted);
                        added.push(number);
                    } catch (error) {
                        failed.push(`${number} (خطأ)`);
                    }
                }
                await message.react('✅');
                let response = `✅ *تمت الإضافة!*\n`;
                if (added.length) response += `📥 أضيفوا: ${added.join(', ')}\n`;
                if (failed.length) response += `⚠️ فشل: ${failed.join(', ')}\n`;
                response += `📊 عدد الأعضاء: ${(await client.getChatById(state.groupId)).participants.length}${signature}`;
                await client.sendMessage(userId, response);
                userState.delete(userId);
                return;
            }

            if (state.step === 'remove_member') {
                const number = formatPhoneNumber(content);
                if (!/^\+\d+$/.test(number)) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم غير صحيح!${signature}`);
                    return;
                }
                if (!(await isBotAdmin(state.groupId))) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ أنا مش مشرف في المجموعة!${signature}`);
                    userState.delete(userId);
                    return;
                }
                const formatted = number + '@c.us';
                try {
                    await client.removeParticipant(state.groupId, formatted);
                    blacklist.add(formatted);
                    saveBlacklist();
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ تم حذف ${number}!
📊 عدد الأعضاء: ${(await client.getChatById(state.groupId)).participants.length}
📛 أضيف للقايمة السوداء${signature}`);
                } catch (error) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خطأ: ${number} مش موجود!${signature}`);
                }
                userState.delete(userId);
                return;
            }

            if (state.step === 'promote_admin') {
                const number = formatPhoneNumber(content);
                if (!/^\+\d+$/.test(number)) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم غير صحيح!${signature}`);
                    return;
                }
                if (!(await isBotAdmin(state.groupId))) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ أنا مش مشرف في المجموعة!${signature}`);
                    userState.delete(userId);
                    return;
                }
                const formatted = number + '@c.us';
                try {
                    await client.promoteParticipants(state.groupId, [formatted]);
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ تم ترقية ${number} لمشرف!
👑 عدد المشرفين: ${(await client.getChatById(state.groupId)).participants.filter(p => p.isAdmin).length}${signature}`);
                } catch (error) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خطأ: ${number} مش موجود!${signature}`);
                }
                userState.delete(userId);
                return;
            }

            if (state.step === 'demote_admin') {
                const number = formatPhoneNumber(content);
                if (!/^\+\d+$/.test(number)) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم غير صحيح!${signature}`);
                    return;
                }
                if (!(await isBotAdmin(state.groupId))) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ أنا مش مشرف في المجموعة!${signature}`);
                    userState.delete(userId);
                    return;
                }
                const formatted = number + '@c.us';
                try {
                    await client.demoteParticipants(state.groupId, [formatted]);
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ تم خفض ${number} من مشرف!
👑 عدد المشرفين: ${(await client.getChatById(state.groupId)).participants.filter(p => p.isAdmin).length}${signature}`);
                } catch (error) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خطأ: ${number} مش مشرف!${signature}`);
                }
                userState.delete(userId);
                return;
            }

            if (state.step === 'admin_option_5_select_group') {
                await message.react('👨‍💻');
                await client.sendMessage(userId, `
👨‍💻 *إضافة مبرمج*
أرسل رقم الجوال (مثل: +2223334444)
💡 أرسل *إلغاء*${signature}`);
                userState.set(userId, { step: 'add_programmer' });
                return;
            }

            if (state.step === 'add_programmer') {
                const number = formatPhoneNumber(content);
                if (!/^\+\d+$/.test(number)) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم غير صحيح!${signature}`);
                    return;
                }
                const formatted = number + '@c.us';
                if (admins.has(formatted)) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ ${number} مبرمج بالفعل!${signature}`);
                    userState.delete(userId);
                    return;
                }
                await client.sendMessage(userId, `
📢 تأكيد: إضافة ${number} كمبرمج؟
أرسل *نعم* أو *لا*${signature}`);
                userState.set(userId, { step: 'confirm_add_programmer', number: formatted });
                return;
            }

            if (state.step === 'confirm_add_programmer') {
                if (content.toLowerCase() === 'نعم') {
                    admins.add(state.number);
                    await message.react('✅');
                    await client.sendMessage(userId, `✅ تم إضافة ${state.number} كمبرمج!${signature}`);
                } else {
                    await message.react('❌');
                    await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                }
                userState.delete(userId);
                return;
            }

            if (state.step === 'admin_option_6_select_group') {
                await message.react('👨‍💻');
                let adminList = `👨‍💻 *حذف مبرمج*\n`;
                let index = 1;
                for (const admin of admins) {
                    adminList += `${index}. ${admin}\n`;
                    index++;
                }
                adminList += `💡 أرسل رقم المبرمج أو *إلغاء*${signature}`;
                await client.sendMessage(userId, adminList);
                userState.set(userId, { step: 'remove_programmer' });
                return;
            }

            if (state.step === 'remove_programmer') {
                const adminIndex = parseInt(content) - 1;
                const adminList = Array.from(admins);
                if (isNaN(adminIndex) || adminIndex < 0 || adminIndex >= adminList.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم غير صحيح!${signature}`);
                    return;
                }
                const selectedAdmin = adminList[adminIndex];
                if (selectedAdmin === OWNER_ID) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ ما تقدرش تحذف نفسك!${signature}`);
                    return;
                }
                await client.sendMessage(userId, `
📢 تأكيد: حذف ${selectedAdmin} من المبرمجين؟
أرسل *نعم* أو *لا*${signature}`);
                userState.set(userId, { step: 'confirm_remove_programmer', admin: selectedAdmin });
                return;
            }

            if (state.step === 'confirm_remove_programmer') {
                if (content.toLowerCase() === 'نعم') {
                    admins.delete(state.admin);
                    await message.react('✅');
                    await client.sendMessage(userId, `✅ تم حذف ${state.admin}!${signature}`);
                } else {
                    await message.react('❌');
                    await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                }
                userState.delete(userId);
                return;
            }

            if (state.step === 'clean_group_duration') {
                const durations = {
                    '1': 12 * 60 * 60 * 1000,
                    '2': 24 * 60 * 60 * 1000,
                    '3': 3 * 24 * 60 * 60 * 1000,
                    '4': 7 * 24 * 60 * 60 * 1000
                };
                if (content === '5') {
                    await message.react('⏳');
                    await client.sendMessage(userId, `
⏳ أدخل عدد الساعات (مثل: 48)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'clean_group_custom_duration', groupId: state.groupId });
                    return;
                }
                if (!durations[content]) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                await client.sendMessage(userId, `
🕒 *متى تريد التنظيف؟*
1. الآن
2. بعد ساعة
3. بعد 6 ساعات
4. مخصص (أدخل الساعات)
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                userState.set(userId, { step: 'clean_group_schedule', groupId: state.groupId, duration: durations[content] });
                return;
            }

            if (state.step === 'clean_group_custom_duration') {
                const hours = parseInt(content);
                if (isNaN(hours) || hours <= 0) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ عدد ساعات غير صحيح!${signature}`);
                    return;
                }
                await client.sendMessage(userId, `
🕒 *متى تريد التنظيف؟*
1. الآن
2. بعد ساعة
3. بعد 6 ساعات
4. مخصص (أدخل الساعات)
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                userState.set(userId, { step: 'clean_group_schedule', groupId: state.groupId, duration: hours * 60 * 60 * 1000 });
                return;
            }

            if (state.step === 'clean_group_schedule') {
                const schedules = {
                    '1': 0,
                    '2': 1 * 60 * 60 * 1000,
                    '3': 6 * 60 * 60 * 1000
                };
                if (content === '4') {
                    await message.react('⏳');
                    await client.sendMessage(userId, `
⏳ أدخل عدد الساعات (مثل: 2)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'clean_group_custom_schedule', groupId: state.groupId, duration: state.duration });
                    return;
                }
                if (!schedules[content]) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                await client.sendMessage(userId, `
📢 تأكيد: إزالة الأعضاء اللي ما أرسلوش منذ ${(state.duration / (60 * 60 * 1000))} ساعة؟
أرسل *نعم* أو *لا*${signature}`);
                userState.set(userId, { step: 'clean_group_confirm', groupId: state.groupId, duration: state.duration, schedule: schedules[content] });
                return;
            }

            if (state.step === 'clean_group_custom_schedule') {
                const hours = parseInt(content);
                if (isNaN(hours) || hours <= 0) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ عدد ساعات غير صحيح!${signature}`);
                    return;
                }
                await client.sendMessage(userId, `
📢 تأكيد: إزالة الأعضاء اللي ما أرسلوش منذ ${(state.duration / (60 * 60 * 1000))} ساعة؟
أرسل *نعم* أو *لا*${signature}`);
                userState.set(userId, { step: 'clean_group_confirm', groupId: state.groupId, duration: state.duration, schedule: hours * 60 * 60 * 1000 });
                return;
            }

            if (state.step === 'clean_group_confirm') {
                if (content.toLowerCase() === 'نعم') {
                    if (!(await isBotAdmin(state.groupId))) {
                        await message.react('⚠️');
                        await client.sendMessage(userId, `⚠️ أنا مش مشرف في المجموعة!${signature}`);
                        userState.delete(userId);
                        return;
                    }
                    setTimeout(async () => {
                        try {
                            const chat = await client.getChatById(state.groupId);
                            const participants = chat.participants.filter(p => !p.isAdmin);
                            const cutoff = Date.now() - state.duration;
                            let removed = [];
                            for (const participant of participants) {
                                const lastMessage = messageStats.get(state.groupId)?.[participant.id._serialized]?.lastMessage || 0;
                                if (lastMessage < cutoff) {
                                    await client.removeParticipant(state.groupId, participant.id._serialized);
                                    blacklist.add(participant.id._serialized);
                                    removed.push(participant.id._serialized);
                                }
                            }
                            saveBlacklist();
                            await client.sendMessage(userId, `
✅ تم تنظيف ${groupsMetadata.get(state.groupId)}!
🗑️ عدد المحذوفين: ${removed.length}
📛 المحذوفين في القايمة السوداء
📊 عدد الأعضاء: ${chat.participants.length}${signature}`);
                        } catch (error) {
                            await client.sendMessage(userId, `⚠️ خطأ أثناء التنظيف!${signature}`);
                        }
                    }, state.schedule);
                    await message.react('✅');
                    await client.sendMessage(userId, `✅ مجدول التنظيف بعد ${(state.schedule / (60 * 60 * 1000))} ساعة!${signature}`);
                } else {
                    await message.react('❌');
                    await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                }
                userState.delete(userId);
                return;
            }

            if (state.step === 'stats_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                let groupList = `📋 *اختر المجموعة*\n`;
                let index = 1;
                for (const [id, name] of groupsMetadata) {
                    groupList += `${index}. ${name} (${id})\n`;
                    index++;
                }
                groupList += `💡 أرسل رقم المجموعة أو *إلغاء*${signature}`;
                await client.sendMessage(userId, groupList);
                userState.set(userId, { step: `stats_option_${option}_select_group` });
                return;
            }

            if (state.step === 'stats_option_1_select_group') {
                const groups = Array.from(groupsMetadata.keys());
                const groupIndex = parseInt(content) - 1;
                if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groups.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم مجموعة غير صحيح!${signature}`);
                    return;
                }
                const selectedGroupId = groups[groupIndex];
                await message.react('⏳');
                await client.sendMessage(userId, `
⏳ *إحصائيات الأعضاء المنضمين*
اختر المدة:
1. آخر 3 ساعات
2. آخر 5 ساعات
3. آخر 24 ساعة
4. مخصص (أدخل عدد الساعات)
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                userState.set(userId, { step: 'stats_joins_duration', groupId: selectedGroupId });
                return;
            }

            if (state.step === 'stats_joins_duration') {
                const durations = {
                    '1': 3 * 60 * 60 * 1000,
                    '2': 5 * 60 * 60 * 1000,
                    '3': 24 * 60 * 60 * 1000
                };
                if (content === '4') {
                    await message.react('⏳');
                    await client.sendMessage(userId, `
⏳ أدخل عدد الساعات (مثل: 48)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'stats_joins_custom_duration', groupId: state.groupId });
                    return;
                }
                if (!durations[content]) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                const cutoff = Date.now() - durations[content];
                const joins = (joinStats.get(state.groupId) || []).filter(j => j.timestamp >= cutoff);
                let response = `📊 *الأعضاء المنضمين لـ ${groupsMetadata.get(state.groupId)} خلال ${(durations[content] / (60 * 60 * 1000))} ساعة*\n`;
                joins.forEach(j => {
                    response += `- ${j.userId} (انضم: ${new Date(j.timestamp).toLocaleString('ar-EG')})\n`;
                });
                response += `💡 إجمالي: ${joins.length}${signature}`;
                if (joins.length === 0) response = `⚠️ مافيش أعضاء انضموا!${signature}`;
                await message.react('✅');
                await client.sendMessage(userId, response);
                userState.delete(userId);
                return;
            }

            if (state.step === 'stats_joins_custom_duration') {
                const hours = parseInt(content);
                if (isNaN(hours) || hours <= 0) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ عدد ساعات غير صحيح!${signature}`);
                    return;
                }
                const cutoff = Date.now() - (hours * 60 * 60 * 1000);
                const joins = (joinStats.get(state.groupId) || []).filter(j => j.timestamp >= cutoff);
                let response = `📊 *الأعضاء المنضمين لـ ${groupsMetadata.get(state.groupId)} خلال ${hours} ساعة*\n`;
                joins.forEach(j => {
                    response += `- ${j.userId} (انضم: ${new Date(j.timestamp).toLocaleString('ar-EG')})\n`;
                });
                response += `💡 إجمالي: ${joins.length}${signature}`;
                if (joins.length === 0) response = `⚠️ مافيش أعضاء انضموا!${signature}`;
                await message.react('✅');
                await client.sendMessage(userId, response);
                userState.delete(userId);
                return;
            }

            if (state.step === 'stats_option_2_select_group') {
                const groups = Array.from(groupsMetadata.keys());
                const groupIndex = parseInt(content) - 1;
                if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groups.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم مجموعة غير صحيح!${signature}`);
                    return;
                }
                const selectedGroupId = groups[groupIndex];
                await message.react('⏳');
                await client.sendMessage(userId, `
⏳ *إحصائيات الأعضاء اللي غادروا/حُذفوا*
اختر المدة:
1. آخر 3 ساعات
2. آخر 5 ساعات
3. آخر 24 ساعة
4. مخصص (أدخل عدد الساعات)
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                userState.set(userId, { step: 'stats_leaves_duration', groupId: selectedGroupId });
                return;
            }

            if (state.step === 'stats_leaves_duration') {
                const durations = {
                    '1': 3 * 60 * 60 * 1000,
                    '2': 5 * 60 * 60 * 1000,
                    '3': 24 * 60 * 60 * 1000
                };
                if (content === '4') {
                    await message.react('⏳');
                    await client.sendMessage(userId, `
⏳ أدخل عدد الساعات (مثل: 48)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'stats_leaves_custom_duration', groupId: state.groupId });
                    return;
                }
                if (!durations[content]) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                const cutoff = Date.now() - durations[content];
                const leaves = (leaveStats.get(state.groupId) || []).filter(l => l.timestamp >= cutoff);
                let response = `📊 *الأعضاء اللي غادروا/حُذفوا من ${groupsMetadata.get(state.groupId)} خلال ${(durations[content] / (60 * 60 * 1000))} ساعة*\n`;
                leaves.forEach(l => {
                    response += `- ${l.userId} (${l.reason === 'left' ? 'غادر' : 'حُذف'}: ${new Date(l.timestamp).toLocaleString('ar-EG')})\n`;
                });
                response += `💡 إجمالي: ${leaves.length}\n📛 الكل في القايمة السوداء${signature}`;
                if (leaves.length === 0) response = `⚠️ مافيش أعضاء غادروا أو حُذفوا!${signature}`;
                await message.react('✅');
                await client.sendMessage(userId, response);
                userState.delete(userId);
                return;
            }

            if (state.step === 'stats_leaves_custom_duration') {
                const hours = parseInt(content);
                if (isNaN(hours) || hours <= 0) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ عدد ساعات غير صحيح!${signature}`);
                    return;
                }
                const cutoff = Date.now() - (hours * 60 * 60 * 1000);
                const leaves = (leaveStats.get(state.groupId) || []).filter(l => l.timestamp >= cutoff);
                let response = `📊 *الأعضاء اللي غادروا/حُذفوا من ${groupsMetadata.get(state.groupId)} خلال ${hours} ساعة*\n`;
                leaves.forEach(l => {
                    response += `- ${l.userId} (${l.reason === 'left' ? 'غادر' : 'حُذف'}: ${new Date(l.timestamp).toLocaleString('ar-EG')})\n`;
                });
                response += `💡 إجمالي: ${leaves.length}\n📛 الكل في القايمة السوداء${signature}`;
                if (leaves.length === 0) response = `⚠️ مافيش أعضاء غادروا أو حُذفوا!${signature}`;
                await message.react('✅');
                await client.sendMessage(userId, response);
                userState.delete(userId);
                return;
            }

            if (state.step === 'stats_option_3_select_group') {
                const groups = Array.from(groupsMetadata.keys());
                const groupIndex = parseInt(content) - 1;
                if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groups.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم مجموعة غير صحيح!${signature}`);
                    return;
                }
                const selectedGroupId = groups[groupIndex];
                await message.react('📊');
                await client.sendMessage(userId, `
📊 *نشاط الرسايل في ${groupsMetadata.get(selectedGroupId)}*
كم مستخدم تريد إظهارهم؟
1. أعلى 3
2. أعلى 5
3. الكل
4. مخصص (أدخل العدد)
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                userState.set(userId, { step: 'stats_messages_count', groupId: selectedGroupId });
                return;
            }

            if (state.step === 'stats_messages_count') {
                if (content === '4') {
                    await message.react('📊');
                    await client.sendMessage(userId, `
📊 أدخل عدد المستخدمين (مثل: 10)
💡 أرسل *إلغاء*${signature}`);
                    userState.set(userId, { step: 'stats_messages_custom_count', groupId: state.groupId });
                    return;
                }
                const counts = { '1': 3, '2': 5, '3': Infinity };
                if (!counts[content]) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                const stats = messageStats.get(state.groupId) || {};
                const sorted = Object.entries(stats)
                    .map(([userId, data]) => ({ userId, count: data.count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, counts[content]);
                let response = `📊 *أعلى ${counts[content] === Infinity ? 'الكل' : counts[content]} مستخدمين في ${groupsMetadata.get(state.groupId)}*\n`;
                sorted.forEach((s, i) => {
                    response += `${i + 1}. ${s.userId}: ${s.count} رسالة\n`;
                });
                response += `💡 إجمالي الرسايل: ${sorted.reduce((sum, s) => sum + s.count, 0)}${signature}`;
                if (sorted.length === 0) response = `⚠️ مافيش رسايل في المجموعة!${signature}`;
                await message.react('✅');
                await client.sendMessage(userId, response);
                userState.delete(userId);
                return;
            }

            if (state.step === 'stats_messages_custom_count') {
                const count = parseInt(content);
                if (isNaN(count) || count <= 0) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ عدد غير صحيح!${signature}`);
                    return;
                }
                const stats = messageStats.get(state.groupId) || {};
                const sorted = Object.entries(stats)
                    .map(([userId, data]) => ({ userId, count: data.count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, count);
                let response = `📊 *أعلى ${count} مستخدمين في ${groupsMetadata.get(state.groupId)}*\n`;
                sorted.forEach((s, i) => {
                    response += `${i + 1}. ${s.userId}: ${s.count} رسالة\n`;
                });
                response += `💡 إجمالي الرسايل: ${sorted.reduce((sum, s) => sum + s.count, 0)}${signature}`;
                if (sorted.length === 0) response = `⚠️ مافيش رسايل في المجموعة!${signature}`;
                await message.react('✅');
                await client.sendMessage(userId, response);
                userState.delete(userId);
                return;
            }

            if (state.step === 'stats_option_4_select_group') {
                const groups = Array.from(groupsMetadata.keys());
                const groupIndex = parseInt(content) - 1;
                if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groups.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم مجموعة غير صحيح!${signature}`);
                    return;
                }
                const users = Array.from(lectureStats.keys());
                let lectureList = `📚 *المستخدمين اللي أضافوا محاضرات*\n`;
                users.forEach((u, i) => {
                    const count = lectureStats.get(u).length;
                    lectureList += `${i + 1}. ${u}: ${count} محاضرات\n`;
                });
                lectureList += `💡 أرسل رقم المستخدم لتفاصيل أو *إلغاء*${signature}`;
                if (users.length === 0) lectureList = `⚠️ مافيش محاضرات مضافة!${signature}`;
                await message.react('✅');
                await client.sendMessage(userId, lectureList);
                userState.set(userId, { step: 'stats_lectures_select_user' });
                return;
            }

            if (state.step === 'stats_lectures_select_user') {
                const users = Array.from(lectureStats.keys());
                const userIndex = parseInt(content) - 1;
                if (isNaN(userIndex) || userIndex < 0 || userIndex >= users.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم غير صحيح!${signature}`);
                    return;
                }
                const selectedUser = users[userIndex];
                const lectures = lectureStats.get(selectedUser) || [];
                let response = `📚 *محاضرات ${selectedUser}*\n`;
                lectures.forEach((l, i) => {
                    response += `- ${l.name}\n`;
                });
                response += `💡 إجمالي: ${lectures.length}${signature}`;
                await message.react('✅');
                await client.sendMessage(userId, response);
                userState.delete(userId);
                return;
            }
        }

        // Existing lecture handling
        if (isGroupMessage && currentGroupId) {
            const chat = await client.getChatById(currentGroupId);
            const isGroupClosed = chat.isReadOnly;
            if (isGroupClosed && !(await isAdmin(userId, currentGroupId))) {
                return;
            }

            if (content.toLowerCase() === 'id' || content.toLowerCase() === 'معرف') {
                await message.react('🆔');
                await client.sendMessage(currentGroupId, `🆔 *معرف المجموعة*: ${currentGroupId}${signature}`);
                return;
            }

            if (content.toLowerCase() === 'الأوامر' || content.toLowerCase() === '!help') {
                await message.react('❓');
                const commandsList = `
📋 *قائمة الأوامر*
━━━━━
🆔 *id*: معرف المجموعة
🔒 *إغلاق المجموعة*: للمشرفين
🔓 *فتح المجموعة*: للمشرفين
📚 *عرض المحاضرة*: قائمة المحاضرات
📥 *add pdf*: إضافة PDF
🖼️ *add images*: إضافة صور
🔍 *البحث عن محاضرة*: بحث
📊 *الإحصائيات*: إحصائيات
📌 *!تثبيت*: تثبيت رسالة (مع ريبلي)
💡 جرب واحد الآن!${signature}`;
                await client.sendMessage(currentGroupId, commandsList);
                return;
            }

            if (content.toLowerCase() === 'عرض المحاضرة' || content.toLowerCase() === 'pdf') {
                await message.react('📚');
                const lectures = lecturesMetadata;
                if (lectures.length === 0) {
                    await client.sendMessage(currentGroupId, `📂 *لا توجد محاضرات*\nحاول إضافة واحدة!${signature}`);
                    return;
                }
                let lectureList = `📜 *اختر محاضرتك!*\n━━━━━\n📚 *قائمة المحاضرات:*\n`;
                lectures.forEach((lecture, index) => {
                    const typeLabel = lecture.type === 'images' ? '[🖼️ صور]' : '[📄 PDF]';
                    lectureList += `${index + 1}. *${lecture.name}* (${lecture.subject || 'متاح'}) ${typeLabel}\n`;
                });
                lectureList += `\n✉️ _سيتم إرسال المحاضرة في الخاص!_\n💡 _أرسل *تراجع* لإلغاء._${signature}`;
                userState.set(userId, { step: 'select_lecture', lectures });
                await client.sendMessage(currentGroupId, lectureList);
                return;
            }

            if (content.toLowerCase() === 'add pdf') {
                await message.react('🥳');
                userState.set(userId, { step: 'add_lecture_file', type: 'pdf' });
                await client.sendMessage(replyTo, `
✨ *إضافة محاضرة جديدة!*
📜 *املأ المعلومات مع ملف PDF:*
━━━━━
📚 المادة: 
🔢 رقم المحاضرة: 
👥 الفوج: 
👨‍🏫 الأستاذ: 
📅 التاريخ: 
💡 _أرسل *تراجع* لإلغاء._${signature}`);
                return;
            }

            if (content.toLowerCase() === 'add images') {
                await message.react('🖼️');
                userState.set(userId, { step: 'add_lecture_images', type: 'images', images: [] });
                await client.sendMessage(replyTo, `
✨ *إضافة محاضرة كصور!*
📜 *املأ المعلومات أولاً:*
━━━━━
📚 المادة: 
🔢 رقم المحاضرة: 
👥 الفوج: 
👨‍🏫 الأستاذ: 
📅 التاريخ: 
💡 _أرسل *تراجع* لإلغاء._${signature}`);
                return;
            }

            if (content.toLowerCase() === 'البحث عن محاضرة') {
                await message.react('🔍');
                userState.set(userId, { step: 'search_lecture' });
                await client.sendMessage(replyTo, `
🔍 *ابحث عن محاضرتك!*
أرسل كلمة للبحث (مثال: *رياضيات*)!${signature}`);
                return;
            }

            if (content.toLowerCase() === 'الإحصائيات') {
                await message.react('📊');
                const statsMessage = `
📊 *إحصائيات البوت*
━━━━━
📚 *عدد المحاضرات*: ${lecturesMetadata.length}
📩 *عدد الطلبات*: ${requestCount}
🔐 *حالة المجموعة*: ${chat.isReadOnly ? '*مغلقة*' : '*مفتوحة*'}
💡 شكرًا، ${senderName}!${signature}`;
                await client.sendMessage(currentGroupId, statsMessage);
                return;
            }
        }

        // Track messages
        if (isGroupMessage) {
            messageStats.set(currentGroupId, messageStats.get(currentGroupId) || {});
            messageStats.get(currentGroupId)[userId] = messageStats.get(currentGroupId)[userId] || { count: 0, lastMessage: 0 };
            messageStats.get(currentGroupId)[userId].count++;
            messageStats.get(currentGroupId)[userId].lastMessage = Date.now();
            saveStats();
        }

        // Handle lecture-related states
        if (userState.has(userId)) {
            const state = userState.get(userId);

            if (content.toLowerCase() === 'تراجع') {
                await message.react('❌');
                await client.sendMessage(replyTo, `✅ *تم الإلغاء!*${signature}`);
                userState.delete(userId);
                return;
            }

            if (state.step === 'add_lecture_file' && state.type === 'pdf') {
                if (!message.hasMedia || message.type !== 'document') {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ أرسل ملف *PDF*!${signature}`);
                    return;
                }
                const media = await message.downloadMedia();
                if (!media.mimetype.includes('application/pdf')) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ الملف ليس *PDF*!${signature}`);
                    return;
                }
                if (!(await verifyGroup(PDF_ARCHIVE_GROUP, 'أرشيف PDF')) || !(await isBotAdmin(PDF_ARCHIVE_GROUP))) {
                    await client.sendMessage(userId, `❌ خطأ: أرشيف PDF غير متاح!${signature}`);
                    userState.delete(userId);
                    return;
                }
                const description = content || '';
                const subject = description.match(/المادة[:\s]*(.+?)(?:\s|$)/i)?.[1]?.trim() || 'غير محدد';
                const number = description.match(/رقم المحاضرة[:\s]*(\d+)(?:\s|$)/i)?.[1]?.trim() || 'غير محدد';
                const group = description.match(/الفوج[:\s]*(.+?)(?:\s|$)/i)?.[1]?.trim() || 'غير محدد';
                const professor = description.match(/الأستاذ[:\s]*(.+?)(?:\s|$)/i)?.[1]?.trim() || 'غير محدد';
                const date = description.match(/التاريخ[:\s]*(.+?)(?:\s|$)/i)?.[1]?.trim() || new Date().toLocaleDateString('ar-EG');
                let filename = message._data.filename || `lecture_${lecturesMetadata.length + 1}.pdf`;
                if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
                const filePath = `${lecturesDir}${filename}`;
                fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
                let archiveMsg;
                try {
                    const archiveChat = await client.getChatById(PDF_ARCHIVE_GROUP);
                    archiveMsg = await archiveChat.sendMessage(media, {
                        caption: `${filename}\n📚 المادة: ${subject}\n🔢 الرقم: ${number}\n👥 الفوج: ${group}\n👨‍🏫 الأستاذ: ${professor}\n📅 التاريخ: ${date}`
                    });
                } catch (error) {
                    await client.sendMessage(userId, `❌ فشل إرسال المحاضرة!${signature}`);
                    userState.delete(userId);
                    return;
                }
                const lectureData = {
                    type: 'pdf',
                    messageId: archiveMsg.id._serialized,
                    name: filename,
                    filePath,
                    subject,
                    number,
                    group,
                    professor,
                    date
                };
                lecturesMetadata.push(lectureData);
                lectureStats.set(userId, lectureStats.get(userId) || []);
                lectureStats.get(userId).push(lectureData);
                saveLectures();
                saveStats();
                const lectureCount = lectureStats.get(userId).length;
                if (lectureCount % 5 === 0) {
                    await notifyAllGroups(`
🎉 تهانينا لـ ${userId}!
${lectureCount === 5 ? 'لقد أضاف 5 محاضرات رائعة!' : `جيد جدًا! لقد أضاف ${lectureCount} محاضرة!`}
شكرًا على مجهودك المذهل! 🚀`);
                }
                await message.react('✅');
                await client.sendMessage(replyTo, `
✅ *تمت إضافة المحاضرة!*
━━━━━
📚 المادة: ${subject}
🔢 رقم المحاضرة: ${number}
👥 الفوج: ${group}
👨‍🏫 الأستاذ: ${professor}
📅 التاريخ: ${date}
📎 اسم الملف: ${filename}
━━━━━
شكرًا، ${senderName}!${signature}`);
                await notifyAllGroups(`📚 تمت إضافة محاضرة: *${filename}* بواسطة ${senderName}`);
                userState.delete(userId);
                return;
            }

            if (state.step === 'add_lecture_images' && state.type === 'images') {
                if (content.toLowerCase() === 'إنهاء') {
                    if (!state.subject || state.subject.trim() === '') {
                        await message.react('⚠️');
                        await client.sendMessage(replyTo, `⚠️ أدخل مادة صالحة!${signature}`);
                        return;
                    }
                    if (state.images.length === 0) {
                        await message.react('⚠️');
                        await client.sendMessage(replyTo, `⚠️ أرسل صورة واحدة على الأقل!${signature}`);
                        return;
                    }
                    if (!(await verifyGroup(IMAGES_ARCHIVE_GROUP, 'أرشيف الصور')) || !(await isBotAdmin(IMAGES_ARCHIVE_GROUP))) {
                        await client.sendMessage(userId, `❌ خطأ: أرشيف الصور غير متاح!${signature}`);
                        userState.delete(userId);
                        return;
                    }
                    const safeSubject = state.subject.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim() || 'محاضرة';
                    const lectureName = `lecture_${lecturesMetadata.length + 1}_${safeSubject}`;
                    let archiveMsgIds = [];
                    try {
                        const archiveChat = await client.getChatById(IMAGES_ARCHIVE_GROUP);
                        for (let i = 0; i < state.images.length; i++) {
                            const id = state.images[i];
                            const msg = await client.getMessageById(id);
                            const media = await msg.downloadMedia();
                            const sentMsg = await archiveChat.sendMessage(media, {
                                caption: `${lectureName}\n📸 رقم الصورة: ${i + 1}\n📚 المادة: ${state.subject}\n🔢 الرقم: ${state.number}\n👥 الفوج: ${state.group}\n👨‍🏫 الأستاذ: ${state.professor}\n📅 التاريخ: ${state.date}`
                            });
                            archiveMsgIds.push(sentMsg.id._serialized);
                        }
                    } catch (error) {
                        await client.sendMessage(userId, `❌ فشل إرسال الصور!${signature}`);
                        userState.delete(userId);
                        return;
                    }
                    const lectureData = {
                        type: 'images',
                        messageIds: archiveMsgIds,
                        name: lectureName,
                        subject: state.subject,
                        number: state.number,
                        group: state.group,
                        professor: state.professor,
                        date: state.date
                    };
                    lecturesMetadata.push(lectureData);
                    lectureStats.set(userId, lectureStats.get(userId) || []);
                    lectureStats.get(userId).push(lectureData);
                    saveLectures();
                    saveStats();
                    const lectureCount = lectureStats.get(userId).length;
                    if (lectureCount % 5 === 0) {
                        await notifyAllGroups(`
🎉 تهانينا لـ ${userId}!
${lectureCount === 5 ? 'لقد أضاف 5 محاضرات رائعة!' : `جيد جدًا! لقد أضاف ${lectureCount} محاضرة!`}
شكرًا على مجهودك المذهل! 🚀`);
                    }
                    await message.react('✅');
                    await client.sendMessage(replyTo, `
✅ *تمت إضافة المحاضرة!*
━━━━━
📚 المادة: ${state.subject}
🔢 رقم المحاضرة: ${state.number}
👥 الفوج: ${state.group}
👨‍🏫 الأستاذ: ${state.professor}
📅 التاريخ: ${state.date}
🖼️ عدد الصور: ${state.images.length}
━━━━━
شكرًا، ${senderName}!${signature}`);
                    await notifyAllGroups(`📚 تمت إضافة محاضرة: *${lectureName}* بواسطة ${senderName}`);
                    userState.delete(userId);
                    return;
                }

                if (message.hasMedia && message.type === 'image') {
                    if (!state.subject) {
                        await message.react('⚠️');
                        await client.sendMessage(replyTo, `⚠️ أرسل معلومات المحاضرة أولاً!${signature}`);
                        return;
                    }
                    state.images.push(message.id._serialized);
                    userState.set(userId, state);
                    await message.react('🖼️');
                    await client.sendMessage(replyTo, `✅ *تم استلام الصورة ${state.images.length}!*\n💡 _أرسل المزيد أو اكتب *إنهاء*.${signature}`);
                    return;
                }

                if (!state.subject && content) {
                    const description = content || '';
                    const subject = description.match(/المادة[:\s]*(.+?)(?:\s|$)/i)?.[1]?.trim() || '';
                    const number = description.match(/رقم المحاضرة[:\s]*(\d+)(?:\s|$)/i)?.[1]?.trim() || 'غير محدد';
                    const group = description.match(/الفوج[:\s]*(.+?)(?:\s|$)/i)?.[1]?.trim() || 'غير محدد';
                    const professor = description.match(/الأستاذ[:\s]*(.+?)(?:\s|$)/i)?.[1]?.trim() || 'غير محدد';
                    const date = description.match(/التاريخ[:\s]*(.+?)(?:\s|$)/i)?.[1]?.trim() || new Date().toLocaleDateString('ar-EG');
                    if (!subject || subject.trim() === '') {
                        await message.react('⚠️');
                        await client.sendMessage(replyTo, `⚠️ أدخل مادة صالحة!${signature}`);
                        return;
                    }
                    state.subject = subject;
                    state.number = number;
                    state.group = group;
                    state.professor = professor;
                    state.date = date;
                    userState.set(userId, state);
                    await message.react('📝');
                    await client.sendMessage(replyTo, `📝 *تم استلام المعلومات!*\nأرسل الصور، ثم *إنهاء*!${signature}`);
                    return;
                }
            }

            if (state.step === 'select_lecture') {
                const lectureIndex = parseInt(content) - 1;
                if (lectureIndex >= 0 && lectureIndex < state.lectures.length) {
                    const lecture = state.lectures[lectureIndex];
                    try {
                        if (lecture.type === 'pdf') {
                            const originalMessage = await client.getMessageById(lecture.messageId);
                            await originalMessage.forward(userId);
                            requestCount++;
                            await client.sendMessage(userId, `
📄 *محاضرتك جاهزة!*
━━━━━
📎 *المحاضرة*: ${lecture.name}
📚 *المادة*: ${lecture.subject || 'عام'}
🔢 *رقم المحاضرة*: ${lecture.number || '-'}
👥 *الفوج*: ${lecture.group || '-'}
👨‍🏫 *الأستاذ*: ${lecture.professor || '-'}
📅 *التاريخ*: ${lecture.date || '-'}
━━━━━
تفضل، ${senderName}!${signature}`);
                        } else {
                            for (let i = 0; i < lecture.messageIds.length; i++) {
                                const messageId = lecture.messageIds[i];
                                const originalMessage = await client.getMessageById(messageId);
                                await client.sendMessage(userId, `📸 *صورة رقم ${i + 1}*`);
                                await originalMessage.forward(userId);
                            }
                            requestCount++;
                            await client.sendMessage(userId, `
🖼️ *صور المحاضرة جاهزة!*
━━━━━
📎 *المحاضرة*: ${lecture.name}
📚 *المادة*: ${lecture.subject || 'عام'}
🔢 *رقم المحاضرة*: ${lecture.number || '-'}
👥 *الفوج*: ${lecture.group || '-'}
👨‍🏫 *الأستاذ*: ${lecture.professor || '-'}
📅 *التاريخ*: ${lecture.date || '-'}
━━━━━
تفضل، ${senderName}!${signature}`);
                        }
                    } catch (error) {
                        await client.sendMessage(userId, `⚠️ المحاضرة غير متاحة!${signature}`);
                    }
                    userState.delete(userId);
                    return;
                } else {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ رقم غير صحيح!${signature}`);
                    return;
                }
            }

            if (state.step === 'search_lecture') {
                if (!content) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ أرسل كلمة للبحث!${signature}`);
                    return;
                }
                const query = content.toLowerCase();
                const filteredLectures = lecturesMetadata.filter(lecture =>
                    lecture.name.toLowerCase().includes(query) ||
                    lecture.subject.toLowerCase().includes(query) ||
                    lecture.professor.toLowerCase().includes(query)
                );
                if (filteredLectures.length === 0) {
                    await client.sendMessage(replyTo, `📂 *لا توجد نتائج*\nلم يتم العثور على "${query}"!${signature}`);
                    userState.delete(userId);
                    return;
                }
                let lectureList = `🔍 *نتائج البحث عن ${query}*\n━━━━━\n`;
                filteredLectures.forEach((lecture, index) => {
                    const typeLabel = lecture.type === 'images' ? '[🖼️ صور]' : '[📄 PDF]';
                    lectureList += `${index + 1}. *${lecture.name}* (${lecture.subject || 'عام'}) ${typeLabel}\n`;
                });
                lectureList += `\n✉️ أرسل رقم المحاضرة!${signature}`;
                userState.set(userId, { step: 'select_lecture', lectures: filteredLectures });
                await client.sendMessage(replyTo, lectureList);
                return;
            }
        }

    } catch (error) {
        console.error(`[❌] Error processing message from ${message.from || 'unknown'}:`, error);
        if (message.from) {
            await client.sendMessage(message.from, `⚠️ خطأ غير متوقع!${signature}`);
        }
    }
});

// Group management cron jobs
cron.schedule('0 22 * * *', async () => {
    if (!groupId) return;
    try {
        const chat = await client.getChatById(groupId);
        if (await isBotAdmin(groupId)) {
            await chat.setMessagesAdminsOnly(true);
            await client.sendMessage(groupId, `🚫 *إغلاق المجموعة*\nتم إغلاق المجموعة الساعة 10:00 مساءً.${signature}`);
        }
    } catch (error) {
        console.error('[❌] Error closing group:', error);
    }
});

cron.schedule('0 8 * * *', async () => {
    if (!groupId) return;
    try {
        const chat = await client.getChatById(groupId);
        if (await isBotAdmin(groupId)) {
            await chat.setMessagesAdminsOnly(false);
            await client.sendMessage(groupId, `✅ *فتح المجموعة*\nتم فتح المجموعة الساعة 8:00 صباحًا!${signature}`);
        }
    } catch (error) {
        console.error('[❌] Error opening group:', error);
    }
});

client.initialize()
    .then(() => console.log('[🚀] Bot started!'))
    .catch(err => console.error('[❌] Error starting bot:', err));