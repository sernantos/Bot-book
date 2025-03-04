import TelegramBot from "node-telegram-bot-api";
import { $bookService, $commonService } from "./services/index";
import * as path from "path";
import fs from "fs";

const TOKEN = "YOUR_TELEGRAM_BOT_TOKEN";
const bot = new TelegramBot(TOKEN, { polling: true });

const userSession = {}; // Запоминаем ссылки для каждого пользователя

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Привет! Отправь мне ссылку на книгу, и я создам EPUB.");
});

bot.onText(/(https?:\/\/[^\s]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const PAGE_URL = match[1];

    userSession[chatId] = { url: PAGE_URL }; // Запоминаем ссылку

    bot.sendMessage(chatId, "📖 Сколько глав скачать? Введите диапазон (например, `1-10` или `5-20`).");
});

bot.onText(/(\d+)-(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!userSession[chatId]?.url) {
        return bot.sendMessage(chatId, "❌ Сначала отправьте ссылку на книгу!");
    }

    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    const PAGE_URL = userSession[chatId].url;
    let statusMessageId = null;

    bot.sendMessage(chatId, "📚 Получаю информацию о книге...").then((sentMessage) => {
        statusMessageId = sentMessage.message_id;
    });

    try {
        await $commonService.delay(1000);
        const bookInfo = await $bookService.getBookInfo(PAGE_URL);
        const BOOK_NAME = PAGE_URL.split("/").pop();
        const OUTPUT_BOOK_PATH = `${path.resolve()}/books/${BOOK_NAME}.epub`;

        bot.editMessageText("📖 Получаю список глав...", { chat_id: chatId, message_id: statusMessageId });
        await $commonService.delay(1000);
        const chapters = await $bookService.getChapters(PAGE_URL);

        if (start < 1 || end > chapters.length || start > end) {
            return bot.sendMessage(chatId, "❌ Неверный диапазон! Введите корректные номера глав.");
        }

        const selectedChapters = chapters.slice(start - 1, end);

        bot.editMessageText(`📥 Загружаю главы: ${start}-${end}...`, { chat_id: chatId, message_id: statusMessageId });

        let loadedChapters = [];
        for (let i = 0; i < selectedChapters.length; i++) {
            try {
                const content = await $bookService.getChapterContent(selectedChapters[i].url);
                loadedChapters.push({ title: selectedChapters[i].title, data: content });

                if (i % 3 === 0 || i === selectedChapters.length - 1) {
                    bot.editMessageText(`📥 Загружено: ${i + 1}/${selectedChapters.length}`, {
                        chat_id: chatId,
                        message_id: statusMessageId,
                    });
                }
            } catch (error) {
                bot.sendMessage(chatId, `⚠️ Ошибка загрузки главы: ${selectedChapters[i].title}`);
            }
        }

        if (loadedChapters.length === 0) {
            throw new Error("Не удалось загрузить главы.");
        }

        bot.editMessageText("📦 Генерирую EPUB...", { chat_id: chatId, message_id: statusMessageId });

        const epubBookOptions = {
            ...bookInfo,
            content: loadedChapters,
            output: OUTPUT_BOOK_PATH,
            verbose: true,
        };

        await $bookService.generateEpubFromData(epubBookOptions);

        bot.editMessageText("✅ Книга готова! Отправляю файл...", { chat_id: chatId, message_id: statusMessageId });

        bot.sendDocument(chatId, fs.createReadStream(OUTPUT_BOOK_PATH)).then(() => {
            fs.unlinkSync(OUTPUT_BOOK_PATH);
        });

    } catch (error) {
        bot.sendMessage(chatId, "❌ Ошибка при обработке книги: " + error.message);
    }

    delete userSession[chatId]; // Чистим данные после скачивания
});
