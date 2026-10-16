/* Hermes integration for the action-capable assistant chat. */
(function () {
  "use strict";

  const ENDPOINT = window.NASH_AI_ENDPOINT || "http://127.0.0.1:8787/chat";
  const MAX_IMAGE_CHARS = 2500000;
  const MAX_HISTORY = 8;

  function compactNutrition(recipe, person) {
    if (!recipe || typeof nutrition !== "function") return null;
    const value = nutrition(recipe, person);
    return value ? { kcal: value.k, protein: value.b, fat: value.f, carbs: value.c, grams: value.grams } : null;
  }

  function snapshot() {
    const person = typeof todayPerson === "string" && todayPerson === "husband" ? "husband" : "you";
    const recipes = typeof allRecipes === "function" ? allRecipes() : [];
    return {
      date: typeof selectedDiaryDate === "string" ? selectedDiaryDate : new Date().toISOString().slice(0, 10),
      person,
      personLabel: person === "husband" ? "Фа" : "Пи",
      goals: typeof goalFor === "function" ? goalFor(person) : null,
      currentMeals: typeof diaryPlan === "function" ? diaryPlan().map(id => {
        const recipe = typeof byId === "function" ? byId(id) : null;
        return recipe ? { id: recipe.id, name: recipe.name } : null;
      }) : [],
      catalog: recipes.slice(0, 120).map(recipe => ({
        id: recipe.id,
        name: recipe.name,
        category: recipe.category,
        you: compactNutrition(recipe, "you"),
        husband: compactNutrition(recipe, "husband")
      }))
    };
  }

  function recentHistory() {
    const list = Array.isArray(state?.aiChat) ? state.aiChat : [];
    return list.slice(-MAX_HISTORY).map(item => ({
      role: item.role === "user" ? "user" : "assistant",
      content: String(item.text || "")
    }));
  }

  function systemPrompt() {
    return `Ты — умный помощник приложения «Наш рацион» для Пи и Фа. Понимай свободный русский язык так же внимательно, как хороший помощник в Telegram. Твоя задача — ответить пользователю и подготовить точные изменения данных приложения.

Верни ТОЛЬКО валидный JSON без markdown и пояснений вокруг него:
{"reply":"дружелюбный ответ по-русски","actions":[...]}

Поддерживаемые действия:
1. Создать блюдо:
{"type":"create_dish","name":"короткое естественное название без слов создай/мне/блюдо","category":"Завтраки|Курица и индейка|Говядина|Рыба и морепродукты|Перекусы и сладкое","ingredients":[{"name":"продукт","unit":"г|мл|шт","piQty":число,"faQty":число}],"steps":[{"title":"название шага","text":"точное действие"}],"nutrition":{"you":{"grams":число,"k":число,"b":число,"f":число,"c":число},"husband":{"grams":число,"k":число,"b":число,"f":число,"c":число}}}
Если пользователь говорит «мне», точное указанное количество относится к Пи; для Фа рассчитай разумную увеличенную порцию. Не добавляй ингредиенты, которых пользователь не просил, кроме очевидных воды, соли, перца или небольшого количества масла, и явно перечисляй их.
2. Изменить блюдо:
{"type":"edit_dish","dish":"точное название","name":"необязательно","ingredients":[...],"steps":[...],"nutrition":{...}}
3. Поставить блюдо в меню:
{"type":"set_meal","day":"сегодня|понедельник|...","meal":"завтрак|обед|перекус|ужин","dish":"название или id"}
4. Заполнить неделю существующими блюдами:
{"type":"fill_week","days":[{"day":"понедельник","meals":{"завтрак":"id","обед":"id","перекус":"id","ужин":"id"}}]}
Используй только id из каталога. Учитывай категории и не повторяй одно блюдо чаще двух раз.
5. Добавить съеденный продукт:
{"type":"add_food","name":"название","grams":число,"k":число,"b":число,"f":число,"c":число,"person":"you|husband"}
6. Добавить покупку:
{"type":"add_shopping","name":"название","qty":число,"unit":"г|кг|шт|л|мл"}
7. Записать замер:
{"type":"record_measurement","person":"you|husband","weight":число,"waist":число|null,"hips":число|null,"chest":число|null}
8. Добавить напоминание:
{"type":"add_reminder","person":"you|husband","name":"название","dose":"дозировка","time":"HH:MM","days":[1,2,3,4,5,6,0]}
9. Изменить цели:
{"type":"update_goals","person":"you|husband","k":число,"b":число,"f":число,"c":число}

Если пользователь только спрашивает совет, верни actions: []. Если информации не хватает для безопасного изменения, задай один короткий уточняющий вопрос и также верни actions: []. Никогда не обещай изменение, которого нет в actions. Для КБЖУ используй реалистичные примерные значения. Данные приложения: ${JSON.stringify(snapshot())}`;
  }

  function parseAnswer(raw) {
    const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Ответ ИИ не содержит команд");
    const data = JSON.parse(text.slice(start, end + 1));
    if (!data || typeof data.reply !== "string" || !Array.isArray(data.actions)) throw new Error("Неверный формат ответа ИИ");
    return data;
  }

  async function askHermesCommand(prompt, photo) {
    const content = [{ type: "text", text: prompt || "Проанализируй приложенное фото и спроси, что нужно изменить." }];
    if (photo && photo.length <= MAX_IMAGE_CHARS) content.push({ type: "image_url", image_url: { url: photo, detail: "low" } });
    const history = recentHistory();
    if (history.at(-1)?.role === "user" && history.at(-1).content.trim() === String(prompt || "").trim()) history.pop();
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt() },
          ...history,
          { role: "user", content: content.length === 1 ? content[0].text : content }
        ]
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Ошибка ИИ (${response.status})`);
    const plan = parseAnswer(payload.answer || payload.choices?.[0]?.message?.content);
    const applied = typeof window.applyHermesActions === "function"
      ? window.applyHermesActions(plan.actions, { photo, prompt })
      : { applied: 0 };
    return { reply: plan.reply, applied: applied?.applied || 0 };
  }

  window.nashAskHermesCommand = askHermesCommand;
})();
