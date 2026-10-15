/*
 * Optional Hermes bridge for the static GitHub Pages build.
 * The OpenAI and Hermes keys stay on the user's computer; this file contains
 * only a localhost URL and sends the current nutrition context to the bridge.
 */
(function () {
  "use strict";

  const ENDPOINT = window.NASH_AI_ENDPOINT || "http://127.0.0.1:8787/chat";
  const HISTORY_PREFIX = "nash-racion-ai-history-v1:";
  const MAX_HISTORY = 6;
  const MAX_IMAGE_CHARS = 2500000;

  function historyKey() {
    const activePerson = document.querySelector("[data-person].active")?.dataset.person;
    return HISTORY_PREFIX + (activePerson === "husband" ? "husband" : "you");
  }

  function readHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(historyKey()) || "[]");
      return Array.isArray(value) ? value.slice(-MAX_HISTORY) : [];
    } catch (_) {
      return [];
    }
  }

  function writeHistory(history) {
    try { localStorage.setItem(historyKey(), JSON.stringify(history.slice(-MAX_HISTORY))); } catch (_) {}
  }

  function compactNutrition(recipe, person) {
    if (!recipe || typeof nutrition !== "function") return null;
    const value = nutrition(recipe, person);
    return value ? { kcal: value.k, protein: value.b, fat: value.f, carbs: value.c, grams: value.grams } : null;
  }

  function compactRecipe(id, person) {
    const recipe = typeof byId === "function" ? byId(id) : null;
    if (!recipe) return id || null;
    return { id: recipe.id, name: recipe.name, category: recipe.category, nutrition: compactNutrition(recipe, person) };
  }

  function appSnapshot() {
    const person = document.querySelector("[data-person].active")?.dataset.person === "husband" ? "husband" : "you";
    const day = typeof diaryPlan === "function" ? diaryPlan() : [];
    const diary = typeof diaryDay === "function" ? diaryDay() : {};
    const eaten = diary.eaten?.[person] || [];
    const extras = diary.extras?.[person] || [];
    const shoppingItems = typeof shopping === "function" ? shopping() : [];
    return {
      person,
      personLabel: person === "husband" ? "Фа" : "Пи",
      date: document.getElementById("todayDate")?.textContent || new Date().toISOString().slice(0, 10),
      goals: typeof goalFor === "function" ? goalFor(person) : null,
      plannedMeals: day.map(id => compactRecipe(id, person)),
      eatenMeals: eaten.map(item => item ? { name: item.name, nutrition: item.nutrition?.[person] || item.nutrition || null } : null),
      extras: extras.map(item => ({ name: item.name, kcal: item.k, protein: item.b, fat: item.f, carbs: item.c, grams: item.grams })),
      shopping: shoppingItems.slice(0, 100).map(item => ({ name: item.name, qty: item.qty, unit: item.unit, category: item.category, done: !!item.done })),
      context: typeof aiConfig === "function" ? aiConfig().label : "Сегодня"
    };
  }

  function answerText(message) {
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(part => part?.text || part?.content || "").join("").trim();
    return "Не удалось прочитать ответ помощника.";
  }

  function answerBox() {
    let box = document.getElementById("aiRemoteAnswer");
    if (!box) {
      box = document.createElement("div");
      box.id = "aiRemoteAnswer";
      box.className = "ai-remote-answer";
      box.setAttribute("role", "status");
      document.getElementById("aiStatus")?.insertAdjacentElement("afterend", box);
    }
    return box;
  }

  async function askHermes() {
    const prompt = document.getElementById("aiPrompt")?.value.trim() || "";
    const preview = document.getElementById("aiPhotoPreview");
    const photo = preview?.classList.contains("has-photo") ? preview.src : null;
    const status = document.getElementById("aiStatus");
    const button = document.getElementById("aiContinueButton");
    if (!prompt && !photo) {
      if (status) status.textContent = "Напишите вопрос или приложите фото.";
      return;
    }
    const answer = answerBox();
    answer.textContent = "";
    if (status) status.textContent = "Помощник думает…";
    if (button) { button.disabled = true; button.textContent = "Жду ответ…"; }
    const history = readHistory();
    const system = [
      "Ты — помощник семьи Пи и Фа внутри приложения «Наш рацион».",
      "Отвечай по-русски, дружелюбно и конкретно.",
      "Используй данные приложения как контекст, но не выдумывай отсутствующие факты.",
      "Не изменяй данные сам: предложи черновик, который пользователь проверит кнопкой приложения.",
      "По медицинским вопросам давай только общую информацию и совет обратиться к врачу.",
      "Текущий контекст приложения:\n" + JSON.stringify(appSnapshot())
    ].join("\n\n");
    const content = [{ type: "text", text: prompt || "Проанализируй это фото для текущего контекста." }];
    if (photo && photo.length <= MAX_IMAGE_CHARS) content.push({ type: "image_url", image_url: { url: photo, detail: "low" } });
    else if (photo) content[0].text += "\n[Фото не отправлено: оно слишком большое для локального запроса.]";
    const messages = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: content.length === 1 ? content[0].text : content }
    ];
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Ошибка сервиса (${response.status})`);
      const text = answerText(data.answer || data.choices?.[0]?.message?.content);
      if (!text) throw new Error("Сервис вернул пустой ответ");
      answer.textContent = text;
      writeHistory([...history, { role: "user", content: prompt || "Фото" }, { role: "assistant", content: text }]);
      if (status) status.textContent = "Ответ готов. Данные приложения не изменены.";
    } catch (error) {
      answer.textContent = "";
      if (status) status.textContent = `ИИ пока недоступен: ${error.message}. Запустите локальный мост Hermes.`;
    } finally {
      if (button) { button.disabled = false; button.textContent = "Спросить ИИ"; }
    }
  }

  function install() {
    const button = document.getElementById("aiContinueButton");
    if (!button) return;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      askHermes();
    }, true);
    button.textContent = "Спросить ИИ";
    window.nashAskHermes = askHermes;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
