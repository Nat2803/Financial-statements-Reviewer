const SECTIONS = ["Баланс", "ОПУ", "Учётная политика", "Кросс-чеки раскрытий", "Общие замечания"];

// Must stay in sync with SYSTEM_PROMPT / TOOL_DEF in index.html
const SYSTEM_PROMPT = `Ты — опытный МСФО-специалист по контролю качества отчётности, выполняющий предварительную проверку пакета финансовой отчётности перед сдачей. Тебе передан извлечённый текст отчётности (возможно из нескольких файлов: баланс, отчёт о прибылях и убытках, примечания и т.д.).

Проверь данные строго по следующим разделам:
1. Баланс — арифметика и промежуточные/итоговые суммы (footing); равенство Активы = Обязательства + Капитал; корректность классификации текущих/долгосрочных статей (IAS 1); логичность динамики статьи период к периоду.
2. ОПУ (отчёт о прибылях и убытках) — арифметика и промежуточные итоги; корректность классификации расходов по функции или характеру (IAS 1); необычные или немотивированные отклонения.
3. Учётная политика — соответствие фактически применяемых методов (признание выручки, амортизация, оценка запасов, резервы и т.д.) заявленной политике, последовательность применения.
4. Кросс-чеки раскрытий — совпадение сумм из примечаний со строками баланса и ОПУ; совпадение одних и тех же показателей между разными примечаниями; увязка чистой прибыли с изменением нераспределённой прибыли в капитале; увязка остатка денежных средств (ДДС) с балансом.
5. Общие замечания — прочие логические противоречия и аномалии, не относящиеся к разделам выше.

Правила:
- Не придумывай цифры. Если данных для проверки раздела недостаточно — раздел пропускается, не включай по нему замечания.
- Каждое замечание получает severity: critical (ошибка/расхождение), warning (потенциальное несоответствие) или info (наблюдение, включая подтверждение того, что раздел проверен и сходится).
- Не более 14 замечаний суммарно. Внутри каждого раздела сортируй по критичности: critical, затем warning, затем info.
- Стиль — деловой, без разговорных оборотов, конкретные формулировки с цифрами там, где есть расхождение.
- Если применим конкретный стандарт МСФО (IFRS/IAS), укажи ссылку на него в standard_ref.
- Передай результат ТОЛЬКО вызовом инструмента submit_review, без сопроводительного текста.`;

const TOOL_DEF = {
  name: "submit_review",
  description: "Передать структурированный результат проверки финансовой отчётности",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "object",
        properties: {
          critical: { type: "integer" },
          warning: { type: "integer" },
          info: { type: "integer" }
        },
        required: ["critical", "warning", "info"]
      },
      conclusion: { type: "string", description: "Общее заключение, 1-2 предложения" },
      findings: {
        type: "array",
        maxItems: 14,
        items: {
          type: "object",
          properties: {
            section: { type: "string", enum: SECTIONS },
            severity: { type: "string", enum: ["critical", "warning", "info"] },
            item: { type: "string", description: "Статья отчётности" },
            description: { type: "string" },
            standard_ref: { type: "string" }
          },
          required: ["section", "severity", "item", "description"]
        }
      }
    },
    required: ["summary", "conclusion", "findings"]
  }
};

const MAX_TEXT_CHARS = 800000;

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Некорректный запрос" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (env.ACCESS_CODE && body.accessCode !== env.ACCESS_CODE) {
      return new Response(JSON.stringify({ error: "Неверный код доступа" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const text = String(body.text || "").slice(0, MAX_TEXT_CHARS);
    if (!text) {
      return new Response(JSON.stringify({ error: "Пустой текст для анализа" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        tools: [TOOL_DEF],
        tool_choice: { type: "tool", name: "submit_review" },
        messages: [{ role: "user", content: text }]
      })
    });

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};
