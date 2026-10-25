// 舆见 AI —— 模型接入层
//
// 设计要点：真实 API 与模拟数据模式共用同一套调用签名。
// 上层（分析编排）不需要知道现在是哪种模式，因此「无密钥也能完整跑通 Demo」
// 不是靠特殊分支实现的，而是靠这一层的一致性。

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 是否配置了真实模型。未配置时全站自动降级为模拟数据模式。 */
  live: boolean;
}

export function getLLMConfig(): LLMConfig {
  const apiKey = (
    process.env.LLM_API_KEY ??
    process.env.OPENAI_API_KEY ??
    ""
  ).trim();
  const baseUrl = (
    process.env.LLM_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const model = (process.env.LLM_MODEL ?? "gpt-4o-mini").trim();
  return { apiKey, baseUrl, model, live: apiKey.length > 0 };
}

export interface LLMCallResult {
  ok: boolean;
  /** 已解析的 JSON 对象 */
  data?: unknown;
  /** 原始文本，便于排查 */
  raw?: string;
  error?: string;
  latencyMs: number;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 校验失败后的修复提示，会作为额外的一轮用户消息追加 */
  repairHint?: string;
  timeoutMs?: number;
}

/** 常见的返回包装：模型有时会把 JSON 包在解释文字或代码块里 */
function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试 */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* 继续尝试 */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

export async function chatJSON(
  system: string,
  user: string,
  options: ChatOptions = {}
): Promise<LLMCallResult> {
  const cfg = getLLMConfig();
  const started = Date.now();

  if (!cfg.live) {
    return { ok: false, error: "未配置模型密钥", latencyMs: 0 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);

  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  if (options.repairHint) {
    messages.push({ role: "user" as const, content: options.repairHint });
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const body = await res.text();
      const hint =
        res.status === 429
          ? "触发限流"
          : res.status === 401
            ? "密钥无效"
            : `HTTP ${res.status}`;
      return { ok: false, error: `${hint}：${body.slice(0, 200)}`, latencyMs };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(raw);
    if (parsed === null) {
      return { ok: false, raw, error: "返回内容不是合法 JSON", latencyMs };
    }
    return { ok: true, data: parsed, raw, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: msg.includes("abort") ? "请求超时" : `连接失败：${msg}`,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
